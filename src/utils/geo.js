const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function boundsAround(center, radiusM) {
  const dLat = toDeg(radiusM / EARTH_RADIUS_M);
  const dLng = dLat / Math.cos(toRad(center.lat));
  return {
    south: center.lat - dLat,
    west: center.lng - dLng,
    north: center.lat + dLat,
    east: center.lng + dLng,
  };
}

// Box containing every point whose distance to a plus distance to b is at most maxSum.
export function ellipseBounds(a, b, maxSum) {
  const semiMajor = maxSum / 2;
  const halfFoci = haversine(a, b) / 2;
  const margin = Math.sqrt(Math.max(semiMajor ** 2 - halfFoci ** 2, 0));
  const dLat = toDeg(margin / EARTH_RADIUS_M);
  const dLng = dLat / Math.cos(toRad((a.lat + b.lat) / 2));
  return {
    south: Math.min(a.lat, b.lat) - dLat,
    west: Math.min(a.lng, b.lng) - dLng,
    north: Math.max(a.lat, b.lat) + dLat,
    east: Math.max(a.lng, b.lng) + dLng,
  };
}

// Flat-earth approximation; fine for the few-kilometre distances used here.
export function destinationPoint(origin, bearingRad, distanceM) {
  const dLat = toDeg((distanceM * Math.cos(bearingRad)) / EARTH_RADIUS_M);
  const dLng = toDeg(
    (distanceM * Math.sin(bearingRad)) / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat)))
  );
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

export function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function toLocal(origin, point, cosLat) {
  return {
    x: toRad(point.lng - origin.lng) * cosLat * EARTH_RADIUS_M,
    y: toRad(point.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

// Distance from `point` to a polyline, plus the fractional segment index of the closest spot.
export function nearestOnPath(point, path) {
  const cosLat = Math.cos(toRad(point.lat));
  let prev = toLocal(point, path[0], cosLat);
  let best = { distance: Math.hypot(prev.x, prev.y), index: 0 };

  for (let i = 1; i < path.length; i++) {
    const cur = toLocal(point, path[i], cosLat);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(prev.x * dx + prev.y * dy) / len2));
    const distance = Math.hypot(prev.x + t * dx, prev.y + t * dy);
    if (distance < best.distance) best = { distance, index: i - 1 + t };
    prev = cur;
  }
  return best;
}

// Position of `p` along the a->b axis (0 at a, 1 at b) and which side of the line it is on.
export function axisPosition(a, b, p) {
  const cosLat = Math.cos(toRad(a.lat));
  const ab = toLocal(a, b, cosLat);
  const ap = toLocal(a, p, cosLat);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 === 0) return { t: 0, side: 0 };
  return {
    t: (ap.x * ab.x + ap.y * ab.y) / len2,
    side: Math.sign(ab.x * ap.y - ab.y * ap.x),
  };
}

// Splits a polyline at a fractional segment index (as returned by nearestOnPath) into walked and remaining parts.
export function splitPath(coords, index) {
  if (index >= coords.length - 1) return { done: coords, rest: [coords[coords.length - 1]] };
  const i = Math.max(0, Math.floor(index));
  const t = index - i;
  const point = {
    lat: coords[i].lat + (coords[i + 1].lat - coords[i].lat) * t,
    lng: coords[i].lng + (coords[i + 1].lng - coords[i].lng) * t,
  };
  return { done: [...coords.slice(0, i + 1), point], rest: [point, ...coords.slice(i + 1)] };
}
