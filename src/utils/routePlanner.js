import {
  axisPosition,
  boundsAround,
  destinationPoint,
  ellipseBounds,
  haversine,
  nearestOnPath,
} from "./geo.js";
import { fetchArea as defaultFetchArea } from "./network.js";
import { fetchPois as defaultFetchPois } from "./overpass.js";
import { createRouter } from "./router.js";
import { pickTasks } from "./taskPicker.js";
import defaultTasks from "./tasks.json";

export const MIN_RATIO = 1.1;
export const MAX_RATIO = 1.25;
export const POIS_PER_KM = 2;

const STOP_RADIUS_M = 60; // POIs this close to the path count as visited
const DEDUPE_M = 30;
const MAX_ITERATIONS = 12;
const LOOP_TOLERANCE = 0.1;
const LOOP_PRESCALE_TOLERANCE = 0.15;
const ALT_MAX_OVERLAP = 0.6;
const MAX_DESTINATION_M = 5000;
const MAX_LOOP_M = 12000;
const TORTUOSITY_ESTIMATE = 1.4; // sizes the map download before the real shortest route is known

export const requiredStops = (distanceM) => Math.max(2, Math.ceil((POIS_PER_KM * distanceM) / 1000));

function dedupe(pois) {
  const kept = [];
  for (const poi of pois) {
    if (!kept.some((other) => haversine(other, poi) < DEDUPE_M)) kept.push(poi);
  }
  return kept;
}

function evenlySample(list, count) {
  if (list.length <= count) return list;
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
}

// POIs within STOP_RADIUS_M of the path, plus any forced ones, in walking order.
function collectStops(coords, candidates, forced) {
  const found = new Map();
  for (const poi of candidates) {
    const { distance, index } = nearestOnPath(poi, coords);
    if (distance <= STOP_RADIUS_M) found.set(poi.id, { poi, index });
  }
  for (const poi of forced) {
    if (!found.has(poi.id)) found.set(poi.id, { poi, index: nearestOnPath(poi, coords).index });
  }
  return [...found.values()].sort((a, b) => a.index - b.index).map((entry) => entry.poi);
}

// Cost of detouring through `point` between two neighbours in the stop sequence.
const insertionCost = (prev, point, next) =>
  haversine(prev, point) + haversine(point, next) - haversine(prev, next);

function removeWorst(waypoints, start, end, count) {
  let result = [...waypoints];
  for (let n = 0; n < count && result.length > 0; n++) {
    const sequence = [start, ...result, end];
    let worst = 0;
    let worstCost = -Infinity;
    result.forEach((_, i) => {
      const cost = insertionCost(sequence[i], sequence[i + 1], sequence[i + 2]);
      if (cost > worstCost) {
        worstCost = cost;
        worst = i;
      }
    });
    result.splice(worst, 1);
  }
  return result;
}

function insertBest(waypoints, start, end, candidates, skipIds, wantedExtraM) {
  const sequence = [start, ...waypoints, end];
  let best = null;
  for (const poi of candidates) {
    if (skipIds.has(poi.id)) continue;
    for (let i = 0; i < sequence.length - 1; i++) {
      const cost = insertionCost(sequence[i], poi, sequence[i + 1]);
      // Road distance is roughly 1.3x straight-line, so compare against the extra length we need.
      const score = wantedExtraM > 0 ? Math.abs(cost * 1.3 - wantedExtraM) : cost;
      if (!best || score < best.score) best = { score, poi, position: i };
    }
  }
  if (!best) return null;
  const next = [...waypoints];
  next.splice(best.position, 0, { lat: best.poi.lat, lng: best.poi.lng, poi: best.poi });
  return { waypoints: next, poi: best.poi };
}

// Adjusts waypoints until the route fits [minLen, maxLen] and passes enough POIs; keeps the best attempt.
async function refine({ start, end, waypoints, candidates, minLen, maxLen, required, routeFn, signal }) {
  let current = [...waypoints];
  const cache = new Map();
  const banned = new Set(); // POIs that made the route too long; never re-added, which prevents cycles
  let lastAdded = null;
  let best = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    signal?.throwIfAborted();
    const key = current.map((w) => w.poi?.id ?? `${w.lat},${w.lng}`).join("|");
    if (!cache.has(key)) {
      const [found] = await routeFn([start, ...current, end]);
      cache.set(key, found);
    }
    const route = cache.get(key);
    const forced = current.filter((w) => w.poi).map((w) => w.poi);
    const stops = collectStops(route.coords, candidates, forced);

    const tooLong = route.distance > maxLen;
    const tooShort = route.distance < minLen;
    const missing = Math.max(0, required - stops.length);
    const lengthPenalty = tooLong
      ? (route.distance - maxLen) / maxLen
      : tooShort
        ? (minLen - route.distance) / minLen
        : 0;
    const penalty = lengthPenalty + missing * 0.05;
    if (!best || penalty < best.penalty) best = { route, stops, penalty };
    if (penalty === 0) break;

    let next;
    const justAdded = lastAdded && current.find((w) => w.poi?.id === lastAdded);
    if (tooLong && justAdded) {
      banned.add(lastAdded);
      next = current.filter((w) => w !== justAdded);
      lastAdded = null;
    } else if (tooLong) {
      const count = Math.max(1, Math.round((current.length * (route.distance - maxLen)) / route.distance));
      next = removeWorst(current, start, end, count);
      if (next.length === current.length) break;
      for (const w of current) if (w.poi && !next.includes(w)) banned.add(w.poi.id);
    } else {
      const skip = new Set([...stops.map((poi) => poi.id), ...forced.map((poi) => poi.id), ...banned]);
      const wantedExtra = tooShort ? (minLen + maxLen) / 2 - route.distance : 0;
      const inserted = insertBest(current, start, end, candidates, skip, wantedExtra);
      if (!inserted) break;
      next = inserted.waypoints;
      lastAdded = inserted.poi.id;
    }
    current = next;
  }
  return best;
}

// One waypoint per slice of the start->end axis, preferring POIs that cost the least detour.
function pickSpread(pois, start, end, count) {
  const direct = haversine(start, end);
  const scored = pois.map((poi) => ({
    poi,
    t: Math.min(1, Math.max(0, axisPosition(start, end, poi).t)),
    detour: haversine(start, poi) + haversine(poi, end) - direct,
  }));

  const chosen = new Map();
  for (let i = 0; i < count; i++) {
    const lo = i / count;
    const hi = (i + 1) / count;
    const inSlice = scored
      .filter((s) => s.t >= lo && (s.t < hi || (i === count - 1 && s.t <= hi)))
      .sort((a, b) => a.detour - b.detour);
    if (inSlice[0]) chosen.set(inSlice[0].poi.id, inSlice[0]);
  }
  for (const s of [...scored].sort((a, b) => a.detour - b.detour)) {
    if (chosen.size >= count) break;
    chosen.set(s.poi.id, s);
  }
  return [...chosen.values()]
    .sort((a, b) => a.t - b.t)
    .map(({ poi }) => ({ lat: poi.lat, lng: poi.lng, poi }));
}

function overlapFraction(route, other) {
  const sampled = route.filter((_, i) => i % 5 === 0);
  const near = sampled.filter((point) => nearestOnPath(point, other).distance <= 40).length;
  return near / sampled.length;
}

function buildRoute(id, label, route, stops, shortestM, ctx) {
  const required = requiredStops(route.distance);
  const cap = Math.max(required, Math.ceil((3 * route.distance) / 1000));
  const limited = evenlySample(stops, cap);
  const ratio = shortestM ? route.distance / shortestM : null;
  return {
    id,
    label,
    distanceM: route.distance,
    durationS: route.duration,
    coords: route.coords,
    ratio,
    required,
    stops: pickTasks(limited, {
      tasks: ctx.tasks,
      themes: ctx.themes,
      budget: ctx.budget,
      random: ctx.random,
    }),
  };
}

function warningsFor(route, { lengthWindow }) {
  const warnings = [];
  if (lengthWindow && route.ratio !== null && (route.ratio < MIN_RATIO || route.ratio > MAX_RATIO)) {
    warnings.push(
      `${route.label}: reitti on ${Math.round((route.ratio - 1) * 100)} % lyhintä reittiä pidempi (tavoite 10–25 %).`
    );
  }
  if (route.stops.length < route.required) {
    warnings.push(
      `${route.label}: reitiltä löytyi vain ${route.stops.length} rastia (tavoite vähintään ${route.required}).`
    );
  }
  return warnings;
}

// Returns the area's POIs; builds the router from the same download unless one was injected (tests).
async function loadArea(ctx, bounds, themes) {
  const options = {
    signal: ctx.signal,
    onRetry: () => ctx.progress("Palvelin on kiireinen, yritetään uudelleen…"),
  };
  if (ctx.routeFn) return ctx.fetchPoisFn(bounds, themes, options);

  ctx.progress("Haetaan karttadataa…");
  const { graph, pois } = await ctx.fetchAreaFn(bounds, themes, options);
  ctx.routeFn = createRouter(graph).route;
  return pois;
}

async function planDestination(state, ctx) {
  const { progress, signal } = ctx;
  const start = state.location;
  const end = state.target;
  const direct = haversine(start, end);
  if (direct > MAX_DESTINATION_M) {
    throw new Error("Kohde on liian kaukana. Valitse kohde enintään 5 km päästä.");
  }

  const bounds = ellipseBounds(start, end, direct * TORTUOSITY_ESTIMATE * MAX_RATIO);
  const fetched = await loadArea(ctx, bounds, state.themes);
  const routeFn = ctx.routeFn;

  progress("Lasketaan lyhintä reittiä…");
  const baseRoutes = await routeFn([start, end], { alternatives: true });
  const shortest = baseRoutes[0];
  const shortestM = shortest.distance;
  const minLen = shortestM * MIN_RATIO;
  const maxLen = shortestM * MAX_RATIO;

  // Road routes through a POI are at least as long as the straight-line detour, so this is a safe prefilter.
  const reachable = Math.max(maxLen * 0.85, haversine(start, end) * 1.05);
  const pois = dedupe(fetched.filter((poi) => haversine(start, poi) + haversine(poi, end) <= reachable));

  progress("Suunnitellaan reittiä…");
  const required = requiredStops(shortestM * ((MIN_RATIO + MAX_RATIO) / 2));
  const initialA = pickSpread(pois, start, end, Math.min(pois.length, Math.ceil(required * 0.6)));
  const resultA = await refine({
    start, end, waypoints: initialA, candidates: pois, minLen, maxLen, required, routeFn, signal,
  });
  const routeA = buildRoute("A", "Reitti A", resultA.route, resultA.stops, shortestM, ctx);
  const routes = [routeA];

  progress("Etsitään vaihtoehtoista reittiä…");
  const usedIds = new Set(routeA.stops.map((s) => s.poi.id));
  let routeB = null;

  for (const alt of baseRoutes.slice(1)) {
    const altStops = collectStops(alt.coords, pois, []);
    const altRatio = alt.distance / shortestM;
    const fits = altRatio >= MIN_RATIO && altRatio <= MAX_RATIO && altStops.length >= requiredStops(alt.distance);
    if (fits && overlapFraction(alt.coords, routeA.coords) < ALT_MAX_OVERLAP) {
      routeB = buildRoute("B", "Reitti B", alt, altStops, shortestM, ctx);
      break;
    }
  }

  if (!routeB) {
    const sides = routeA.stops.map((s) => axisPosition(start, end, s.poi).side);
    const sideA = Math.sign(sides.reduce((sum, side) => sum + side, 0));
    let pool = pois.filter((poi) => !usedIds.has(poi.id) && axisPosition(start, end, poi).side === -sideA);
    if (pool.length < required) pool = pois.filter((poi) => !usedIds.has(poi.id));
    if (pool.length === 0) pool = pois;

    if (pool.length > 0) {
      const initialB = pickSpread(pool, start, end, Math.min(pool.length, Math.ceil(required * 0.6)));
      const resultB = await refine({
        start, end, waypoints: initialB, candidates: pool, minLen, maxLen, required, routeFn, signal,
      });
      routeB = buildRoute("B", "Reitti B", resultB.route, resultB.stops, shortestM, ctx);
    }
  }
  if (routeB) routes.push(routeB);

  return { mode: "destination", shortestM, routes };
}

function ringWaypoints(start, radius, bearing, pois) {
  const center = destinationPoint(start, bearing, radius);
  const used = new Set();
  return [1, 2, 3].map((quarter) => {
    const point = destinationPoint(center, bearing + Math.PI + (quarter * Math.PI) / 2, radius);
    let nearest = null;
    let nearestDistance = radius * 0.6;
    for (const poi of pois) {
      const distance = haversine(point, poi);
      if (!used.has(poi.id) && distance < nearestDistance) {
        nearest = poi;
        nearestDistance = distance;
      }
    }
    if (!nearest) return point;
    used.add(nearest.id);
    return { lat: nearest.lat, lng: nearest.lng, poi: nearest };
  });
}

async function planLoop(state, ctx) {
  const { progress, signal, random } = ctx;
  const start = state.location;
  const targetM = state.distanceKm * 1000;
  if (targetM > MAX_LOOP_M) throw new Error("Lenkki on liian pitkä. Valitse enintään 12 km.");
  const minLen = targetM * (1 - LOOP_TOLERANCE);
  const maxLen = targetM * (1 + LOOP_TOLERANCE);

  let radius = targetM / (2 * Math.PI * 1.3);
  const bounds = boundsAround(start, radius * 3);
  const fetched = await loadArea(ctx, bounds, state.themes);
  const routeFn = ctx.routeFn;
  const pois = dedupe(fetched);

  progress("Suunnitellaan lenkkiä…");
  const bearing = random() * 2 * Math.PI;
  let waypoints;
  for (let i = 0; i < 3; i++) {
    signal?.throwIfAborted();
    waypoints = ringWaypoints(start, radius, bearing, pois);
    const [route] = await routeFn([start, ...waypoints, start]);
    const ratio = route.distance / targetM;
    if (Math.abs(ratio - 1) <= LOOP_PRESCALE_TOLERANCE) break;
    radius /= ratio;
  }

  const required = requiredStops(targetM);
  const result = await refine({
    start, end: start, waypoints, candidates: pois, minLen, maxLen, required, routeFn, signal,
  });
  const route = buildRoute("A", "Lenkki", result.route, result.stops, null, ctx);
  return { mode: "loop", shortestM: null, routes: [route] };
}

export async function planRoutes(state, deps = {}) {
  const ctx = {
    routeFn: deps.fetchRoutes ?? null,
    fetchAreaFn: deps.fetchArea ?? defaultFetchArea,
    fetchPoisFn: deps.fetchPois ?? defaultFetchPois,
    progress: deps.onProgress ?? (() => {}),
    signal: deps.signal,
    random: deps.random ?? Math.random,
    tasks: deps.tasks ?? defaultTasks,
    themes: state.themes,
    budget: state.budget,
  };

  const plan = state.mode === "loop" ? await planLoop(state, ctx) : await planDestination(state, ctx);

  const warnings = plan.routes.flatMap((route) => warningsFor(route, { lengthWindow: plan.mode === "destination" }));
  if (plan.routes.every((route) => route.stops.length === 0)) {
    warnings.unshift("Alueelta ei löytynyt valitsemiasi kohteita. Kokeile toista teemaa tai aluetta.");
  }
  return { ...plan, warnings };
}
