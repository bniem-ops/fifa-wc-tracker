import { db, matchesCollection, onSnapshot } from "./firebase-init.js";
import {
  computeAllStandings,
  buildGroupsFromMatches,
  applyOverrides,
} from "./standings-engine.js";
import { FLAGS } from "./schedule-data.js";
import { resolveKnockoutBracket } from "./bracket-resolve.js";
import { KNOCKOUT_MATCHES, resolveThirdPlaceSlots } from "./bracket-data.js";
import { computeGroupOutcomes } from "./outcomes.js";

// ---------- State ----------

let realMatches = [];           // live from Firestore
let overrides = {};             // { matchId: { homeScore, awayScore } } — local only
let simOn = false;
let prevStatusByTeam = {};      // for flip-animation diffing

// Cached for outcomes modal
let _mergedMatches = [];
let _groupTeamsMap = {};

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

function groupRankTileHtml(standing, status) {
  if (!standing.groupComplete) {
    if (standing.clinched1st) {
      const changed = prevStatusByTeam[standing.team] && prevStatusByTeam[standing.team] !== "POS1";
      prevStatusByTeam[standing.team] = "POS1";
      return `<span class="rank-medal ${changed ? "flip-anim" : ""}" title="${escapeHtml(`1st in Group ${standing.group} — clinched`)}">🥇</span>`;
    }
    return statusTileHtml(standing.team, status);
  }

  const key = standing.team;
  if (standing.tiedNote) {
    const changed = prevStatusByTeam[key] && prevStatusByTeam[key] !== "CONTESTED";
    prevStatusByTeam[key] = "CONTESTED";
    return `<span class="status-tile CONTESTED ${changed ? "flip-anim" : ""}" title="${escapeHtml("Unresolved tie")}">?</span>`;
  }

  const rankCode = `POS${standing.rank}`;
  const changed = prevStatusByTeam[key] && prevStatusByTeam[key] !== rankCode;
  prevStatusByTeam[key] = rankCode;

  if (standing.rank === 4) {
    return `<span class="status-tile ELIMINATED ${changed ? "flip-anim" : ""}" title="${escapeHtml(`4th in Group ${standing.group}`)}">E</span>`;
  }
  if (standing.rank === 1) {
    return `<span class="rank-medal ${changed ? "flip-anim" : ""}" title="${escapeHtml(`1st in Group ${standing.group}`)}">🥇</span>`;
  }
  if (standing.rank === 2) {
    return `<span class="rank-medal ${changed ? "flip-anim" : ""}" title="${escapeHtml(`2nd in Group ${standing.group}`)}">🥈</span>`;
  }
  return `<span class="status-tile ALIVE ${changed ? "flip-anim" : ""}" title="${escapeHtml(`3rd in Group ${standing.group}`)}">${standing.rank}</span>`;
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
          <td>${groupRankTileHtml(s, st)}</td>
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
        <div style="display:flex;align-items:center;gap:8px;">
          <h2>Group ${group}</h2>
          ${!complete ? `<button class="outcomes-btn" data-group="${group}" aria-label="Possible outcomes for Group ${group}">?</button>` : ""}
        </div>
        <span class="complete-tag">${complete ? "decided" : `${playedCount}/6 played`}</span>
      </div>
      <table class="standings">
        <thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="fixtures">${fixtures}</div>
    </div>`;
}

function thirdPlaceHtml(thirdPlace, statuses, groupStandings, allGroupsComplete) {
  const straddles = (thirdPlace || []).some((t) => t.rankStart <= 8 && t.rankEnd > 8);
  let slotAssignment = null;
  if (!straddles) {
    const qualifyingGroups = thirdPlace.filter((t) => t.rankStart <= 8).map((t) => t.group);
    if (qualifyingGroups.length === 8) slotAssignment = resolveThirdPlaceSlots(qualifyingGroups);
  }

  // Reverse map: group letter \u2192 slot letter (e.g. "F" \u2192 "A" means group F's 3rd plays in slot A)
  const groupToSlot = {};
  if (slotAssignment) {
    for (const [slot, grp] of Object.entries(slotAssignment)) {
      groupToSlot[grp] = slot;
    }
  }

  function opponentCell(t) {
    const qualifies = t.rankEnd <= 8;
    const contested = t.rankStart <= 8 && t.rankEnd > 8;
    if (!qualifies && !contested) return `<td class="opp-cell opp-none">\u2014</td>`;
    if (!slotAssignment || contested) return `<td class="opp-cell opp-pending">TBD</td>`;

    const slot = groupToSlot[t.group];
    if (!slot) return `<td class="opp-cell opp-pending">TBD</td>`;

    const winner = groupStandings?.[slot]?.[0];
    const resolved = winner && (winner.groupComplete || winner.clinched1st) && !winner.tiedNote;
    if (!resolved) {
      return `<td class="opp-cell opp-pending">Group ${slot} 1st seed</td>`;
    }
    return `<td class="opp-cell opp-resolved"><span class="flag">${flag(winner.team)}</span>${escapeHtml(winner.team)}</td>`;
  }

  const rows = thirdPlace
    .map((t) => {
      const st = statuses[t.team];
      const rankText = t.rankStart === t.rankEnd ? t.rankStart : `${t.rankStart}\u2013${t.rankEnd}`;
      const isQualifyBorder = t.rankStart === 9 || (t.rankStart <= 8 && t.rankEnd > 8);
      return `
        <tr class="${isQualifyBorder ? "qualify-line" : ""}">
          <td class="num">${rankText}</td>
          <td><div class="team-cell"><span class="flag">${flag(t.team)}</span>${escapeHtml(t.team)}</div></td>
          <td>Group ${t.group}</td>
          <td class="num">${t.pts}</td>
          <td class="num">${t.gd >= 0 ? "+" : ""}${t.gd}</td>
          <td class="num">${t.gf}</td>
          ${opponentCell(t)}
          <td>${statusTileHtml("3rd:" + t.team, st)}</td>
        </tr>`;
    })
    .join("");

  return `
    <table class="third-place">
      <thead><tr><th>#</th><th>Team</th><th>Group</th><th class="num">Pts</th><th class="num">GD</th><th class="num">GF</th><th>R32 Opponent</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="tied-note" style="margin:10px 8px 12px;">Top 8 advance to the Round of 32 as the best third-place teams. Gold line marks the cutoff.</p>`;
}

function bracketPreviewTeamHtml(side) {
  if (side.team) {
    return `<div class="bracket-team resolved"><span class="flag">${flag(side.team)}</span><span class="bteam-name">${escapeHtml(side.team)}</span></div>`;
  }
  return `<div class="bracket-team pending"><span class="bteam-name">${escapeHtml(side.code)}</span></div>`;
}

function bracketPreviewCardHtml(m) {
  return `
    <div class="bracket-card">
      <div class="bracket-card-head"><span class="match-num">Match ${m.num}</span></div>
      ${bracketPreviewTeamHtml(m.home)}
      <div class="bracket-vs">vs</div>
      ${bracketPreviewTeamHtml(m.away)}
    </div>`;
}

function render() {
  const merged = applyOverrides(realMatches, overrides);
  const GROUPS = buildGroupsFromMatches(realMatches.length ? realMatches : merged);
  const { groupStandings, thirdPlace, allGroupsComplete, statuses } = computeAllStandings(merged, GROUPS);

  // Override status for teams mathematically eliminated via h2h tiebreakers
  for (const [group, standings] of Object.entries(groupStandings)) {
    if (standings[0].groupComplete) continue;
    const teams = standings.map(s => s.team);
    const outcomes = computeGroupOutcomes(group, teams, merged);
    if (!outcomes) continue;
    for (const team of outcomes.eliminated) {
      statuses[team] = { code: "ELIMINATED", label: "Eliminated", detail: "Cannot finish top 2 regardless of remaining results" };
    }
  }

  document.body.classList.toggle("sim-on", simOn);
  document.getElementById("sim-switch").setAttribute("aria-checked", String(simOn));

  // Cache for outcomes modal
  _mergedMatches = merged;
  _groupTeamsMap = {};
  for (const [g, standings] of Object.entries(groupStandings)) {
    _groupTeamsMap[g] = standings.map(s => s.team);
  }

  const groupsHtml = Object.keys(groupStandings)
    .sort()
    .map((g) => {
      const groupMatches = merged.filter((m) => groupStandings[g].some((s) => s.team === m.home) && groupStandings[g].some((s) => s.team === m.away));
      return groupCardHtml(g, groupStandings[g], groupMatches, statuses);
    })
    .join("");
  document.getElementById("group-grid").innerHTML = groupsHtml;
  wireOutcomesButtons();
  document.getElementById("third-place").innerHTML = thirdPlaceHtml(thirdPlace, statuses, groupStandings, allGroupsComplete);

  const wbLabel = document.getElementById("whatif-bracket-label");
  const wbGrid = document.getElementById("whatif-bracket");
  if (simOn) {
    const { matchesByNum, statusNote } = resolveKnockoutBracket(groupStandings, thirdPlace, allGroupsComplete, {});
    const r32 = KNOCKOUT_MATCHES.filter((m) => m.round === "R32").map((m) => matchesByNum[m.num]);
    wbLabel.style.display = "block";
    wbGrid.style.display = "grid";
    const note = statusNote ? `<p class="tied-note" style="grid-column:1/-1;margin:0 0 4px;">${escapeHtml(statusNote)}</p>` : "";
    wbGrid.innerHTML = note + r32.map(bracketPreviewCardHtml).join("");
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

// ---------- Outcomes modal ----------

function outcomesModalHtml(group, outcomes) {
  const { unplayed, clinched, eliminated, contested, thirdOnly, scenarios, bullets, r32First, r32Second } = outcomes;

  let html = `<div class="outcomes-title">Group ${group} — Possible Outcomes</div>`;

  // Bullet facts
  if (bullets.length) {
    html += `<ul class="outcomes-bullets">`;
    for (const b of bullets) {
      html += `<li class="outcomes-bullet outcomes-bullet-${b.kind}">${b.html}</li>`;
    }
    html += `</ul>`;
  }

  // Scenario table
  const showTable = contested.length > 0 || thirdOnly.length > 0;
  if (showTable || bullets.length === 0) {
    const hasThird = thirdOnly.length > 0;

    if (unplayed.length === 2) {
      // 3×3 grid layout
      const [m1, m2] = unplayed;
      const colHdrs = [
        `${flag(m2.home)} win`,
        `Draw`,
        `${flag(m2.away)} win`,
      ];
      const rowHdrs = [
        `${flag(m1.home)} win`,
        `Draw`,
        `${flag(m1.away)} win`,
      ];

      html += `<div class="outcomes-grid-wrap">`;
      html += `<div class="outcomes-grid-labels">`;
      html += `<span class="outcomes-grid-match">${escapeHtml(m1.home)} vs ${escapeHtml(m1.away)}</span>`;
      html += `<span class="outcomes-grid-sep">↕</span>`;
      html += `<span class="outcomes-grid-match">${escapeHtml(m2.home)} vs ${escapeHtml(m2.away)}</span> →`;
      html += `</div>`;

      html += `<div class="outcomes-grid-scroll"><table class="outcomes-grid">`;
      html += `<thead><tr><th></th>${colHdrs.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
      html += `<tbody>`;

      for (let row = 0; row < 3; row++) {
        html += `<tr><th>${rowHdrs[row]}</th>`;
        for (let col = 0; col < 3; col++) {
          const { standings } = scenarios[row * 3 + col];
          const first = standings.find(s => s.rank === 1);
          const second = standings.find(s => s.rank === 2);
          const third = hasThird ? standings.find(s => s.rank === 3) : null;
          const highlight = contested.some(t => standings.find(s => s.team === t)?.rank <= 2)
            || thirdOnly.some(t => standings.find(s => s.team === t)?.rank === 3);
          const hasTie = standings.some(s => s.tiedNote);
          html += `<td class="${highlight ? "outcomes-cell-hl" : ""}">`;
          if (first) html += `<div class="outcomes-cell-row"><span class="outcomes-seed-num">1</span>${flag(first.team)} ${escapeHtml(first.team)}</div>`;
          if (second) html += `<div class="outcomes-cell-row"><span class="outcomes-seed-num">2</span>${flag(second.team)} ${escapeHtml(second.team)}</div>`;
          if (hasThird && third) html += `<div class="outcomes-cell-row outcomes-cell-third"><span class="outcomes-seed-num">3</span>${flag(third.team)} ${escapeHtml(third.team)}</div>`;
          if (hasTie) html += `<div class="outcomes-tie">*tie</div>`;
          html += `</td>`;
        }
        html += `</tr>`;
      }
      html += `</tbody></table></div>`;
      if (hasThird) html += `<p class="outcomes-note">3rd-place teams enter the best-8 cross-group qualifying race — advancement not guaranteed.</p>`;
      html += `</div>`;

    } else {
      // Flat list for 1 or 3+ unplayed matches
      html += `<div class="outcomes-grid-scroll"><table class="outcomes-flat">`;
      html += `<thead><tr>`;
      for (const m of unplayed) html += `<th>${escapeHtml(m.home)} vs ${escapeHtml(m.away)}</th>`;
      html += `<th>1st</th><th>2nd</th>`;
      if (hasThird) html += `<th>3rd</th>`;
      html += `</tr></thead><tbody>`;
      for (const { combo, standings } of scenarios) {
        const first = standings.find(s => s.rank === 1);
        const second = standings.find(s => s.rank === 2);
        const third = hasThird ? standings.find(s => s.rank === 3) : null;
        const highlight = contested.some(t => standings.find(s => s.team === t)?.rank <= 2);
        html += `<tr class="${highlight ? "outcomes-cell-hl" : ""}">`;
        for (const c of combo) {
          const lbl = c.homeScore > c.awayScore ? `${flag(c.home)} win` : c.homeScore === c.awayScore ? "Draw" : `${flag(c.away)} win`;
          html += `<td>${lbl}</td>`;
        }
        html += `<td>${first ? `${flag(first.team)} ${escapeHtml(first.team)}` : "?"}</td>`;
        html += `<td>${second ? `${flag(second.team)} ${escapeHtml(second.team)}` : "?"}</td>`;
        if (hasThird) html += `<td class="outcomes-cell-third">${third ? `${flag(third.team)} ${escapeHtml(third.team)}` : "?"}</td>`;
        html += `</tr>`;
      }
      html += `</tbody></table></div>`;
      if (hasThird) html += `<p class="outcomes-note">3rd-place teams enter the best-8 cross-group qualifying race — advancement not guaranteed.</p>`;
    }
  }

  // R32 section
  if (r32First || r32Second) {
    html += `<div class="outcomes-r32">`;
    html += `<div class="outcomes-r32-title">Round of 32 matchups</div>`;
    if (r32First) html += `<div class="outcomes-r32-row"><span class="outcomes-seed-chip">1st seed</span> vs <span class="outcomes-r32-opp">${escapeHtml(r32First.oppLabel)}</span></div>`;
    if (r32Second) html += `<div class="outcomes-r32-row"><span class="outcomes-seed-chip">2nd seed</span> vs <span class="outcomes-r32-opp">${escapeHtml(r32Second.oppLabel)}</span></div>`;
    html += `</div>`;
  }

  return html;
}

function wireOutcomesButtons() {
  document.querySelectorAll(".outcomes-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group;
      const groupTeams = _groupTeamsMap[group];
      if (!groupTeams) return;
      const outcomes = computeGroupOutcomes(group, groupTeams, _mergedMatches);
      if (!outcomes) return;
      document.getElementById("outcomes-modal-body").innerHTML = outcomesModalHtml(group, outcomes);
      const modal = document.getElementById("outcomes-modal");
      modal.style.display = "flex";
      modal.focus();
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

// Outcomes modal close handlers
const _outcomesModal = document.getElementById("outcomes-modal");
document.getElementById("outcomes-modal-close").addEventListener("click", () => {
  _outcomesModal.style.display = "none";
});
_outcomesModal.addEventListener("click", e => {
  if (e.target === _outcomesModal) _outcomesModal.style.display = "none";
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && _outcomesModal.style.display === "flex") _outcomesModal.style.display = "none";
});

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
