import { matchesCollection, knockoutMatchesCollection, onSnapshot } from "./firebase-init.js";
import { computeAllStandings, buildGroupsFromMatches, applyOverrides } from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveKnockoutBracket } from "./bracket-resolve.js";
import { KNOCKOUT_MATCHES, ROUND_LABELS, ROUND_ORDER } from "./bracket-data.js";

let realMatches = [];          // group-stage matches, live from Firestore
let knockoutResults = {};      // { matchNum: {homeScore, awayScore, ...} }, live from Firestore
let groupsLoaded = false;
let knockoutLoaded = false;
let overrides = {};            // local what-if group score overrides
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

// ---------- Rendering ----------

function teamRowHtml(side) {
  if (side.team) {
    return `<div class="bnode-team bnode-resolved"><span class="flag">${flag(side.team)}</span><span class="bnode-name">${escapeHtml(side.team)}</span></div>`;
  }
  return `<div class="bnode-team bnode-pending"><span class="bnode-code">${escapeHtml(side.code)}</span></div>`;
}

function matchNodeHtml(m) {
  const homeScore = m.result ? m.result.homeScore : null;
  const awayScore = m.result ? m.result.awayScore : null;
  const winnerSide = m.winner ? (m.winner === m.home.team ? "home" : "away") : null;
  return `
    <button type="button" class="bracket-node" data-match="${m.num}" aria-label="Match ${m.num} details">
      <div class="bnode-row ${winnerSide === "home" ? "bnode-winner" : ""}">
        ${teamRowHtml(m.home)}
        ${homeScore !== null ? `<span class="bnode-score">${homeScore}</span>` : ""}
      </div>
      <div class="bnode-row ${winnerSide === "away" ? "bnode-winner" : ""}">
        ${teamRowHtml(m.away)}
        ${awayScore !== null ? `<span class="bnode-score">${awayScore}</span>` : ""}
      </div>
    </button>`;
}

function render() {
  if (!groupsLoaded || !knockoutLoaded) return;

  const merged = applyOverrides(realMatches, overrides);
  const GROUPS = buildGroupsFromMatches(realMatches);
  const { groupStandings, thirdPlace, allGroupsComplete } = computeAllStandings(merged, GROUPS);

  document.body.classList.toggle("sim-on", simOn);
  if (document.getElementById("sim-switch")) {
    document.getElementById("sim-switch").setAttribute("aria-checked", String(simOn));
  }

  const { matchesByNum, statusNote } = resolveKnockoutBracket(groupStandings, thirdPlace, allGroupsComplete, knockoutResults);

  document.getElementById("bracket-status").textContent = statusNote;
  document.getElementById("bracket-status").style.display = statusNote ? "block" : "none";

  const columnsHtml = ROUND_ORDER.map((round) => {
    const matches = KNOCKOUT_MATCHES.filter((m) => m.round === round).map((m) => matchesByNum[m.num]);
    const nodes = matches.map(matchNodeHtml).join("");
    return `
      <div class="bracket-column" data-round="${round}">
        <div class="bracket-round-title">${ROUND_LABELS[round]}</div>
        <div class="bracket-column-inner">${nodes}</div>
      </div>`;
  }).join("");

  document.getElementById("bracket-columns").innerHTML = columnsHtml;

  const thirdMatch = matchesByNum[103];
  document.getElementById("third-place-box").innerHTML = `
    <div class="bracket-round-title">${ROUND_LABELS["3RD"]}</div>
    ${matchNodeHtml(thirdMatch)}`;

  document.querySelectorAll(".bracket-node").forEach((btn) => {
    btn.addEventListener("click", () => openModal(matchesByNum[Number(btn.dataset.match)]));
  });
}

// ---------- Modal ----------

function openModal(m) {
  const status = m.result ? "Final" : "Upcoming";
  const scoreLine = m.result
    ? `${m.result.homeScore} \u2013 ${m.result.awayScore}${m.result.wentToPenalties ? ` (pens ${m.result.homePens}\u2013${m.result.awayPens})` : ""}`
    : null;
  const dateLabel = new Date(m.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const homeLabel = m.home.team ? m.home.team : `${m.home.label} (${m.home.code})`;
  const awayLabel = m.away.team ? m.away.team : `${m.away.label} (${m.away.code})`;

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-match-num">Match ${m.num} \u2014 ${ROUND_LABELS[m.round]}</div>
    <div class="modal-teams">
      <span>${m.home.team ? flag(m.home.team) + " " : ""}${escapeHtml(homeLabel)}</span>
      <span class="modal-vs">vs</span>
      <span>${m.away.team ? flag(m.away.team) + " " : ""}${escapeHtml(awayLabel)}</span>
    </div>
    ${scoreLine ? `<div class="modal-score">${scoreLine}</div>` : ""}
    <dl class="modal-details">
      <dt>Date</dt><dd>${dateLabel}, 2026</dd>
      <dt>Time</dt><dd>${m.time}</dd>
      <dt>Venue</dt><dd>${escapeHtml(m.venue)}</dd>
      <dt>Status</dt><dd>${status}</dd>
    </dl>`;
  document.getElementById("modal-overlay").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
}

document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});
document.getElementById("modal-close").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ---------- Sim toggle ----------

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

// ---------- Boot ----------

loadFromUrl();

onSnapshot(matchesCollection, (snap) => {
  realMatches = snap.docs.map((d) => d.data());
  groupsLoaded = true;
  render();
});

onSnapshot(knockoutMatchesCollection, (snap) => {
  knockoutResults = {};
  snap.docs.forEach((d) => {
    knockoutResults[Number(d.id)] = d.data();
  });
  knockoutLoaded = true;
  render();
});
