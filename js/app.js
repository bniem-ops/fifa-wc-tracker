import { db, matchesCollection, onSnapshot } from "./firebase-init.js";
import {
  computeAllStandings,
  buildGroupsFromMatches,
  applyOverrides,
} from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveBracket } from "./bracket-resolve.js";

// ---------- State ----------

let realMatches = [];           // live from Firestore
let overrides = {};             // { matchId: { homeScore, awayScore } } — local only
let simOn = false;
let prevStatusByTeam = {};      // for flip-animation diffing

const flag = (team) => FLAGS[team] || "🏳️";

// ---------- URL <-> overrides ----------

function encodeOverrides(o) {
  const parts = Object.entries(o).map(([id, s]) => `${id}:${s.homeScore}-${s.awayScore}`);
  return parts.join(",");
}

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

function syncUrl() {
  const params = new URLSearchParams(location.search);
  if (simOn && Object.keys(overrides).length > 0) {
    params.set("sim", encodeOverrides(overrides));
  } else {
    params.delete("sim");
  }
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// ---------- Rendering ----------

function statusTileHtml(team, status) {
  const changed = prevStatusByTeam[team] && prevStatusByTeam[team] !== status.code;
  prevStatusByTeam[team] = status.code;
  const letter = { QUALIFIED: "Q", ELIMINATED: "E", ALIVE: "—", CONTESTED: "?" }[status.code];
  return `<span class="status-tile ${status.code} ${changed ? "flip-anim" : ""}" title="${escapeHtml(status.label + ' — ' + status.detail)}">${letter}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function scoreOptions(selected) {
  let out = "";
  for (let i = 0; i <= 9; i++) out += `<option value="${i}" ${i === selected ? "selected" : ""}>${i}</option>`;
  return out;
}

function groupCardHtml(group, standings, groupMatches, statuses) {
  const playedCount = groupMatches.filter((m) => m.status === "played").length;
  const complete = standings[0].groupComplete;

  const rows = standings
    .map((s) => {
      const st = statuses[s.team];
      return `
        <tr>
          <td><div class="team-cell"><span class="flag">${flag(s.team)}</span>${escapeHtml(s.team)}</div>${s.tiedNote ? `<div class="tied-note">${escapeHtml(s.tiedNote)}</div>` : ""}</td>
          <td>${s.p}</td>
          <td>${s.w}</td>
          <td>${s.d}</td>
          <td>${s.l}</td>
          <td>${s.gd >= 0 ? "+" : ""}${s.gd}</td>
          <td class="pts-cell">${s.pts}</td>
          <td>${statusTileHtml(s.team, st)}</td>
        </tr>`;
    })
    .join("");

  const fixtures = groupMatches
    .map((m) => {
      const isUpcoming = m.status === "upcoming";
      const ov = overrides[m.id];
      let scoreHtml;
      if (!isUpcoming) {
        scoreHtml = `<span class="fixture-score final">${m.homeScore}\u2013${m.awayScore}</span>`;
      } else if (simOn) {
        const h = ov ? ov.homeScore : 0;
        const a = ov ? ov.awayScore : 0;
        scoreHtml = `
          <select class="score-select" data-match="${m.id}" data-side="home" aria-label="${escapeHtml(m.home)} goals">${scoreOptions(h)}</select>
          <span class="fixture-score">\u2013</span>
          <select class="score-select" data-match="${m.id}" data-side="away" aria-label="${escapeHtml(m.away)} goals">${scoreOptions(a)}</select>`;
      } else {
        scoreHtml = `<span class="fixture-score">vs</span>`;
      }
      return `
        <div class="fixture-row">
          <div class="fixture-teams">
            <span class="flag">${flag(m.home)}</span><span class="team-name">${escapeHtml(m.home)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">${scoreHtml}</div>
          <div class="fixture-teams" style="justify-content:flex-end;">
            <span class="team-name">${escapeHtml(m.away)}</span><span class="flag">${flag(m.away)}</span>
          </div>
          <span class="fixture-date">${m.date.slice(5)}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="group-card">
      <div class="group-card-head">
        <h2>Group ${group}</h2>
        <span class="complete-tag">${complete ? "decided" : `${playedCount}/6 played`}</span>
      </div>
      <table class="standings">
        <thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="fixtures">${fixtures}</div>
    </div>`;
}

function thirdPlaceHtml(thirdPlace, statuses) {
  const rows = thirdPlace
    .map((t) => {
      const st = statuses[t.team];
      const rankText = t.rankStart === t.rankEnd ? t.rankStart : `${t.rankStart}\u2013${t.rankEnd}`;
      const qualifyLine = t.rankStart <= 8 && t.rankEnd > 8 ? " qualify-line" : "";
      return `
        <tr class="${t.rankStart === 9 ? "qualify-line" : ""}${qualifyLine}">
          <td class="num">${rankText}</td>
          <td><div class="team-cell"><span class="flag">${flag(t.team)}</span>${escapeHtml(t.team)}</div></td>
          <td>Group ${t.group}</td>
          <td class="num">${t.pts}</td>
          <td class="num">${t.gd >= 0 ? "+" : ""}${t.gd}</td>
          <td class="num">${t.gf}</td>
          <td>${statusTileHtml("3rd:" + t.team, st)}</td>
        </tr>`;
    })
    .join("");

  return `
    <table class="third-place">
      <thead><tr><th>#</th><th>Team</th><th>Group</th><th class="num">Pts</th><th class="num">GD</th><th class="num">GF</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="tied-note" style="margin:10px 8px 12px;">Top 8 advance to the Round of 32 as the best third-place teams. Gold line marks the cutoff.</p>`;
}

function bracketPreviewTeamHtml({ team, label }) {
  if (team) {
    return `<div class="bracket-team resolved"><span class="flag">${flag(team)}</span><span class="bteam-name">${escapeHtml(team)}</span></div>`;
  }
  return `<div class="bracket-team pending"><span class="bteam-name">TBD</span><span class="bteam-sub">${escapeHtml(label)}</span></div>`;
}

function bracketPreviewCardHtml(fx) {
  return `
    <div class="bracket-card">
      <div class="bracket-card-head"><span class="match-num">Match ${fx.num}</span></div>
      ${bracketPreviewTeamHtml(fx.home)}
      <div class="bracket-vs">vs</div>
      ${bracketPreviewTeamHtml(fx.away)}
    </div>`;
}

function render() {
  const merged = applyOverrides(realMatches, overrides);
  const GROUPS = buildGroupsFromMatches(realMatches.length ? realMatches : merged);
  const { groupStandings, thirdPlace, allGroupsComplete, statuses } = computeAllStandings(merged, GROUPS);

  document.body.classList.toggle("sim-on", simOn);
  document.getElementById("sim-switch").setAttribute("aria-checked", String(simOn));

  const groupsHtml = Object.keys(groupStandings)
    .sort()
    .map((g) => {
      const groupMatches = merged.filter((m) => groupStandings[g].some((s) => s.team === m.home) && groupStandings[g].some((s) => s.team === m.away));
      return groupCardHtml(g, groupStandings[g], groupMatches, statuses);
    })
    .join("");
  document.getElementById("group-grid").innerHTML = groupsHtml;
  document.getElementById("third-place").innerHTML = thirdPlaceHtml(thirdPlace, statuses);

  const wbLabel = document.getElementById("whatif-bracket-label");
  const wbGrid = document.getElementById("whatif-bracket");
  if (simOn) {
    const { fixtures, statusNote } = resolveBracket(groupStandings, thirdPlace, allGroupsComplete);
    wbLabel.style.display = "block";
    wbGrid.style.display = "grid";
    const note = statusNote ? `<p class="tied-note" style="grid-column:1/-1;margin:0 0 4px;">${escapeHtml(statusNote)}</p>` : "";
    wbGrid.innerHTML = note + fixtures.map(bracketPreviewCardHtml).join("");
  } else {
    wbLabel.style.display = "none";
    wbGrid.style.display = "none";
    wbGrid.innerHTML = "";
  }

  const playedTotal = merged.filter((m) => m.status === "played").length;
  document.getElementById("subtitle").textContent = `${playedTotal}/72 group matches played${simOn ? " \u2014 viewing a what-if scenario" : ""}`;

  wireScoreSelects();
}

function wireScoreSelects() {
  document.querySelectorAll(".score-select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const matchId = e.target.dataset.match;
      const side = e.target.dataset.side; // "home" | "away"
      const key = side === "home" ? "homeScore" : "awayScore";
      const current = overrides[matchId] || { homeScore: 0, awayScore: 0 };
      current[key] = Number(e.target.value);
      overrides[matchId] = current;
      syncUrl();
      render();
    });
  });
}

// ---------- Controls ----------

document.getElementById("sim-switch").addEventListener("click", () => {
  simOn = !simOn;
  syncUrl();
  render();
});

document.getElementById("sim-reset").addEventListener("click", () => {
  overrides = {};
  syncUrl();
  render();
});

document.getElementById("sim-share").addEventListener("click", async () => {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    const btn = document.getElementById("sim-share");
    const original = btn.textContent;
    btn.textContent = "Link copied!";
    setTimeout(() => (btn.textContent = original), 1500);
  } catch {
    prompt("Copy this link:", location.href);
  }
});

// ---------- Boot ----------

loadFromUrl();
render();

onSnapshot(matchesCollection, (snap) => {
  if (snap.empty) {
    document.getElementById("group-grid").innerHTML =
      `<p style="color:var(--text-muted);">No match data yet — the admin needs to import the schedule from the <a href="admin.html">admin page</a>.</p>`;
    document.getElementById("third-place").innerHTML = "";
    return;
  }
  realMatches = snap.docs.map((d) => d.data());
  render();
});
