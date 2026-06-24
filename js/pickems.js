// Feature flag — change to true to make this page publicly accessible
const PICKEMS_ENABLED = true;
if (!PICKEMS_ENABLED) { location.replace("index.html"); }

import {
  db, matchesCollection, knockoutMatchesCollection, onSnapshot, collection, addDoc, serverTimestamp,
} from "./firebase-init.js";
import { computeAllStandings, buildGroupsFromMatches } from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveKnockoutBracket } from "./bracket-resolve.js";
import { KNOCKOUT_MATCHES, ROUND_LABELS, ROUND_ORDER } from "./bracket-data.js";

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
  for (const m of KNOCKOUT_MATCHES.filter(m => m.round === "R32")) {
    const real = resolvedMatchesByNum[m.num];
    mu[m.num] = { home: real?.home?.team || null, away: real?.away?.team || null };
  }
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

// Build enriched matchup objects that look like bracket.js matchesByNum entries
function enrichedMatchups(picks) {
  const mu = buildMatchups(picks);
  const byNum = {};
  for (const m of KNOCKOUT_MATCHES) {
    byNum[m.num] = {
      ...m,
      home: { ...m.home, team: mu[m.num]?.home ?? null },
      away: { ...m.away, team: mu[m.num]?.away ?? null },
    };
  }
  return byNum;
}

// Same layout algorithm as bracket.js — DFS from Final outward
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
  const final = KNOCKOUT_MATCHES.find(m => m.round === "F");
  collect(final.num);
  layout["F"] = [[matchesByNum[final.num]]];
  return layout;
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

// ---------- SVG connectors (same logic as bracket.js) ----------

function drawPickBracket() {
  const container = document.getElementById("pk-bracket-columns");
  if (!container) return;
  document.getElementById("pk-bracket-svg")?.remove();

  const cRect = container.getBoundingClientRect();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "pk-bracket-svg";
  svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;overflow:visible;";
  svg.setAttribute("width", container.scrollWidth);
  svg.setAttribute("height", container.scrollHeight);
  container.appendChild(svg);

  const pos = el => {
    const r = el.getBoundingClientRect();
    return { lx: r.left - cRect.left, rx: r.right - cRect.left, cy: r.top - cRect.top + r.height / 2 };
  };

  for (const m of KNOCKOUT_MATCHES) {
    const feedNums = [m.home, m.away].filter(s => s.type === "winnerOf").map(s => s.match);
    if (feedNums.length !== 2) continue;
    const [aNum, bNum] = feedNums;
    const childEl = container.querySelector(`[data-match="${m.num}"]`);
    const aEl = container.querySelector(`[data-match="${aNum}"]`);
    const bEl = container.querySelector(`[data-match="${bNum}"]`);
    if (!childEl || !aEl || !bEl) continue;

    const a = pos(aEl), b = pos(bEl), c = pos(childEl);
    const jx = (a.rx + c.lx) / 2;
    const jy = (a.cy + b.cy) / 2;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M${a.rx},${a.cy}H${jx}V${b.cy}M${b.rx},${b.cy}H${jx}M${jx},${jy}H${c.lx}`);
    path.setAttribute("stroke", "rgba(244,241,232,0.28)");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
  }
}

// ---------- Bracket node HTML ----------

function pkRowHtml(matchNum, team, picked, isReadonly) {
  const isPicked = !!team && picked === team;
  const kr = isReadonly ? knockoutResults[matchNum] : null;
  const actual = kr?.winner || null;
  const isCorrect = isPicked && !!actual && actual === team;
  const isWrong = isPicked && !!actual && actual !== team;

  let cls = "";
  if (!team) cls = " pk-tbd-row";
  else if (isReadonly && isPicked) cls = isCorrect ? " pk-correct" : isWrong ? " pk-wrong" : " pk-sel";
  else if (!isReadonly && isPicked) cls = " pk-sel";
  else if (!isReadonly) cls = " pk-clickable";

  const icon = isReadonly && isPicked
    ? (isCorrect ? `<span class="pk-row-icon pk-icon-ok">✓</span>` : isWrong ? `<span class="pk-row-icon pk-icon-x">✗</span>` : "")
    : "";

  const teamInner = team
    ? `<div class="bnode-team bnode-resolved"><span class="flag">${flag(team)}</span><span class="bnode-name">${esc(team)}</span></div>`
    : `<div class="bnode-team bnode-pending"><span class="bnode-label">TBD</span></div>`;

  const dataAttrs = !isReadonly && team ? ` data-num="${matchNum}" data-team="${esc(team)}"` : "";
  return `<div class="bnode-row${cls}"${dataAttrs}>${teamInner}${icon}</div>`;
}

function pkMatchNodeHtml(m, picks, isReadonly) {
  const picked = picks?.[m.num] || null;
  return `<div class="bracket-node pk-node" data-match="${m.num}">
    ${pkRowHtml(m.num, m.home.team, picked, isReadonly)}
    ${pkRowHtml(m.num, m.away.team, picked, isReadonly)}
  </div>`;
}

function bracketColumnsHtml(matchesByNum, picks, isReadonly) {
  const layout = computeBracketLayout(matchesByNum);
  return ROUND_ORDER.map(round => {
    const groups = layout[round] || [];
    const innerHtml = groups.map(([a, b]) =>
      b ? `<div class="bracket-pair">${pkMatchNodeHtml(a, picks, isReadonly)}${pkMatchNodeHtml(b, picks, isReadonly)}</div>`
        : pkMatchNodeHtml(a, picks, isReadonly)
    ).join("");
    return `
      <div class="bracket-column" data-round="${round}">
        <div class="bracket-round-title">${ROUND_LABELS[round]}</div>
        <div class="bracket-column-inner">${innerHtml}</div>
      </div>`;
  }).join("");
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

function renderPickSection() {
  const el = document.getElementById("picks-section");
  if (mySubmissionId) {
    const mine = allPickems.find(p => p.docId === mySubmissionId);
    el.innerHTML = mine ? readonlyHtml(mine) : `<p class="pk-empty" style="padding:20px 0">Loading your picks…</p>`;
  } else {
    el.innerHTML = formHtml();
    wireForm();
  }
  requestAnimationFrame(drawPickBracket);
}

function formHtml() {
  const matchesByNum = enrichedMatchups(localPicks);
  const allPicked = KNOCKOUT_MATCHES.every(m => localPicks[m.num]);
  const champion = localPicks[104] || null;

  return `
    <div class="pk-bracket-wrap">
      <div class="bracket-scroll">
        <div class="bracket-columns" id="pk-bracket-columns">
          ${bracketColumnsHtml(matchesByNum, localPicks, false)}
        </div>
      </div>
    </div>
    <div class="third-place-box" style="margin-top:24px; margin-bottom:20px;">
      <div class="bracket-round-title">${ROUND_LABELS["3RD"]}</div>
      ${pkMatchNodeHtml(matchesByNum[103], localPicks, false)}
    </div>
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
    </div>`;
}

function wireForm() {
  document.querySelectorAll(".pk-node .bnode-row[data-num]").forEach(row => {
    const team = row.dataset.team;
    if (!team) return;
    row.addEventListener("click", () => {
      const num = Number(row.dataset.num);
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
  const matchesByNum = enrichedMatchups(entry.picks || {});
  const pks = actualPKs();
  const champion = entry.picks?.[104] || null;
  const myScore = scoreEntry(entry.picks);
  const anyResults = Object.values(knockoutResults).some(r => r.winner);

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
    <div class="pk-bracket-wrap">
      <div class="bracket-scroll">
        <div class="bracket-columns" id="pk-bracket-columns">
          ${bracketColumnsHtml(matchesByNum, entry.picks || {}, true)}
        </div>
      </div>
    </div>
    <div class="third-place-box" style="margin-top:24px;">
      <div class="bracket-round-title">${ROUND_LABELS["3RD"]}</div>
      ${pkMatchNodeHtml(matchesByNum[103], entry.picks || {}, true)}
    </div>`;
}

// ---------- Boot ----------

window.addEventListener("resize", () => {
  if (groupsLoaded && knockoutLoaded) drawPickBracket();
});

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
