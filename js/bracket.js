import { matchesCollection, onSnapshot } from "./firebase-init.js";
import { computeAllStandings, buildGroupsFromMatches, applyOverrides } from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { R32_FIXTURES, THIRD_SLOT_CANDIDATES, resolveThirdPlaceSlots } from "./bracket-data.js";

let realMatches = [];
let overrides = {};
let simOn = false;

const flag = (team) => FLAGS[team] || "🏳️";
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- URL <-> overrides (same scheme as the main tracker, so a sim
// link copied from there still works here if pasted in) ----------

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

// ---------- Slot resolution ----------

function describeSlot(descriptor, groupStandings, slotAssignment) {
  if (descriptor.type === "winner" || descriptor.type === "runnerup") {
    const idx = descriptor.type === "winner" ? 0 : 1;
    const standing = groupStandings[descriptor.group][idx];
    const label = `${descriptor.type === "winner" ? "Winner" : "Runner-up"} Group ${descriptor.group}`;
    if (!standing.groupComplete) return { team: null, label, sub: `Group ${descriptor.group} in progress` };
    if (standing.tiedNote) return { team: null, label, sub: "Tied — insufficient data to separate" };
    return { team: standing.team, label, sub: null };
  }
  // third-place slot
  const candidates = THIRD_SLOT_CANDIDATES[descriptor.slot].join("/");
  const label = `Best 3rd Group ${candidates}`;
  if (!slotAssignment) return { team: null, label, sub: "3rd-place race still in progress" };
  const group = slotAssignment[descriptor.slot];
  const standing = groupStandings[group][2];
  if (standing.tiedNote) return { team: null, label, sub: "Tied — insufficient data to separate" };
  return { team: standing.team, label: `3rd Group ${group}`, sub: null };
}

function teamCellHtml({ team, label, sub }) {
  if (team) {
    return `<div class="bracket-team resolved"><span class="flag">${flag(team)}</span><span class="bteam-name">${escapeHtml(team)}</span></div>`;
  }
  return `<div class="bracket-team pending"><span class="bteam-name">TBD</span><span class="bteam-sub">${escapeHtml(label)}</span></div>`;
}

function fixtureCardHtml(fx, groupStandings, slotAssignment) {
  const home = describeSlot(fx.home, groupStandings, slotAssignment);
  const away = describeSlot(fx.away, groupStandings, slotAssignment);
  return `
    <div class="bracket-card">
      <div class="bracket-card-head">
        <span class="match-num">Match ${fx.num}</span>
        <span class="match-venue">${escapeHtml(fx.venue)}</span>
      </div>
      ${teamCellHtml(home)}
      <div class="bracket-vs">vs</div>
      ${teamCellHtml(away)}
    </div>`;
}

function render() {
  const merged = applyOverrides(realMatches, overrides);
  const GROUPS = buildGroupsFromMatches(realMatches.length ? realMatches : merged);
  const { groupStandings, thirdPlace, allGroupsComplete } = computeAllStandings(merged, GROUPS);

  document.body.classList.toggle("sim-on", simOn);
  if (document.getElementById("sim-switch")) {
    document.getElementById("sim-switch").setAttribute("aria-checked", String(simOn));
  }

  // Resolve which 8 group letters supply a qualifying 3rd-place team, only
  // once every group is complete AND there's no tie straddling the 8th/9th
  // cutoff (same standard the main tracker uses for the 3rd-place race).
  let slotAssignment = null;
  let statusNote = "";
  if (!allGroupsComplete) {
    statusNote = "Bracket will lock in once every group has played all 3 matches. Showing the projection based on current standings.";
  } else {
    const straddles = thirdPlace.some((t) => t.rankStart <= 8 && t.rankEnd > 8);
    if (straddles) {
      statusNote = "The 8th qualifying 3rd-place spot is tied and can't be resolved without fair-play/FIFA-ranking data — third-place slots shown as TBD.";
    } else {
      const qualifyingGroups = thirdPlace.filter((t) => t.rankStart <= 8).map((t) => t.group);
      slotAssignment = resolveThirdPlaceSlots(qualifyingGroups);
      if (!slotAssignment) statusNote = "Couldn't resolve the third-place combination — this shouldn't happen; please report it.";
    }
  }

  document.getElementById("bracket-status").textContent = statusNote;
  document.getElementById("bracket-status").style.display = statusNote ? "block" : "none";

  // Group fixtures by date for a chronological, readable layout.
  const byDate = {};
  for (const fx of R32_FIXTURES) {
    if (!byDate[fx.date]) byDate[fx.date] = [];
    byDate[fx.date].push(fx);
  }

  const html = Object.entries(byDate)
    .map(([date, fixtures]) => {
      const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const cards = fixtures.map((fx) => fixtureCardHtml(fx, groupStandings, slotAssignment)).join("");
      return `<div class="bracket-date-label">${dateLabel}</div><div class="bracket-grid">${cards}</div>`;
    })
    .join("");

  document.getElementById("bracket-content").innerHTML = html;
}

// ---------- Sim toggle (if present on this page) ----------

const simSwitch = document.getElementById("sim-switch");
if (simSwitch) {
  simSwitch.addEventListener("click", () => {
    simOn = !simOn;
    const params = new URLSearchParams(location.search);
    if (simOn && Object.keys(overrides).length > 0) params.set("sim", encodeOverridesForUrl(overrides));
    else params.delete("sim");
    const qs = params.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    render();
  });
}

function encodeOverridesForUrl(o) {
  return Object.entries(o).map(([id, s]) => `${id}:${s.homeScore}-${s.awayScore}`).join(",");
}

// ---------- Boot ----------

loadFromUrl();
render();

onSnapshot(matchesCollection, (snap) => {
  if (snap.empty) {
    document.getElementById("bracket-content").innerHTML =
      `<p style="color:var(--text-muted);">No match data yet — the admin needs to import the schedule from the <a href="admin.html">admin page</a>.</p>`;
    return;
  }
  realMatches = snap.docs.map((d) => d.data());
  render();
});
