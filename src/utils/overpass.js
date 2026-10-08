import { THEMES, fallbackName, overpassSelectors, themesOfTags } from "./themes.js";

// Checked for browser access (CORS) and global data; other public mirrors returned 5xx without CORS headers.
const ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const REQUEST_TIMEOUT_MS = 40000;
const RETRY_DELAYS_MS = [3000, 8000];

const bboxString = (bounds) => [bounds.south, bounds.west, bounds.north, bounds.east].join(",");

export function poiStatement(bounds, themes) {
  const bbox = bboxString(bounds);
  const parts = overpassSelectors(themes).map((selector) => `nw${selector}(${bbox});`);
  return `(${parts.join("")});out center qt 1000;`;
}

export function buildQuery(bounds, themes) {
  return `[out:json][timeout:25];${poiStatement(bounds, themes)}`;
}

export function parseElements(elements, themes) {
  const pois = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    const matched = themesOfTags(tags, themes);
    if (lat === undefined || lng === undefined || matched.length === 0) continue;

    const name = tags.name ?? (matched.some((theme) => THEMES[theme].allowUnnamed) ? fallbackName(tags) : null);
    if (!name) continue;
    pois.push({ id: `${element.type}/${element.id}`, lat, lng, name, tags, themes: matched });
  }
  return pois;
}

async function request(endpoint, query, { fetchImpl, signal, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    const data = await response.json();
    // Overpass reports load-shedding as a 200 with a remark and no elements.
    if (data.remark && /error|timed out/i.test(data.remark) && !(data.elements?.length > 0)) {
      throw new Error(`Overpass: ${data.remark}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tries every mirror, then retries the list with growing pauses: 429/504 from busy servers are usually transient.
export async function runQuery(query, { fetchImpl = fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS, onRetry } = {}) {
  let lastError;
  for (let round = 0; round <= RETRY_DELAYS_MS.length; round++) {
    for (const endpoint of ENDPOINTS) {
      signal?.throwIfAborted();
      try {
        return await request(endpoint, query, { fetchImpl, signal, timeoutMs });
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    if (round < RETRY_DELAYS_MS.length) {
      onRetry?.();
      await sleep(RETRY_DELAYS_MS[round]);
    }
  }
  throw new Error(`Karttadatan haku epäonnistui (${lastError?.message ?? "tuntematon virhe"})`);
}

function cacheKey(bounds, themes) {
  const rounded = [bounds.south, bounds.west, bounds.north, bounds.east].map((n) => n.toFixed(4));
  return `pois:${rounded.join(",")}:${[...themes].sort().join("+")}`;
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be full or unavailable; caching is optional.
  }
}

export async function fetchPois(bounds, themes, options = {}) {
  const key = cacheKey(bounds, themes);
  const cached = readCache(key);
  if (cached) return cached;

  const data = await runQuery(buildQuery(bounds, themes), options);
  const pois = parseElements(data.elements ?? [], themes);
  writeCache(key, pois);
  return pois;
}
