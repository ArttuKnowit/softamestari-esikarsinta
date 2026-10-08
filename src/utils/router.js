import { haversine } from "./geo.js";
import { edgeKey, nearestNode, shortestPath } from "./graph.js";

const WALKING_SPEED_MS = 1.25;
const MAX_ENDPOINT_SNAP_M = 400;
const ALTERNATIVE_PENALTIES = [1.6, 2.2, 3.2, 5];

// Lets the browser paint (e.g. the loading ring) between heavy searches.
const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

// Creates a router over a walking graph; `route` mirrors the shape the planner expects.
export function createRouter(graph) {
  const legCache = new Map();

  function snap(point, isEndpoint) {
    const found = nearestNode(graph, point);
    if (!found || (isEndpoint && found.distance > MAX_ENDPOINT_SNAP_M)) {
      throw new Error("Valittu piste on liian kaukana tunnetusta tieverkosta");
    }
    return found.index;
  }

  function leg(from, to, penalties) {
    if (penalties) return shortestPath(graph, from, to, penalties);
    const key = `${from}>${to}`;
    if (!legCache.has(key)) legCache.set(key, shortestPath(graph, from, to));
    return legCache.get(key);
  }

  function assemble(waypoints, snapped, penalties) {
    const nodes = [];
    let distance = 0;
    for (let i = 0; i < snapped.length - 1; i++) {
      const path = leg(snapped[i], snapped[i + 1], penalties);
      if (!path) throw new Error("Reittiä ei löytynyt kartta-aineistosta");
      distance += path.length;
      nodes.push(...(i === 0 ? path.nodes : path.nodes.slice(1)));
    }

    const point = (i) => ({ lat: graph.lat[i], lng: graph.lng[i] });
    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    const coords = [first, ...nodes.map(point), last];
    distance += haversine(first, coords[1]) + haversine(coords[coords.length - 2], last);
    return { distance, duration: distance / WALKING_SPEED_MS, coords, nodes };
  }

  function penalize(penalties, nodes, factor) {
    for (let i = 1; i < nodes.length; i++) {
      for (const key of [edgeKey(graph, nodes[i - 1], nodes[i]), edgeKey(graph, nodes[i], nodes[i - 1])]) {
        penalties.set(key, (penalties.get(key) ?? 1) * factor);
      }
    }
  }

  // With `alternatives` and two waypoints, extra routes come from penalising the edges already used.
  async function route(waypoints, { alternatives = false } = {}) {
    await yieldToUi();
    const snapped = waypoints.map((waypoint, i) => snap(waypoint, i === 0 || i === waypoints.length - 1));
    const primary = assemble(waypoints, snapped, null);
    const routes = [primary];

    if (alternatives && waypoints.length === 2) {
      const penalties = new Map();
      penalize(penalties, primary.nodes, ALTERNATIVE_PENALTIES[0]);
      for (let i = 0; i < ALTERNATIVE_PENALTIES.length; i++) {
        await yieldToUi();
        const alt = assemble(waypoints, snapped, penalties);
        if (routes.every((existing) => Math.abs(existing.distance - alt.distance) > 5)) routes.push(alt);
        penalize(penalties, alt.nodes, ALTERNATIVE_PENALTIES[Math.min(i + 1, ALTERNATIVE_PENALTIES.length - 1)]);
      }
    }

    return routes.map(({ distance, duration, coords }) => ({ distance, duration, coords }));
  }

  return { route };
}
