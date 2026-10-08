import { haversine } from "./geo.js";

// Walking cost multipliers: steps and busy roads are walkable but unattractive.
const COST_FACTOR = {
  steps: 1.5,
  primary: 1.4,
  primary_link: 1.4,
  secondary: 1.25,
  secondary_link: 1.25,
  track: 1.1,
};

const BLOCKED = new Set(["no", "private"]);
const ALLOWED = new Set(["yes", "designated", "permissive"]);

export function isWalkable(tags) {
  if (BLOCKED.has(tags.foot)) return false;
  if (BLOCKED.has(tags.access) && !ALLOWED.has(tags.foot)) return false;
  return true;
}

// Builds a walking graph from Overpass `out geom` ways, keeping only the largest connected component.
export function buildGraph(elements) {
  const index = new Map();
  const lat = [];
  const lng = [];
  const adj = [];

  const nodeFor = (id, point) => {
    let i = index.get(id);
    if (i === undefined) {
      i = lat.length;
      index.set(id, i);
      lat.push(point.lat);
      lng.push(point.lon);
      adj.push([]);
    }
    return i;
  };

  for (const way of elements) {
    const tags = way.tags ?? {};
    if (way.type !== "way" || !way.nodes || !way.geometry || !isWalkable(tags)) continue;
    const factor = COST_FACTOR[tags.highway] ?? 1;

    for (let k = 1; k < way.nodes.length; k++) {
      const from = way.geometry[k - 1];
      const to = way.geometry[k];
      if (!from || !to) continue;
      const a = nodeFor(way.nodes[k - 1], from);
      const b = nodeFor(way.nodes[k], to);
      if (a === b) continue;
      const len = haversine({ lat: lat[a], lng: lng[a] }, { lat: lat[b], lng: lng[b] });
      adj[a].push({ to: b, len, cost: len * factor });
      adj[b].push({ to: a, len, cost: len * factor });
    }
  }

  return { lat, lng, adj, size: lat.length, main: largestComponent(adj) };
}

function largestComponent(adj) {
  const seen = new Uint8Array(adj.length);
  let best = [];
  for (let start = 0; start < adj.length; start++) {
    if (seen[start]) continue;
    const component = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const node = stack.pop();
      component.push(node);
      for (const { to } of adj[node]) {
        if (!seen[to]) {
          seen[to] = 1;
          stack.push(to);
        }
      }
    }
    if (component.length > best.length) best = component;
  }
  return best;
}

// Flat-earth squared distance; only used for ranking and as an A* heuristic.
function approxDistance(graph, i, lat, lng, cosLat) {
  const dy = (graph.lat[i] - lat) * 111320;
  const dx = (graph.lng[i] - lng) * 111320 * cosLat;
  return Math.hypot(dx, dy);
}

export function nearestNode(graph, point) {
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  let best = -1;
  let bestDistance = Infinity;
  for (const i of graph.main) {
    const distance = approxDistance(graph, i, point.lat, point.lng, cosLat);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best === -1 ? null : { index: best, distance: bestDistance };
}

export const edgeKey = (graph, a, b) => a * graph.size + b;

class MinHeap {
  constructor() {
    this.priorities = [];
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, item) {
    let i = this.items.length;
    this.priorities.push(priority);
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.priorities[i] = this.priorities[parent];
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.priorities[i] = priority;
    this.items[i] = item;
  }

  pop() {
    const top = this.items[0];
    const lastPriority = this.priorities.pop();
    const lastItem = this.items.pop();
    const n = this.items.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && this.priorities[child + 1] < this.priorities[child]) child++;
        if (this.priorities[child] >= lastPriority) break;
        this.priorities[i] = this.priorities[child];
        this.items[i] = this.items[child];
        i = child;
      }
      this.priorities[i] = lastPriority;
      this.items[i] = lastItem;
    }
    return top;
  }
}

// A* over the walking graph. `penalties` maps edgeKey -> cost multiplier (used to find alternatives).
export function shortestPath(graph, from, to, penalties = null) {
  const n = graph.size;
  const cost = new Float64Array(n).fill(Infinity);
  const length = new Float64Array(n);
  const previous = new Int32Array(n).fill(-1);
  const goalLat = graph.lat[to];
  const goalLng = graph.lng[to];
  const cosLat = Math.cos((goalLat * Math.PI) / 180);

  const heap = new MinHeap();
  cost[from] = 0;
  heap.push(approxDistance(graph, from, goalLat, goalLng, cosLat), from);

  while (heap.size > 0) {
    const current = heap.pop();
    if (current === to) break;
    for (const edge of graph.adj[current]) {
      const multiplier = penalties?.get(edgeKey(graph, current, edge.to)) ?? 1;
      const next = cost[current] + edge.cost * multiplier;
      if (next < cost[edge.to]) {
        cost[edge.to] = next;
        length[edge.to] = length[current] + edge.len;
        previous[edge.to] = current;
        heap.push(next + approxDistance(graph, edge.to, goalLat, goalLng, cosLat), edge.to);
      }
    }
  }

  if (cost[to] === Infinity) return null;
  const nodes = [];
  for (let node = to; node !== -1; node = previous[node]) nodes.push(node);
  nodes.reverse();
  return { nodes, length: length[to] };
}
