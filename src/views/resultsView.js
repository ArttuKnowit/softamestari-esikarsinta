import L from "leaflet";
import { createMap } from "../map.js";
import { launchConfetti } from "../utils/confetti.js";
import { nearestOnPath, splitPath } from "../utils/geo.js";
import { planRoutes } from "../utils/routePlanner.js";
import { playCling, playJingle } from "../utils/sounds.js";

const ALT_ROUTE_COLOR = "#c8553d";
const DONE_COLOR = "#2f9e44";

const icon = (paths) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  distance: icon('<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'),
  time: icon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  stops: icon('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
  extra: icon('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>'),
  cost: icon('<path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>'),
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function numberedIcon(number, done = false) {
  return L.divIcon({
    className: "poi-icon",
    html: `<span class="poi-marker${done ? " done" : ""}">${done ? "✓" : number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

// OSM names are user-generated, so popups and lists are built with textContent rather than HTML strings.
function popupContent(stop) {
  const box = element("div", "poi-popup");
  box.append(element("strong", "", stop.poi.name), element("p", "", stop.task.text));
  return box;
}

// Shows the planned routes for `state`. Returns { destroy } for cleanup.
export function showResults(container, state, { onRestart }) {
  container.innerHTML = `
    <header class="results-header">
      <h2>Seikkailusi</h2>
      <div class="route-tabs" role="tablist" hidden></div>
    </header>
    <div class="map-frame loading"><div class="map"></div></div>
    <section class="results-panel">
      <p class="status" role="status"></p>
      <div class="warnings"></div>
      <table class="route-stats" hidden></table>
      <ol class="task-list"></ol>
    </section>
    <div class="button-row">
      <button type="button" class="secondary" id="restart">Aloita alusta</button>
      <button type="button" id="retry" hidden>Yritä uudelleen</button>
    </div>
  `;

  const frame = container.querySelector(".map-frame");
  const tabs = container.querySelector(".route-tabs");
  const status = container.querySelector(".status");
  const warnings = container.querySelector(".warnings");
  const stats = container.querySelector(".route-stats");
  const taskList = container.querySelector(".task-list");
  const retryButton = container.querySelector("#retry");

  const map = createMap(container.querySelector(".map"), [state.location.lat, state.location.lng]);
  const layer = L.layerGroup().addTo(map);
  let controller = null;
  let plan = null;
  let active = null; // the route currently drawn, with handles for updating its progress
  let jingleTimer = null;
  const completed = new Map(); // route id -> Set of finished stop indexes

  function renderStats(columns) {
    const headRow = document.createElement("tr");
    const valueRow = document.createElement("tr");
    for (const { icon: iconHtml, label, value } of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      th.innerHTML = `${iconHtml}<span>${label}</span>`; // constants only, no OSM data
      headRow.append(th);
      valueRow.append(element("td", "", value));
    }
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    thead.append(headRow);
    tbody.append(valueRow);
    stats.replaceChildren(thead, tbody);
    stats.hidden = false;
  }

  function completedSet(route) {
    if (!completed.has(route.id)) completed.set(route.id, new Set());
    return completed.get(route.id);
  }

  function statColumns(route, doneCount) {
    const columns = [
      { icon: ICONS.distance, label: "Matka", value: `${(route.distanceM / 1000).toFixed(1)} km` },
      { icon: ICONS.time, label: "Kesto", value: `${Math.max(1, Math.round(route.durationS / 60))} min` },
      { icon: ICONS.stops, label: "Rastit", value: `${doneCount}/${route.stops.length}` },
    ];
    if (plan.shortestM !== null) {
      const extraKm = Math.max(0, route.distanceM - plan.shortestM) / 1000;
      columns.push({ icon: ICONS.extra, label: "Lisämatka", value: `+${extraKm.toFixed(1)} km` });
    }
    const cost = route.stops.reduce((sum, stop) => sum + stop.task.cost, 0);
    if (cost > 0) columns.push({ icon: ICONS.cost, label: "Kulut", value: `~${cost} €` });
    return columns;
  }

  // Colours the line up to the furthest finished task and syncs markers, checkboxes and stats.
  function refreshProgress() {
    const { route, positions, markers, rows, doneLine } = active;
    const done = completedSet(route);
    const complete = route.stops.length > 0 && done.size === route.stops.length;

    if (done.size === 0) {
      doneLine.setLatLngs([]);
    } else {
      const furthest = complete ? route.coords.length - 1 : Math.max(...[...done].map((i) => positions[i]));
      doneLine.setLatLngs(splitPath(route.coords, furthest).done.map(({ lat, lng }) => [lat, lng]));
    }

    route.stops.forEach((_, i) => {
      const isDone = done.has(i);
      markers[i].setIcon(numberedIcon(i + 1, isDone));
      rows[i].item.classList.toggle("done", isDone);
      rows[i].box.checked = isDone;
    });
    renderStats(statColumns(route, done.size));
    status.textContent = complete ? "Kaikki rastit suoritettu – hienoa työtä!" : "";
  }

  function toggleTask(index, checked) {
    const { route } = active;
    const done = completedSet(route);
    const wasComplete = done.size === route.stops.length;
    if (checked) done.add(index);
    else done.delete(index);
    refreshProgress();

    if (!checked) return;
    playCling();
    if (done.size === route.stops.length && !wasComplete) {
      launchConfetti();
      clearTimeout(jingleTimer);
      jingleTimer = setTimeout(playJingle, 400); // let the last cling ring out first
    }
  }

  function selectRoute(index) {
    const route = plan.routes[index];
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    layer.clearLayers();

    const line = L.polyline(
      route.coords.map(({ lat, lng }) => [lat, lng]),
      { color: route.id === "B" ? ALT_ROUTE_COLOR : accent, weight: 5, opacity: 0.9 }
    ).addTo(layer);
    const doneLine = L.polyline([], { color: DONE_COLOR, weight: 6, opacity: 1 }).addTo(layer);

    const endpoints = plan.mode === "destination" ? [state.location, state.target] : [state.location];
    endpoints.forEach((point, i) => {
      L.circleMarker([point.lat, point.lng], { radius: 8, color: accent, fillOpacity: 1 })
        .bindTooltip(i === 0 ? "Lähtö" : "Maali")
        .addTo(layer);
    });

    taskList.replaceChildren();
    const markers = [];
    const rows = [];
    route.stops.forEach((stop, i) => {
      const marker = L.marker([stop.poi.lat, stop.poi.lng], { icon: numberedIcon(i + 1) })
        .bindPopup(popupContent(stop))
        .addTo(layer);
      markers.push(marker);

      const item = element("li", "task");
      const row = element("div", "task-row");
      const text = element("div", "task-text");
      text.append(element("strong", "", stop.poi.name), element("span", "", ` ${stop.task.text}`));

      const check = element("label", "task-check");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute("aria-label", `Merkitse tehdyksi: ${stop.poi.name}`);
      box.addEventListener("change", () => toggleTask(i, box.checked));
      check.addEventListener("click", (event) => event.stopPropagation());
      check.append(box);

      row.append(text, check);
      item.append(row);
      item.addEventListener("click", () => {
        map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
        marker.openPopup();
      });
      taskList.append(item);
      rows.push({ item, box });
    });

    const positions = route.stops.map((stop) => nearestOnPath(stop.poi, route.coords).index);
    active = { route, positions, markers, rows, doneLine };
    refreshProgress();

    tabs.querySelectorAll("button").forEach((button, i) =>
      button.setAttribute("aria-selected", String(i === index))
    );
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
  }

  function renderTabs() {
    tabs.replaceChildren();
    tabs.hidden = plan.routes.length < 2;
    plan.routes.forEach((route, i) => {
      const button = element("button", "route-tab", route.label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => selectRoute(i));
      tabs.append(button);
    });
  }

  async function run() {
    controller?.abort();
    const current = new AbortController();
    controller = current;

    frame.classList.add("loading");
    retryButton.hidden = true;
    stats.hidden = true;
    completed.clear();
    active = null;
    status.textContent = "Käynnistetään…";
    warnings.replaceChildren();
    taskList.replaceChildren();
    layer.clearLayers();

    try {
      plan = await planRoutes(state, {
        signal: current.signal,
        onProgress: (message) => {
          status.textContent = message;
        },
      });
      status.textContent = "";
      renderTabs();
      selectRoute(0);
      plan.warnings.forEach((text) => warnings.append(element("p", "warning", text)));
    } catch (error) {
      if (current.signal.aborted) return;
      status.textContent = `Reitin luonti epäonnistui: ${error.message}`;
      retryButton.hidden = false;
    } finally {
      if (!current.signal.aborted) frame.classList.remove("loading");
    }
  }

  retryButton.addEventListener("click", run);
  container.querySelector("#restart").addEventListener("click", onRestart);
  run();

  return {
    destroy() {
      controller?.abort();
      clearTimeout(jingleTimer);
      map.remove();
      container.replaceChildren();
    },
  };
}
