// Small behavior overrides loaded after app.js.
// This keeps the original app intact while making the marker colors line up with the review workflow.

const REVIEW_COLOR = "#16a34a";
const PROBLEM_COLOR = "#dc2626";
const CHANGE_COLOR = "#f59e0b";
const KEEP_COLOR = "#2563eb";
const ADD_UNREVIEWED_COLOR = "#6b7280";

// Marker color priority:
// 1. reviewed = green, even if the point is near a boundary or otherwise flagged
// 2. needs_more_work / problem = red
// 3. change = orange
// 4. do_not_change = blue
// 5. add / unreviewed = gray
markerFill = function markerFill(p) {
  if (p.review_status === "reviewed") return REVIEW_COLOR;
  if (p.review_status === "needs_more_work" || p.problem) return PROBLEM_COLOR;
  if (p.action === "change") return CHANGE_COLOR;
  if (p.action === "do_not_change") return KEEP_COLOR;
  return ADD_UNREVIEWED_COLOR;
};

pointDetailsHtml = function pointDetailsHtml(p) {
  const badgeClass = p.review_status === "reviewed" ? "reviewed" : (p.problem ? "problem" : p.action);
  const badgeText = p.review_status === "reviewed" ? "reviewed" : (p.problem ? "review" : p.action);

  return `
    <div><span class="badge ${badgeClass}">${badgeText}</span></div>
    <p><b>${escapeHtml(p.name)}</b></p>
    <p>${escapeHtml(p.station_type || "")}</p>
    <p>Lat/Lon: ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p>
    <p>Old GMZ: <b>${escapeHtml(p.old_gmz || "")}</b></p>
    <p>New GMZ: <b>${escapeHtml(p.new_gmz || "")}</b></p>
    <p>Review Status: <b>${escapeHtml(p.review_status || "unreviewed")}</b></p>
    ${p.assigned_zone_name ? `<p>${escapeHtml(p.assigned_zone_name)}</p>` : ""}
    ${p.near_boundary_miles ? `<p>Nearest boundary: ${p.near_boundary_miles} mi</p>` : ""}
    ${p.problem ? `<p><b>Problem/Flag:</b> ${escapeHtml(p.problem)}</p>` : ""}
    ${p.notes ? `<p><b>Notes:</b> ${escapeHtml(p.notes)}</p>` : ""}
    <p class="small-text">Double-click the marker to drag/edit its location.</p>
  `;
};

function injectColorLegend() {
  const sidebar = document.getElementById("sidebar");
  const zoneSummary = document.getElementById("zoneSummary")?.closest("section");
  if (!sidebar || !zoneSummary || document.getElementById("colorLegend")) return;

  const legend = document.createElement("section");
  legend.className = "card small-text";
  legend.id = "colorLegend";
  legend.innerHTML = `
    <h2>Dot Colors</h2>
    <div class="legend-row"><span class="legend-dot reviewed"></span>Reviewed / ready</div>
    <div class="legend-row"><span class="legend-dot problem"></span>Problem or needs more work</div>
    <div class="legend-row"><span class="legend-dot change"></span>Change existing location</div>
    <div class="legend-row"><span class="legend-dot keep"></span>Do not change</div>
    <div class="legend-row"><span class="legend-dot add"></span>New add, unreviewed</div>
    <p class="legend-note">Black outline = old GMZ differs from assigned new GMZ.</p>
  `;

  zoneSummary.insertAdjacentElement("afterend", legend);
}

window.addEventListener("load", () => {
  injectColorLegend();
  if (typeof renderMarkers === "function") renderMarkers();
});
