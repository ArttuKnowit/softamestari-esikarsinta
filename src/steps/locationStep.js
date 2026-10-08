import L from "leaflet";
import { createMap, DEFAULT_CENTER } from "../map.js";

// Step 1: pick and confirm the start location. Returns a cleanup function.
export function renderLocationStep(container, state, { onChange }) {
  container.innerHTML = `
    <h2>Vahvista sijaintisi</h2>
    <p>Napauta karttaa tai käytä laitteen sijaintia ja vahvista valinta.</p>
    <div class="map"></div>
    <div class="button-row">
      <button type="button" class="secondary" id="use-my-location">Käytä sijaintiani</button>
      <button type="button" id="confirm-location" disabled>Vahvista sijainti</button>
    </div>
    <p class="location-summary" id="location-summary"></p>
  `;

  const summary = container.querySelector("#location-summary");
  const confirmButton = container.querySelector("#confirm-location");
  const geolocateButton = container.querySelector("#use-my-location");

  const center = state.location
    ? [state.location.lat, state.location.lng]
    : DEFAULT_CENTER;

  const map = createMap(container.querySelector(".map"), center);
  let marker = state.location ? L.marker(center).addTo(map) : null;
  let pendingLatLng = state.location ? L.latLng(center) : null;

  function setPending(latlng) {
    pendingLatLng = latlng;
    if (marker) {
      marker.setLatLng(latlng);
    } else {
      marker = L.marker(latlng).addTo(map);
    }
    confirmButton.disabled = false;
  }

  function updateSummary() {
    summary.textContent = state.location
      ? `Vahvistettu sijainti: ${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}`
      : "";
  }

  map.on("click", (event) => setPending(event.latlng));

  geolocateButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      summary.textContent = "Selain ei tue paikannusta.";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latlng = L.latLng(coords.latitude, coords.longitude);
        setPending(latlng);
        map.setView(latlng, 15);
      },
      () => {
        summary.textContent = "Sijaintia ei voitu hakea. Valitse se kartalta.";
      }
    );
  });

  confirmButton.addEventListener("click", () => {
    if (!pendingLatLng) return;
    state.location = { lat: pendingLatLng.lat, lng: pendingLatLng.lng };
    updateSummary();
    onChange(true);
  });

  updateSummary();
  onChange(Boolean(state.location));

  return () => map.remove();
}
