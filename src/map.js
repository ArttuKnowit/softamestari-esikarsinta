import L from "leaflet";
import "leaflet/dist/leaflet.css";

export const DEFAULT_CENTER = [60.1699, 24.9384]; // Helsinki

export function createMap(element, center = DEFAULT_CENTER, zoom = 13) {
  const map = L.map(element).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  return map;
}
