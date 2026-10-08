import { buildGraph } from "./graph.js";
import { parseElements, poiStatement, runQuery } from "./overpass.js";

const HIGHWAYS = [
  "footway",
  "path",
  "pedestrian",
  "steps",
  "living_street",
  "residential",
  "service",
  "unclassified",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
  "cycleway",
  "track",
];

export function networkStatement(bounds) {
  const bbox = [bounds.south, bounds.west, bounds.north, bounds.east].join(",");
  return `way["highway"~"^(${HIGHWAYS.join("|")})$"](${bbox});out geom qt;`;
}

// One request for both the walking network and the POIs: busy public servers rate-limit back-to-back queries.
export async function fetchArea(bounds, themes, options = {}) {
  const query = `[out:json][timeout:60];${networkStatement(bounds)}${poiStatement(bounds, themes)}`;
  const data = await runQuery(query, { timeoutMs: 70000, ...options });
  const elements = data.elements ?? [];

  const graph = buildGraph(elements);
  if (graph.main.length === 0) throw new Error("Alueelta ei löytynyt kävelyverkkoa");
  return { graph, pois: parseElements(elements, themes) };
}
