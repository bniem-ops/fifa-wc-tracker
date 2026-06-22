import { matchesCollection, knockoutMatchesCollection, onSnapshot } from "./firebase-init.js";
import { computeAllStandings, buildGroupsFromMatches } from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveKnockoutBracket } from "./bracket-resolve.js";
import { KNOCKOUT_MATCHES, ROUND_LABELS, ROUND_ORDER } from "./bracket-data.js";

let realMatches = [];          // group-stage matches, live from Firestore
let knockoutResults = {};      // { matchNum: {homeScore, awayScore, ...} }, live from Firestore
let groupsLoaded = false;
let knockoutLoaded = false;

const flag = (team) => FLAGS[team] || "🏳️";
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

// Traverses the bracket tree from the Final outward to produce an ordered
// list of match pairs per round that matches the correct visual bracket layout.
function computeBracketLayout(matchesByNum) {
  const feeders = {};
  for (const m of KNOCKOUT_MATCHES) {
    const f = [];
    for (const side of [m.home, m.away]) {
      if (side.type === "winnerOf") f.push(side.match);
    }
    if (f.length === 2) feeders[m.num] = f;
  }

  const layout = {};
  function collect(num) {
    if (!feeders[num]) return;
    const [a, b] = feeders[num];
    collect(a);
    collect(b);
    const round = matchesByNum[a]?.round;
    if (round && matchesByNum[a] && matchesByNum[b]) {
      if (!layout[round]) layout[round] = [];
      layout[round].push([matchesByNum[a], matchesByNum[b]]);
    }
  }

  const final = KNOCKOUT_MATCHES.find((m) => m.round === "F");
  collect(final.num);
  layout["F"] = [[matchesByNum[final.num]]];
  return layout;
}

function render() {
  if (!groupsLoaded || !knockoutLoaded) return;

  const GROUPS = buildGroupsFromMatches(realMatches);
  const { groupStandings, thirdPlace, allGroupsComplete } = computeAllStandings(realMatches, GROUPS);

  const { matchesByNum, statusNote } = resolveKnockoutBracket(groupStandings, thirdPlace, allGroupsComplete, knockoutResults);

  document.getElementById("bracket-status").textContent = statusNote;
  document.getElementById("bracket-status").style.display = statusNote ? "block" : "none";

  const layout = computeBracketLayout(matchesByNum);

  const columnsHtml = ROUND_ORDER.map((round) => {
    const groups = layout[round] || [];
    const innerHtml = groups.map(([a, b]) =>
      b ? `<div class="bracket-pair">${matchNodeHtml(a)}${matchNodeHtml(b)}</div>`
        : matchNodeHtml(a)
    ).join("");
    return `
      <div class="bracket-column" data-round="${round}">
        <div class="bracket-round-title">${ROUND_LABELS[round]}</div>
        <div class="bracket-column-inner">${innerHtml}</div>
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

// ---------- Boot ----------

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
