import { describe, expect, it } from "vitest";
import { axisPosition, boundsAround, ellipseBounds, haversine, nearestOnPath, splitPath } from "./geo.js";
import { buildGraph } from "./graph.js";
import { createRouter } from "./router.js";
import { pickTasks } from "./taskPicker.js";
import { buildQuery, parseElements } from "./overpass.js";
import { MAX_RATIO, MIN_RATIO, planRoutes, requiredStops } from "./routePlanner.js";
import tasks from "./tasks.json";

const START = { lat: 60.17, lng: 24.94 };
const END = { lat: 60.18, lng: 24.96 };

// Grid of cafes around START/END, roughly 150 m apart.
function gridPois() {
  const pois = [];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      pois.push({
        id: `node/${i * 20 + j}`,
        lat: 60.162 + i * 0.0015,
        lng: 24.93 + j * 0.0025,
        name: `Kahvila ${i}-${j}`,
        tags: { amenity: "cafe", name: `Kahvila ${i}-${j}` },
        themes: ["cafes"],
      });
    }
  }
  return pois;
}

// Straight-line routes through the waypoints, so geometry equals the waypoint list.
const fakeRoutes = async (waypoints) => {
  let distance = 0;
  for (let i = 1; i < waypoints.length; i++) distance += haversine(waypoints[i - 1], waypoints[i]) * 1.2;
  return [{ distance, duration: distance / 1.3, coords: waypoints.map(({ lat, lng }) => ({ lat, lng })) }];
};

const deps = { fetchRoutes: fakeRoutes, fetchPois: async () => gridPois(), random: () => 0.5 };

describe("geo", () => {
  it("measures distance and nearest point on a path", () => {
    expect(haversine(START, START)).toBe(0);
    expect(haversine(START, END)).toBeGreaterThan(1000);
    const path = [START, { lat: 60.17, lng: 24.95 }];
    const probe = { lat: 60.1701, lng: 24.945 };
    expect(nearestOnPath(probe, path).distance).toBeLessThan(15);
  });

  it("gives axis position and side", () => {
    const mid = axisPosition(START, END, { lat: 60.175, lng: 24.95 });
    expect(mid.t).toBeCloseTo(0.5, 1);
    const left = axisPosition(START, END, { lat: 60.18, lng: 24.94 }).side;
    const right = axisPosition(START, END, { lat: 60.17, lng: 24.96 }).side;
    expect(left).toBe(-right);
  });

  it("builds bounds around a point", () => {
    const b = boundsAround(START, 1000);
    expect(b.north).toBeGreaterThan(START.lat);
    expect(b.west).toBeLessThan(START.lng);
  });

  it("builds a box that contains both foci", () => {
    const b = ellipseBounds(START, END, 3000);
    expect(b.south).toBeLessThan(START.lat);
    expect(b.north).toBeGreaterThan(END.lat);
    expect(b.west).toBeLessThan(START.lng);
    expect(b.east).toBeGreaterThan(END.lng);
  });
});

describe("tasks", () => {
  it("prefers specific tasks and respects budget", () => {
    const cafe = { name: "Kahvila X", tags: { amenity: "cafe" } };
    const [free] = pickTasks([cafe], { tasks, themes: ["cafes"], budget: 0 });
    expect(free.task.cost).toBe(0);
    const [paid] = pickTasks([cafe], { tasks, themes: ["cafes"], budget: 50, random: () => 0 });
    expect(paid.task.id).toBe("hot-drink");
    expect(paid.task.text).toContain("Kahvila X");
  });
});

describe("overpass", () => {
  it("builds a query and parses elements", () => {
    expect(buildQuery({ south: 1, west: 2, north: 3, east: 4 }, ["cafes"])).toContain('["amenity"="cafe"]["name"]');
    const pois = parseElements(
      [
        { type: "node", id: 1, lat: 1, lon: 2, tags: { name: "A", amenity: "cafe" } },
        { type: "way", id: 2, center: { lat: 3, lon: 4 }, tags: { name: "B", leisure: "park" } },
        { type: "node", id: 3, lat: 1, lon: 2, tags: { amenity: "cafe" } },
        { type: "node", id: 4, lat: 1, lon: 2, tags: { amenity: "drinking_water" } },
      ],
      ["cafes", "nature", "civic"]
    );
    expect(pois.map((p) => p.id)).toEqual(["node/1", "way/2", "node/4"]);
    expect(pois[2].name).toBe("juomavesipiste");
  });
});

describe("planRoutes", () => {
  const base = { location: START, target: END, mode: "destination", themes: ["cafes"], budget: 50 };

  it("plans two destination routes within the length window with enough stops", async () => {
    const plan = await planRoutes(base, deps);
    expect(plan.routes).toHaveLength(2);
    for (const route of plan.routes) {
      expect(route.ratio).toBeGreaterThanOrEqual(MIN_RATIO);
      expect(route.ratio).toBeLessThanOrEqual(MAX_RATIO);
      expect(route.stops.length).toBeGreaterThanOrEqual(requiredStops(route.distanceM));
    }
    expect(plan.warnings).toEqual([]);
  });

  it("plans a loop that returns to the start", async () => {
    const plan = await planRoutes({ ...base, mode: "loop", distanceKm: 3 }, deps);
    const [route] = plan.routes;
    expect(route.distanceM).toBeGreaterThan(2700);
    expect(route.distanceM).toBeLessThan(3300);
    expect(haversine(route.coords[0], route.coords.at(-1))).toBe(0);
    expect(route.stops.length).toBeGreaterThanOrEqual(requiredStops(route.distanceM));
  });

  it("warns when no POIs exist", async () => {
    const plan = await planRoutes(base, { ...deps, fetchPois: async () => [] });
    expect(plan.warnings[0]).toContain("kohteita");
  });
});

// Street grid about 110 m apart; ids are i * 1000 + j so intersections are shared between ways.
function streetGridElements() {
  const rows = 31;
  const cols = 31;
  const point = (i, j) => ({ lat: 60.16 + i * 0.001, lon: 24.92 + j * 0.002 });
  const elements = [];
  let wayId = 1;
  for (let i = 0; i < rows; i++) {
    const js = Array.from({ length: cols }, (_, j) => j);
    elements.push({
      type: "way", id: wayId++, tags: { highway: "residential" },
      nodes: js.map((j) => i * 1000 + j), geometry: js.map((j) => point(i, j)),
    });
  }
  for (let j = 0; j < cols; j++) {
    const is = Array.from({ length: rows }, (_, i) => i);
    elements.push({
      type: "way", id: wayId++, tags: { highway: "footway" },
      nodes: is.map((i) => i * 1000 + j), geometry: is.map((i) => point(i, j)),
    });
  }
  return elements;
}

describe("router", () => {
  const graph = buildGraph(streetGridElements());
  const router = createRouter(graph);

  it("finds a Manhattan-length shortest path and distinct alternatives", async () => {
    const routes = await router.route([START, END], { alternatives: true });
    expect(routes[0].distance).toBeGreaterThan(haversine(START, END));
    expect(routes[0].distance).toBeLessThan(haversine(START, END) * 1.6);
    expect(routes.length).toBeGreaterThan(1);
    expect(routes[1].distance).toBeGreaterThanOrEqual(routes[0].distance);
  });

  it("ignores ways closed to pedestrians", () => {
    const closed = buildGraph([
      { type: "way", id: 1, tags: { highway: "residential", foot: "no" }, nodes: [1, 2], geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 1.001 }] },
    ]);
    expect(closed.main).toHaveLength(0);
  });

  it("rejects endpoints far from the network", async () => {
    await expect(router.route([{ lat: 61, lng: 25 }, END])).rejects.toThrow("tieverkosta");
  });

  it("plans destination and loop routes on the street grid", async () => {
    const gridDeps = { fetchArea: async () => ({ graph, pois: gridPois() }), random: () => 0.5 };
    const base = { location: START, target: END, mode: "destination", themes: ["cafes"], budget: 50 };
    const plan = await planRoutes(base, gridDeps);
    expect(plan.routes[0].ratio).toBeGreaterThan(1);
    expect(plan.routes[0].stops.length).toBeGreaterThan(0);

    const loop = await planRoutes({ ...base, mode: "loop", distanceKm: 3 }, gridDeps);
    const [route] = loop.routes;
    expect(route.distanceM).toBeGreaterThan(2000);
    expect(route.distanceM).toBeLessThan(4000);
    expect(haversine(route.coords[0], route.coords.at(-1))).toBeLessThan(1);
  });
});

describe("splitPath", () => {
  const path = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
  ];

  it("splits at a fractional index with an interpolated point", () => {
    const { done, rest } = splitPath(path, 1.5);
    expect(done).toHaveLength(3);
    expect(done.at(-1)).toEqual({ lat: 0, lng: 1.5 });
    expect(rest).toEqual([{ lat: 0, lng: 1.5 }, { lat: 0, lng: 2 }]);
  });

  it("returns the whole path once the end is reached", () => {
    expect(splitPath(path, 2).done).toEqual(path);
  });
});
