import L from "leaflet";
import { createMap, DEFAULT_CENTER } from "../map.js";

const DISTANCE_RANGE = { min: 1, max: 12, step: 1 };

// Step 2: choose a target pin (two routes) or a distance (loop route). Returns a cleanup function.
export function renderTargetStep(container, state, { onChange }) {
  if (!state.mode) state.mode = "destination";
  if (state.distanceKm === undefined) state.distanceKm = 5;

  container.innerHTML = `
    <h2>Minne haluat mennä?</h2>
    <div class="mode-toggle" role="radiogroup">
      <label><input type="radio" name="mode" value="destination" /> Valitse kohde</label>
      <label><input type="radio" name="mode" value="loop" /> Valitse matka</label>
    </div>

    <div id="panel-destination">
      <p>Napauta karttaa merkitäksesi kohteen (enintään 5 km päähän). Saat kaksi erilaista reittiä.</p>
      <div class="map"></div>
      <p class="location-summary" id="target-summary"></p>
    </div>

    <div id="panel-loop">
      <p>Saat lenkin, joka alkaa ja päättyy sijaintiisi.</p>
      <div class="field-group">
        <label for="distance-range">
          Matka
          <output id="distance-output">${state.distanceKm} km</output>
        </label>
        <input
          id="distance-range"
          type="range"
          min="${DISTANCE_RANGE.min}"
          max="${DISTANCE_RANGE.max}"
          step="${DISTANCE_RANGE.step}"
          value="${state.distanceKm}"
        />
      </div>
    </div>
  `;

  const radios = container.querySelectorAll('input[name="mode"]');
  const destinationPanel = container.querySelector("#panel-destination");
  const loopPanel = container.querySelector("#panel-loop");
  const targetSummary = container.querySelector("#target-summary");
  const distanceInput = container.querySelector("#distance-range");
  const distanceOutput = container.querySelector("#distance-output");

  const start = state.location ? [state.location.lat, state.location.lng] : DEFAULT_CENTER;
  const map = createMap(container.querySelector(".map"), start);
  L.circleMarker(start, { radius: 8, color: "#3a8a3a", fillOpacity: 1 })
    .bindTooltip("Lähtö")
    .addTo(map);

  let targetMarker = state.target ? L.marker([state.target.lat, state.target.lng]).addTo(map) : null;

  function isValid() {
    return state.mode === "destination" ? Boolean(state.target) : true;
  }

  function updateTargetSummary() {
    targetSummary.textContent = state.target
      ? `Kohde: ${state.target.lat.toFixed(5)}, ${state.target.lng.toFixed(5)}`
      : "";
  }

  function applyMode() {
    destinationPanel.hidden = state.mode !== "destination";
    loopPanel.hidden = state.mode !== "loop";
    radios.forEach((radio) => {
      radio.checked = radio.value === state.mode;
    });
    if (state.mode === "destination") map.invalidateSize();
    onChange(isValid());
  }

  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      state.mode = radio.value;
      applyMode();
    });
  });

  map.on("click", (event) => {
    state.target = { lat: event.latlng.lat, lng: event.latlng.lng };
    if (targetMarker) {
      targetMarker.setLatLng(event.latlng);
    } else {
      targetMarker = L.marker(event.latlng).addTo(map);
    }
    updateTargetSummary();
    onChange(isValid());
  });

  distanceInput.addEventListener("input", () => {
    state.distanceKm = Number(distanceInput.value);
    distanceOutput.textContent = `${state.distanceKm} km`;
  });

  updateTargetSummary();
  applyMode();

  return () => map.remove();
}
