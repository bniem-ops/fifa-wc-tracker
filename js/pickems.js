// Feature flag — change to true to make this page publicly accessible
const PICKEMS_ENABLED = false;
if (!PICKEMS_ENABLED) { location.replace("index.html"); }

import {
  db, matchesCollection, knockoutMatchesCollection, onSnapshot, collection, addDoc, serverTimestamp,
} from "./firebase-init.js";
import { computeAllStandings, buildGroupsFromMatches } from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveKnockoutBracket } from "./bracket-resolve.js";
import { KNOCKOUT_MATCHES } from "./bracket-data.js";

const flag = (t) => FLAGS[t] || "🏳️";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- State ----------

let realMatches = [];
let knockoutResults = {};
let allPickems = [];
let resolvedMatchesByNum = {};
let groupsLoaded = false;
let knockoutLoaded = false;
let pickemsLoaded = false;
let localPicks = {};

const STORAGE_KEY = "pickems_v2";
const PREVIEW_MODE = new URLSearchParams(location.search).has("preview");
let mySubmissionId = PREVIEW_MODE ? null : (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY))?.docId || null; } catch { return null; }
})();

const pickemsCol = collection(db, "pickems");

// ---------- Bracket resolution ----------

function buildMatchups(picks) {
  const mu = {};
  // R32: teams determined by group stage, already resolved
  for (const m of KNOCKOUT_MATCHES.filter(m => m.round === "R32")) {
    const real = resolvedMatchesByNum[m.num];
    mu[m.num] = { home: real?.home?.team || null, away: real?.away?.team || null };
  }
  // R16 onward: teams cascade from user's picks in the prior round
  for (const m of KNOCKOUT_MATCHES.filter(m => ["R16", "QF", "SF", "3RD", "F"].includes(m.round))) {
    mu[m.num] = { home: sideTeam(m.home, mu, picks), away: sideTeam(m.away, mu, picks) };
  }
  return mu;
}

function sideTeam(side, mu, picks) {
  if (side.type === "winnerOf") return picks[side.match] || null;
  if (side.type === "loserOf") {
    const winner = picks[side.match];
    const m = mu[side.match];
    if (!winner || !m) return null;
    return m.home === winner ? m.away : m.away === winner ? m.home : null;
  }
  return null;
}

function clearDownstream(matchNum) {
  for (const m of KNOCKOUT_MATCHES) {
    for (const side of [m.home, m.away]) {
      if ((side.type === "winnerOf" || side.type === "loserOf") && side.match === matchNum) {
        delete localPicks[m.num];
        clearDownstream(m.num);
      }
    }
  }
}

// ---------- Scoring ----------

const ROUND_PTS = { R32: 1, R16: 2, QF: 4, SF: 8, "3RD": 2, F: 16 };

function scoreEntry(picks) {
  let pts = 0;
  for (const m of KNOCKOUT_MATCHES) {
    const kr = knockoutResults[m.num];
    if (kr?.winner && picks?.[m.num] === kr.winner) pts += ROUND_PTS[m.round] || 1;
  }
  return pts;
}

function actualPKs() {
  return Object.values(knockoutResults).filter(r => r.wentToPenalties).length;
}

// ---------- Render ----------

function render() {
  if (!groupsLoaded || !knockoutLoaded) return;
  const GROUPS = buildGroupsFromMatches(realMatches);
  const { groupStandings, thirdPlace, allGroupsComplete } = computeAllStandings(realMatches, GROUPS);
  const { matchesByNum } = resolveKnockoutBracket(groupStandings, thirdPlace, allGroupsComplete, knockoutResults);
  resolvedMatchesByNum = matchesByNum;
  renderLeaderboard();
  renderPickSection();
}

function renderLeaderboard() {
  if (!pickemsLoaded) return;
  const pks = actualPKs();
  const scored = allPickems.map(p => ({
    ...p,
    score: scoreEntry(p.picks),
    pkDist: p.pkGuess != null ? Math.abs(p.pkGuess - pks) : Infinity,
  })).sort((a, b) =>
    b.score - a.score ||
    a.pkDist - b.pkDist ||
    ((a.submittedAt?.seconds || 0) - (b.submittedAt?.seconds || 0))
  );
  document.getElementById("leaderboard-inner").innerHTML = lbHtml(scored, pks);
}

function lbHtml(scored, pks) {
  if (!scored.length) return `<p class="pk-empty">No picks yet — be the first!</p>`;
  const medals = ["🥇", "🥈", "🥉"];
  const anyResults = Object.values(knockoutResults).some(r => r.winner);
  return `
    <table class="pk-lb">
      <thead>
        <tr><th></th><th>Name</th><th>Champion</th><th class="num">Pts</th><th class="num pk-pk-head" title="Tiebreaker: penalty shootout guess">PK</th></tr>
      </thead>
      <tbody>
        ${scored.map((p, i) => {
          const champ = p.picks?.[104] || null;
          const isMe = p.docId === mySubmissionId;
          return `<tr class="${isMe ? "pk-mine" : ""}">
            <td>${medals[i] || i + 1}</td>
            <td class="pk-name-cell">${esc(p.name)}${isMe ? `<span class="pk-you">you</span>` : ""}</td>
            <td>${champ ? `<span class="flag">${flag(champ)}</span>${esc(champ)}` : `<span style="color:var(--text-muted)">—</span>`}</td>
            <td class="num pk-pts">${p.score}</td>
            <td class="num pk-pkval">${p.pkGuess ?? "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${anyResults ? `<p class="tied-note" style="margin:8px 4px 0;">Penalty shootouts in knockout stage so far: ${pks}. Tiebreaker goes to closest guess; ties broken by earliest submission.</p>` : ""}`;
}

// ---------- Pick form ----------

const FORM_ROUNDS = [
  { label: "Round of 32", round: "R32" },
  { label: "Round of 16", round: "R16" },
  { label: "Quarterfinals", round: "QF" },
  { label: "Semifinals", round: "SF" },
  { label: "Third Place", round: "3RD" },
  { label: "Final", round: "F" },
];

function renderPickSection() {
  const el = document.getElementById("picks-section");
  if (mySubmissionId) {
    const mine = allPickems.find(p => p.docId === mySubmissionId);
    el.innerHTML = mine ? readonlyHtml(mine) : `<p class="pk-empty" style="padding:20px 0">Loading your picks…</p>`;
  } else {
    el.innerHTML = formHtml();
    wireForm();
  }
}

function formHtml() {
  const mu = buildMatchups(localPicks);
  const allPicked = KNOCKOUT_MATCHES.every(m => localPicks[m.num]);
  const champion = localPicks[104] || null;

  const roundsHtml = FORM_ROUNDS.map(({ label, round }) => `
    <div class="pk-round-group">
      <div class="pk-round-label">${label}</div>
      <div class="pk-matchups">
        ${KNOCKOUT_MATCHES.filter(m => m.round === round).map(m => matchupHtml(m, mu, localPicks)).join("")}
      </div>
    </div>`).join("");

  return `
    <div class="pk-form">
      ${roundsHtml}
      <div class="pk-submit-area">
        <div class="pk-champ-preview">
          ${champion
            ? `Your champion: <span class="flag">${flag(champion)}</span><strong>${esc(champion)}</strong> 🏆`
            : "Pick your way to the Final to reveal your champion"}
        </div>
        <div class="pk-field">
          <label for="pk-pks">Tiebreaker — how many knockout matches go to penalties?</label>
          <input type="number" id="pk-pks" min="0" max="15" class="pk-input" placeholder="Your guess (0–15)" />
        </div>
        <div class="pk-field">
          <label for="pk-name">Your name</label>
          <input type="text" id="pk-name" maxlength="40" class="pk-input" placeholder="Enter your name" />
        </div>
        <button id="pk-submit" class="pk-submit-btn" ${!allPicked ? "disabled" : ""}>
          ${allPicked ? "Submit your bracket" : "Pick every match to unlock submission"}
        </button>
      </div>
    </div>`;
}

function matchupHtml(m, mu, picks) {
  const { home, away } = mu[m.num] || {};
  const picked = picks[m.num];
  return `<div class="pk-matchup">
    ${teamBtnHtml(m.num, home, picked)}
    ${teamBtnHtml(m.num, away, picked)}
  </div>`;
}

function teamBtnHtml(matchNum, team, picked) {
  const isSel = !!team && picked === team;
  const isTbd = !team;
  return `<button class="pk-btn${isSel ? " pk-sel" : ""}${isTbd ? " pk-tbd" : ""}"
    data-num="${matchNum}" data-team="${esc(team || "")}" ${isTbd ? "disabled" : ""}>
    ${team ? `<span class="flag">${flag(team)}</span>${esc(team)}` : "TBD"}
  </button>`;
}

function wireForm() {
  document.querySelectorAll(".pk-btn:not(:disabled)").forEach(btn => {
    btn.addEventListener("click", () => {
      const num = Number(btn.dataset.num);
      const team = btn.dataset.team;
      if (!team) return;
      if (localPicks[num] === team) {
        delete localPicks[num];
        clearDownstream(num);
      } else {
        if (localPicks[num] && localPicks[num] !== team) clearDownstream(num);
        localPicks[num] = team;
      }
      renderPickSection();
    });
  });
  document.getElementById("pk-submit")?.addEventListener("click", handleSubmit);
}

async function handleSubmit() {
  const name = document.getElementById("pk-name")?.value?.trim();
  const pkVal = document.getElementById("pk-pks")?.value;
  if (!name) { alert("Please enter your name."); return; }

  const pkGuess = pkVal !== "" && pkVal != null ? Number(pkVal) : null;
  const btn = document.getElementById("pk-submit");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    if (PREVIEW_MODE) {
      btn.textContent = "Submitted! (preview — nothing saved)";
      return;
    }
    const ref = await addDoc(pickemsCol, {
      name,
      picks: { ...localPicks },
      pkGuess,
      submittedAt: serverTimestamp(),
    });
    mySubmissionId = ref.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ docId: ref.id }));
    renderPickSection();
    renderLeaderboard();
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    btn.textContent = "Submit your bracket";
    alert("Submission failed. Check your connection and try again.");
  }
}

// ---------- Read-only submitted view ----------

function readonlyHtml(entry) {
  const mu = buildMatchups(entry.picks || {});
  const pks = actualPKs();
  const champion = entry.picks?.[104] || null;
  const myScore = scoreEntry(entry.picks);
  const anyResults = Object.values(knockoutResults).some(r => r.winner);

  const roundsHtml = FORM_ROUNDS.map(({ label, round }) => `
    <div class="pk-round-group">
      <div class="pk-round-label">${label}</div>
      <div class="pk-matchups">
        ${KNOCKOUT_MATCHES.filter(m => m.round === round).map(m => readonlyMatchupHtml(m, mu, entry.picks)).join("")}
      </div>
    </div>`).join("");

  return `
    <div class="pk-submitted-header">
      <span>${champion
        ? `Champion pick: <span class="flag">${flag(champion)}</span><strong>${esc(champion)}</strong>`
        : "Bracket submitted"}</span>
      <span class="pk-submitted-meta">
        ${anyResults ? `<strong class="pk-pts">${myScore} pts</strong> &nbsp;·&nbsp; ` : ""}
        PK guess: <strong>${entry.pkGuess ?? "—"}</strong>&nbsp;/&nbsp;Actual: <strong>${pks}</strong>
      </span>
    </div>
    <div class="pk-form pk-form-ro">${roundsHtml}</div>`;
}

function readonlyMatchupHtml(m, mu, picks) {
  const { home, away } = mu[m.num] || {};
  const picked = picks?.[m.num];
  const kr = knockoutResults[m.num];
  const actual = kr?.winner || null;
  return `<div class="pk-matchup">
    ${readonlyTeamHtml(home, picked, actual)}
    ${readonlyTeamHtml(away, picked, actual)}
  </div>`;
}

function readonlyTeamHtml(team, picked, actual) {
  const isPicked = !!team && picked === team;
  const isCorrect = isPicked && !!actual && actual === team;
  const isWrong = isPicked && !!actual && actual !== team;
  const cls = isPicked ? (isCorrect ? " pk-correct" : isWrong ? " pk-wrong" : " pk-sel") : "";
  return `<div class="pk-btn pk-btn-ro${cls}">
    ${team ? `<span class="flag">${flag(team)}</span>${esc(team)}` : `<span class="pk-tbd-label">TBD</span>`}
    ${isCorrect ? `<span class="pk-icon pk-icon-ok">✓</span>` : isWrong ? `<span class="pk-icon pk-icon-x">✗</span>` : ""}
  </div>`;
}

// ---------- Boot ----------

onSnapshot(matchesCollection, snap => {
  realMatches = snap.docs.map(d => d.data());
  groupsLoaded = true;
  render();
});

onSnapshot(knockoutMatchesCollection, snap => {
  knockoutResults = {};
  snap.docs.forEach(d => { knockoutResults[Number(d.id)] = d.data(); });
  knockoutLoaded = true;
  render();
});

onSnapshot(pickemsCol, snap => {
  allPickems = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  pickemsLoaded = true;
  renderLeaderboard();
  if (mySubmissionId && groupsLoaded && knockoutLoaded) renderPickSection();
});
