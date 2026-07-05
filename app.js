const DEFAULT_CSV = "data/locations.csv";
const DEFAULT_GEOJSON = "data/new_marine_zones.geojson";
const BOUNDARY_REVIEW_MILES = 1.0;

let map;
let points = [];
let zoneGeojson = null;
let zoneLayer = null;
let markerLayer = L.layerGroup();
let selectedMarker = null;
let cursorReadoutEl = null;

const statusEl = document.getElementById("status");
const selectedEl = document.getElementById("selectedPoint");
const zoneSummaryEl = document.getElementById("zoneSummary");

init();

async function init() {
  map = L.map("map", { preferCanvas: true }).setView([29.6, -89.7], 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  markerLayer.addTo(map);
  addCursorReadoutControl();

  map.on("mousemove", (evt) => {
    updateCursorReadout(evt.latlng);
  });

  map.on("mouseout", () => {
    if (cursorReadoutEl) {
      cursorReadoutEl.innerHTML = `
        <div class="cursor-title">Cursor Location</div>
        <div class="cursor-muted">Move over the map for live lat/lon.</div>
      `;
    }
  });

  map.on("click", (evt) => {
    openNewPointPopup(evt.latlng);
  });

  document.getElementById("geojsonFile").addEventListener("change", handleGeojsonUpload);
  document.getElementById("csvFile").addEventListener("change", handleCsvUpload);
  document.getElementById("exportCsv").addEventListener("click", exportSupervisorCsv);
  document.getElementById("exportWorkingCsv").addEventListener("click", exportWorkingCsv);

  await loadDefaultFiles();
}

function addCursorReadoutControl() {
  const CursorControl = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd: function () {
      const div = L.DomUtil.create("div", "cursor-readout leaflet-control");
      div.innerHTML = `
        <div class="cursor-title">Cursor Location</div>
        <div class="cursor-muted">Move over the map for live lat/lon.</div>
      `;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      cursorReadoutEl = div;
      return div;
    }
  });
  map.addControl(new CursorControl());
}

function updateCursorReadout(latlng) {
  if (!cursorReadoutEl) return;

  const zone = getZoneFeatureForLatLng(latlng);
  const zoneId = zone ? getZoneId(zone) : "NO_ZONE";
  const zoneName = zone ? getZoneName(zone) : "Outside loaded zones";

  cursorReadoutEl.innerHTML = `
    <div class="cursor-title">Cursor Location</div>
    <div><b>Lat:</b> ${latlng.lat.toFixed(5)}</div>
    <div><b>Lon:</b> ${latlng.lng.toFixed(5)}</div>
    <div><b>Zone:</b> ${escapeHtml(zoneId)}</div>
    <div class="cursor-muted">${escapeHtml(zoneName || "")}</div>
    <div class="cursor-hint">Click map to add a point here.</div>
  `;
}

async function loadDefaultFiles() {
  const messages = [];

  try {
    const csvText = await fetch(DEFAULT_CSV, { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("CSV not found");
      return r.text();
    });
    loadCsvText(csvText);
    messages.push(`Loaded ${points.length} locations from ${DEFAULT_CSV}.`);
  } catch (err) {
    messages.push(`No default location CSV loaded yet.`);
  }

  try {
    const gj = await fetch(DEFAULT_GEOJSON, { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("GeoJSON not found");
      return r.json();
    });
    if (gj.features && gj.features.length > 0) {
      loadZoneGeojson(gj);
      messages.push(`Loaded ${gj.features.length} marine zone polygons from ${DEFAULT_GEOJSON}.`);
    } else {
      messages.push(`Default zone GeoJSON is empty. Use Load Zone GeoJSON.`);
    }
  } catch (err) {
    messages.push(`No default zone GeoJSON loaded yet. Use Load Zone GeoJSON.`);
  }

  statusEl.innerHTML = messages.join("<br>");
  assignZonesToAllPoints();
  renderMarkers();
  updateZoneSummary();
}

function handleGeojsonUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const gj = JSON.parse(reader.result);
      loadZoneGeojson(gj);
      assignZonesToAllPoints();
      renderMarkers();
      updateZoneSummary();
      statusEl.innerHTML = `Loaded ${gj.features?.length || 0} marine zone polygons from ${file.name}.`;
    } catch (err) {
      alert(`Could not read GeoJSON: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function handleCsvUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    loadCsvText(reader.result);
    assignZonesToAllPoints();
    renderMarkers();
    updateZoneSummary();
    statusEl.innerHTML = `Loaded ${points.length} locations from ${file.name}.`;
  };
  reader.readAsText(file);
}

function loadCsvText(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, "_")
  });

  points = parsed.data
    .map((row, idx) => normalizePoint(row, idx))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function normalizePoint(row, idx) {
  const gmz = cleanGmz(row.old_gmz || row.gm_zone || row["gm-zone"] || row.gmz || "");
  return {
    id: row.id || crypto.randomUUID?.() || `point_${idx}_${Date.now()}`,
    action: cleanAction(row.action || "add"),
    name: (row.name || row.location || "Unnamed point").trim(),
    station_type: (row.station_type || row.type || "").trim(),
    lat: Number(row.lat || row.latitude),
    lon: Number(row.lon || row.lng || row.longitude),
    old_gmz: gmz,
    new_gmz: cleanGmz(row.new_gmz || row.proposed_gmz || ""),
    review_status: (row.review_status || "unreviewed").trim(),
    notes: (row.notes || "").trim(),
    assigned_zone_name: "",
    near_boundary_miles: "",
    problem: ""
  };
}

function cleanAction(value) {
  const v = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["change", "changes", "update"].includes(v)) return "change";
  if (["do_not_change", "no_change", "keep", "unchanged"].includes(v)) return "do_not_change";
  return "add";
}

function cleanGmz(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || raw === "NAN") return "";
  const match = raw.match(/GMZ?[-\s]?(\d{3})/);
  return match ? `GMZ${match[1]}` : raw.replace("GMZ-", "GMZ").replace("GM-", "GMZ");
}

function loadZoneGeojson(gj) {
  zoneGeojson = gj;

  if (zoneLayer) map.removeLayer(zoneLayer);

  zoneLayer = L.geoJSON(gj, {
    style: feature => ({
      color: "#111827",
      weight: 1,
      fillColor: zoneColor(getZoneId(feature)),
      fillOpacity: 0.25
    }),
    onEachFeature: (feature, layer) => {
      const id = getZoneId(feature);
      const name = getZoneName(feature);
      layer.bindTooltip(`<b>${id}</b><br>${name}`, { sticky: true });
    }
  }).addTo(map);

  try {
    map.fitBounds(zoneLayer.getBounds(), { padding: [20, 20] });
  } catch (_) {}
}

function getZoneId(feature) {
  const props = feature?.properties || {};
  const candidates = [
    props.UGC, props.ID, props.ZONE, props.zone, props.Zone,
    props.GMZONE, props.GM_ZONE, props.GMZ, props.STATE_ZONE,
    props.WFO_ZONE, props.LOC_ID, props.NWSZONE
  ];
  for (const candidate of candidates) {
    const cleaned = cleanGmz(candidate);
    if (/^GMZ\d{3}$/.test(cleaned)) return cleaned;
  }
  const blob = JSON.stringify(props).toUpperCase();
  const match = blob.match(/GMZ[-\s]?(\d{3})/);
  return match ? `GMZ${match[1]}` : "UNKNOWN";
}

function getZoneName(feature) {
  const props = feature?.properties || {};
  return props.NAME || props.name || props.Name || props.ZONE_NAME || props.MARINE_ZONE || "";
}

function getZoneFeatureForLatLng(latlng) {
  if (!zoneGeojson?.features?.length) return null;

  const pt = turf.point([latlng.lng, latlng.lat]);
  for (const feature of zoneGeojson.features) {
    if (!feature.geometry) continue;
    try {
      if (turf.booleanPointInPolygon(pt, feature, { ignoreBoundary: false })) {
        return feature;
      }
    } catch (_) {}
  }
  return null;
}

function zoneColor(zoneId) {
  const palette = ["#fde047", "#22c55e", "#a855f7", "#3b82f6", "#f97316", "#14b8a6", "#ef4444", "#84cc16"];
  const num = Number((zoneId || "").replace(/\D/g, "")) || 0;
  return palette[num % palette.length];
}

function assignZonesToAllPoints() {
  points.forEach(assignZoneToPoint);
}

function assignZoneToPoint(p) {
  p.problem = "";
  p.near_boundary_miles = "";

  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
    p.problem = "Invalid lat/lon";
    return;
  }

  if (p.lat < 0 && p.lon < 0) {
    p.problem = "Latitude is negative. Check sign.";
  }

  if (!zoneGeojson?.features?.length) {
    return;
  }

  const found = getZoneFeatureForLatLng({ lat: p.lat, lng: p.lon });

  if (found) {
    p.new_gmz = getZoneId(found);
    p.assigned_zone_name = getZoneName(found);
  } else {
    p.new_gmz = "";
    p.assigned_zone_name = "";
    p.problem = p.problem ? `${p.problem}; Outside all loaded zones` : "Outside all loaded zones";
  }

  const pt = turf.point([p.lon, p.lat]);
  const d = distanceToNearestBoundaryMiles(pt);
  if (Number.isFinite(d)) {
    p.near_boundary_miles = d.toFixed(2);
    if (d <= BOUNDARY_REVIEW_MILES) {
      p.problem = p.problem ? `${p.problem}; within ${BOUNDARY_REVIEW_MILES} mi of boundary` : `Within ${BOUNDARY_REVIEW_MILES} mi of boundary`;
    }
  }
}

function distanceToNearestBoundaryMiles(pt) {
  if (!zoneGeojson?.features?.length) return NaN;
  let min = Infinity;
  for (const feature of zoneGeojson.features) {
    try {
      const line = turf.polygonToLine(feature);
      const d = turf.pointToLineDistance(pt, line, { units: "miles" });
      if (d < min) min = d;
    } catch (_) {}
  }
  return min;
}

function renderMarkers() {
  markerLayer.clearLayers();

  const bounds = [];
  points.forEach(p => {
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 7,
      color: markerStroke(p),
      fillColor: markerFill(p),
      weight: 2,
      fillOpacity: 0.95
    });

    marker.pointId = p.id;
    marker.bindPopup(pointPopupHtml(p));
    marker.on("click", () => selectPoint(p.id));

    marker.on("popupopen", () => wirePopupForm(marker, p));

    marker.addTo(markerLayer);

    // Leaflet circleMarkers are not draggable, so add a hidden draggable marker handle on click.
    marker.on("dblclick", () => makePointDraggable(p));
    bounds.push([p.lat, p.lon]);
  });

  if (bounds.length && !zoneLayer) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function markerFill(p) {
  if (p.problem) return "#dc2626";
  if (p.action === "change") return "#f59e0b";
  if (p.action === "do_not_change") return "#2563eb";
  return "#16a34a";
}

function markerStroke(p) {
  return p.old_gmz && p.new_gmz && p.old_gmz !== p.new_gmz ? "#111827" : "#ffffff";
}

function selectPoint(id) {
  const p = points.find(x => x.id === id);
  if (!p) return;
  selectedEl.innerHTML = pointDetailsHtml(p);
}

function pointDetailsHtml(p) {
  return `
    <div><span class="badge ${p.problem ? "problem" : p.action}">${p.problem ? "review" : p.action}</span></div>
    <p><b>${escapeHtml(p.name)}</b></p>
    <p>${escapeHtml(p.station_type || "")}</p>
    <p>Lat/Lon: ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p>
    <p>Old GMZ: <b>${escapeHtml(p.old_gmz || "")}</b></p>
    <p>New GMZ: <b>${escapeHtml(p.new_gmz || "")}</b></p>
    ${p.assigned_zone_name ? `<p>${escapeHtml(p.assigned_zone_name)}</p>` : ""}
    ${p.near_boundary_miles ? `<p>Nearest boundary: ${p.near_boundary_miles} mi</p>` : ""}
    ${p.problem ? `<p><b>Problem:</b> ${escapeHtml(p.problem)}</p>` : ""}
    ${p.notes ? `<p><b>Notes:</b> ${escapeHtml(p.notes)}</p>` : ""}
    <p class="small-text">Double-click the marker to drag/edit its location.</p>
  `;
}

function pointPopupHtml(p) {
  return `
    <form class="popup-form" data-id="${p.id}">
      <label>Name</label>
      <input name="name" value="${escapeAttr(p.name)}" />
      <label>Station Type</label>
      <input name="station_type" value="${escapeAttr(p.station_type)}" />
      <label>Action</label>
      <select name="action">
        <option value="add" ${p.action === "add" ? "selected" : ""}>add</option>
        <option value="change" ${p.action === "change" ? "selected" : ""}>change</option>
        <option value="do_not_change" ${p.action === "do_not_change" ? "selected" : ""}>do not change</option>
      </select>
      <label>Old GMZ</label>
      <input name="old_gmz" value="${escapeAttr(p.old_gmz)}" />
      <label>New GMZ</label>
      <input name="new_gmz" value="${escapeAttr(p.new_gmz)}" />
      <label>Review Status</label>
      <select name="review_status">
        <option value="unreviewed" ${p.review_status === "unreviewed" ? "selected" : ""}>unreviewed</option>
        <option value="reviewed" ${p.review_status === "reviewed" ? "selected" : ""}>reviewed</option>
        <option value="needs_more_work" ${p.review_status === "needs_more_work" ? "selected" : ""}>needs more work</option>
      </select>
      <label>Notes</label>
      <textarea name="notes">${escapeHtml(p.notes)}</textarea>
      <button type="submit">Save Changes</button>
      <button type="button" class="delete-point">Delete Point</button>
    </form>
  `;
}

function wirePopupForm(marker, p) {
  const el = marker.getPopup().getElement();
  if (!el) return;
  const form = el.querySelector("form.popup-form");
  if (!form) return;

  form.addEventListener("submit", (evt) => {
    evt.preventDefault();
    const data = new FormData(form);
    p.name = data.get("name").trim();
    p.station_type = data.get("station_type").trim();
    p.action = cleanAction(data.get("action"));
    p.old_gmz = cleanGmz(data.get("old_gmz"));
    p.new_gmz = cleanGmz(data.get("new_gmz"));
    p.review_status = data.get("review_status").trim();
    p.notes = data.get("notes").trim();
    assignZoneToPoint(p);
    renderMarkers();
    updateZoneSummary();
    selectPoint(p.id);
  });

  const del = form.querySelector(".delete-point");
  del.addEventListener("click", () => {
    if (!confirm(`Delete ${p.name}?`)) return;
    points = points.filter(x => x.id !== p.id);
    renderMarkers();
    updateZoneSummary();
    selectedEl.innerHTML = "Point deleted.";
  });
}

function openNewPointPopup(latlng) {
  const p = {
    id: crypto.randomUUID?.() || `point_${Date.now()}`,
    action: "add",
    name: "New location",
    station_type: "",
    lat: latlng.lat,
    lon: latlng.lng,
    old_gmz: "",
    new_gmz: "",
    review_status: "unreviewed",
    notes: "",
    assigned_zone_name: "",
    near_boundary_miles: "",
    problem: ""
  };
  assignZoneToPoint(p);

  const popup = L.popup()
    .setLatLng(latlng)
    .setContent(`
      <div class="popup-form">
        <p><b>Add new point here?</b></p>
        <p>Lat/Lon: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</p>
        <p>Assigned zone: <b>${escapeHtml(p.new_gmz || "none")}</b></p>
        <button id="confirmAddPoint">Add point</button>
      </div>
    `)
    .openOn(map);

  setTimeout(() => {
    const btn = document.getElementById("confirmAddPoint");
    if (!btn) return;
    btn.onclick = () => {
      points.push(p);
      renderMarkers();
      updateZoneSummary();
      selectPoint(p.id);
      map.closePopup(popup);
    };
  }, 0);
}

function makePointDraggable(p) {
  const marker = L.marker([p.lat, p.lon], { draggable: true }).addTo(map);
  marker.bindTooltip("Drag me, then release to update point", { permanent: true, direction: "top" }).openTooltip();
  marker.on("dragend", () => {
    const ll = marker.getLatLng();
    p.lat = ll.lat;
    p.lon = ll.lng;
    assignZoneToPoint(p);
    map.removeLayer(marker);
    renderMarkers();
    updateZoneSummary();
    selectPoint(p.id);
  });
}

function updateZoneSummary() {
  const byZone = new Map();
  const problems = [];

  for (const p of points) {
    const zone = p.new_gmz || "NO_ZONE";
    if (!byZone.has(zone)) byZone.set(zone, { total: 0, add: 0, change: 0, keep: 0 });
    const row = byZone.get(zone);
    row.total++;
    if (p.action === "add") row.add++;
    else if (p.action === "change") row.change++;
    else row.keep++;
    if (p.problem) problems.push(p);
  }

  const rows = [...byZone.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  const table = rows.map(([zone, r]) => `
    <tr><td>${escapeHtml(zone)}</td><td>${r.total}</td><td>${r.add}</td><td>${r.change}</td><td>${r.keep}</td></tr>
  `).join("");

  zoneSummaryEl.innerHTML = `
    <p>${points.length} total points. ${problems.length} flagged for review.</p>
    <table class="summary-table">
      <thead><tr><th>Zone</th><th>Total</th><th>Add</th><th>Change</th><th>Keep</th></tr></thead>
      <tbody>${table}</tbody>
    </table>
  `;
}

function exportSupervisorCsv() {
  const rows = points.map(p => ({
    "GM-Zone": p.new_gmz || p.old_gmz || "",
    "Name": p.name,
    "Station Type": p.station_type,
    "lat": roundCoord(p.lat),
    "lon": roundCoord(p.lon),
    "Action": p.action,
    "Review Status": p.review_status,
    "Old GM-Zone": p.old_gmz,
    "Notes": buildNotes(p)
  }));
  downloadCsv(rows, "supervisor_final_locations.csv");
}

function exportWorkingCsv() {
  const rows = points.map(p => ({
    action: p.action,
    name: p.name,
    station_type: p.station_type,
    lat: roundCoord(p.lat),
    lon: roundCoord(p.lon),
    old_gmz: p.old_gmz,
    new_gmz: p.new_gmz,
    assigned_zone_name: p.assigned_zone_name,
    near_boundary_miles: p.near_boundary_miles,
    review_status: p.review_status,
    problem: p.problem,
    notes: p.notes
  }));
  downloadCsv(rows, "working_locations_with_zone_qc.csv");
}

function buildNotes(p) {
  const bits = [];
  if (p.problem) bits.push(p.problem);
  if (p.near_boundary_miles) bits.push(`nearest boundary ${p.near_boundary_miles} mi`);
  if (p.notes) bits.push(p.notes);
  return bits.join("; ");
}

function downloadCsv(rows, filename) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function roundCoord(value) {
  return Number(value).toFixed(5);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
