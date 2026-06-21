import { matchesCollection, onSnapshot } from "./firebase-init.js";
import { computeAllStandings, buildGroupsFromMatches, applyOverrides } from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveBracket } from "./bracket-resolve.js";

let realMatches = [];
let overrides = {};
let simOn = false;

const flag = (team) => FLAGS[team] || "🏳️";
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function decodeOverrides(str) {
  const out = {};
  if (!str) return out;
  for (const part of str.split(",")) {
    const m = part.match(/^([A-L]\d):(\d+)-(\d+)$/);
    if (!m) continue;
    out[m[1]] = { homeScore: Number(m[2]), awayScore: Number(m[3]) };
  }
  return out;
}

function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  const sim = params.get("sim");
  if (sim) {
    overrides = decodeOverrides(sim);
    simOn = true;
  }
}

function teamCellHtml({ team, label, sub }) {
  if (team) {
    return `<div class="bracket-team resolved"><span class="flag">${flag(team)}</span><span class="bteam-name">${escapeHtml(team)}</span></div>`;
  }
  return `<div class="bracket-team pending"><span class="bteam-name">TBD</span><span class="bteam-sub">${escapeHtml(label)}</span></div>`;
}

function fixtureCardHtml(fx) {
  return `
    <div class="bracket-card">
      <div class="bracket-card-head">
        <span class="match-num">Match ${fx.num}</span>
        <span class="match-venue">${escapeHtml(fx.venue)}</span>
      </div>
      ${teamCellHtml(fx.home)}
      <div class="bracket-vs">vs</div>
      ${teamCellHtml(fx.away)}
    </div>`;
}

function render() {
  // Don't render anything until real data has actually arrived — this is
  // what previously caused the page to crash and get stuck on "Loading…".
  if (!realMatches.length) return;

  const merged = applyOverrides(realMatches, overrides);
  const GROUPS = buildGroupsFromMatches(realMatches);
  const { groupStandings, thirdPlace, allGroupsComplete } = computeAllStandings(merged, GROUPS);

  document.body.classList.toggle("sim-on", simOn);
  if (document.getElementById("sim-switch")) {
    document.getElementById("sim-switch").setAttribute("aria-checked", String(simOn));
  }

  const { fixtures, statusNote } = resolveBracket(groupStandings, thirdPlace, allGroupsComplete);

  document.getElementById("bracket-status").textContent = statusNote;
  document.getElementById("bracket-status").style.display = statusNote ? "block" : "none";

  const byDate = {};
  for (const fx of fixtures) {
    if (!byDate[fx.date]) byDate[fx.date] = [];
    byDate[fx.date].push(fx);
  }

  const html = Object.entries(byDate)
    .map(([date, dateFixtures]) => {
      const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const cards = dateFixtures.map(fixtureCardHtml).join("");
      return `<div class="bracket-date-label">${dateLabel}</div><div class="bracket-grid">${cards}</div>`;
    })
    .join("");

  document.getElementById("bracket-content").innerHTML = html;
}

const simSwitch = document.getElementById("sim-switch");
if (simSwitch) {
  simSwitch.addEventListener("click", () => {
    simOn = !simOn;
    const params = new URLSearchParams(location.search);
    if (simOn && Object.keys(overrides).length > 0) {
      params.set("sim", Object.entries(overrides).map(([id, s]) => `${id}:${s.homeScore}-${s.awayScore}`).join(","));
    } else {
      params.delete("sim");
    }
    const qs = params.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    render();
  });
}

loadFromUrl();

onSnapshot(matchesCollection, (snap) => {
  if (snap.empty) {
    document.getElementById("bracket-content").innerHTML =
      `<p style="color:var(--text-muted);">No match data yet — the admin needs to import the schedule from the <a href="admin.html">admin page</a>.</p>`;
    return;
  }
  realMatches = snap.docs.map((d) => d.data());
  render();
});
