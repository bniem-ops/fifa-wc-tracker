import { computeGroupStandings } from "./standings-engine.js";
import { KNOCKOUT_MATCHES } from "./bracket-data.js";
import { FLAGS } from "./schedule-data.js";

const flag = t => FLAGS[t] || "🏳️";
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const RESULT_COMBOS = [
  { homeScore: 2, awayScore: 0 },
  { homeScore: 1, awayScore: 1 },
  { homeScore: 0, awayScore: 2 },
];

function r32Info(group, seed) {
  const sideType = seed === 1 ? "winner" : "runnerup";
  const match = KNOCKOUT_MATCHES.find(m =>
    m.round === "R32" && (
      (m.home.type === sideType && m.home.group === group) ||
      (m.away.type === sideType && m.away.group === group)
    )
  );
  if (!match) return null;
  const isHome = match.home.type === sideType && match.home.group === group;
  const opp = isHome ? match.away : match.home;
  let oppLabel;
  if (opp.type === "winner") oppLabel = `Group ${opp.group} 1st seed`;
  else if (opp.type === "runnerup") oppLabel = `Group ${opp.group} 2nd seed`;
  else if (opp.type === "third") oppLabel = `Best 3rd — slot ${opp.slot}`;
  else oppLabel = "TBD";
  return { matchNum: match.num, oppLabel, date: match.date };
}

function resultLabel(home, away, homeScore, awayScore) {
  if (homeScore > awayScore) return `${flag(home)} ${esc(home)} win`;
  if (homeScore === awayScore) return "Draw";
  return `${flag(away)} ${esc(away)} win`;
}

/**
 * Enumerate all 3^n outcome scenarios for a group's remaining matches,
 * derive per-team status counts, and generate narrative bullets.
 * Returns null if the group is already complete.
 */
export function computeGroupOutcomes(group, groupTeams, allMatches) {
  const groupMatches = allMatches.filter(m =>
    groupTeams.includes(m.home) && groupTeams.includes(m.away)
  );
  const unplayed = groupMatches.filter(m => m.status === "upcoming");
  if (!unplayed.length) return null;

  // Build all 3^n result combinations
  const combos = [];
  (function recurse(idx, cur) {
    if (idx === unplayed.length) { combos.push([...cur]); return; }
    for (const r of RESULT_COMBOS) {
      cur.push({ ...unplayed[idx], ...r });
      recurse(idx + 1, cur);
      cur.pop();
    }
  })(0, []);

  const scenarios = combos.map(combo => {
    const sim = allMatches.map(m => {
      const o = combo.find(c => c.id === m.id);
      return o ? { ...m, homeScore: o.homeScore, awayScore: o.awayScore, status: "played" } : m;
    });
    return {
      combo,
      standings: computeGroupStandings(group, groupTeams, sim),
    };
  });

  const n = scenarios.length;

  // Count top-2 and 3rd-place finishes per team
  const top2Count = Object.fromEntries(groupTeams.map(t => [t, 0]));
  const thirdCount = Object.fromEntries(groupTeams.map(t => [t, 0]));
  for (const { standings } of scenarios) {
    for (const s of standings) {
      if (s.rank <= 2) top2Count[s.team]++;
      if (s.rank === 3) thirdCount[s.team]++;
    }
  }

  const clinched = groupTeams.filter(t => top2Count[t] === n);
  const eliminated = groupTeams.filter(t => top2Count[t] === 0 && thirdCount[t] === 0);
  const contested = groupTeams.filter(t => top2Count[t] > 0 && top2Count[t] < n);
  const thirdOnly = groupTeams.filter(t => top2Count[t] === 0 && thirdCount[t] > 0);

  // Generate narrative bullets
  const bullets = [];

  for (const t of clinched) {
    bullets.push({ kind: "ok", html: `${flag(t)} <strong>${esc(t)}</strong> has clinched qualification` });
  }
  for (const t of eliminated) {
    bullets.push({ kind: "out", html: `${flag(t)} <strong>${esc(t)}</strong> cannot advance — eliminated` });
  }

  // Per-match conditional bullets
  for (const match of unplayed) {
    const hw = scenarios.filter(s => s.combo.find(c => c.id === match.id).homeScore > s.combo.find(c => c.id === match.id).awayScore);
    const draw = scenarios.filter(s => { const c = s.combo.find(x => x.id === match.id); return c.homeScore === c.awayScore; });
    const aw = scenarios.filter(s => s.combo.find(c => c.id === match.id).homeScore < s.combo.find(c => c.id === match.id).awayScore);

    const qualIn = (team, scens) => scens.length > 0 && scens.every(s => s.standings.find(x => x.team === team)?.rank <= 2);
    const neverIn = (team, scens) => scens.every(s => (s.standings.find(x => x.team === team)?.rank ?? 9) > 2);

    const hContested = contested.includes(match.home);
    const aContested = contested.includes(match.away);

    if (hContested && aContested) {
      const hWinAdv = qualIn(match.home, hw) && neverIn(match.home, [...draw, ...aw]);
      const aWinAdv = qualIn(match.away, aw) && neverIn(match.away, [...draw, ...hw]);
      const drawKillsH = neverIn(match.home, draw);
      const drawKillsA = neverIn(match.away, draw);

      if (hWinAdv && aWinAdv) {
        if (drawKillsH && drawKillsA) {
          bullets.push({ kind: "cond", html: `Winner of ${flag(match.home)} <strong>${esc(match.home)}</strong> vs ${flag(match.away)} <strong>${esc(match.away)}</strong> advances — a draw eliminates both` });
        } else {
          bullets.push({ kind: "cond", html: `Winner of ${flag(match.home)} <strong>${esc(match.home)}</strong> vs ${flag(match.away)} <strong>${esc(match.away)}</strong> advances` });
        }
      } else {
        if (hWinAdv) bullets.push({ kind: "cond", html: `${flag(match.home)} <strong>${esc(match.home)}</strong> must win to advance` });
        if (aWinAdv) bullets.push({ kind: "cond", html: `${flag(match.away)} <strong>${esc(match.away)}</strong> must win to advance` });
        if (!hWinAdv && !aWinAdv && drawKillsH && drawKillsA) {
          bullets.push({ kind: "warn", html: `A draw eliminates both ${flag(match.home)} <strong>${esc(match.home)}</strong> and ${flag(match.away)} <strong>${esc(match.away)}</strong>` });
        }
      }
    } else if (hContested && qualIn(match.home, hw) && neverIn(match.home, [...draw, ...aw])) {
      bullets.push({ kind: "cond", html: `${flag(match.home)} <strong>${esc(match.home)}</strong> must win to advance` });
    } else if (aContested && qualIn(match.away, aw) && neverIn(match.away, [...draw, ...hw])) {
      bullets.push({ kind: "cond", html: `${flag(match.away)} <strong>${esc(match.away)}</strong> must win to advance` });
    }

    // Seeding: winner of this match claims 1st seed
    const hWins1st = hw.length > 0 && hw.every(s => s.standings.find(x => x.team === match.home)?.rank === 1);
    const aWins1st = aw.length > 0 && aw.every(s => s.standings.find(x => x.team === match.away)?.rank === 1);
    if (hWins1st && aWins1st) {
      bullets.push({ kind: "seed", html: `Winner of ${flag(match.home)} <strong>${esc(match.home)}</strong> vs ${flag(match.away)} <strong>${esc(match.away)}</strong> claims 1st seed` });
    }

    // 3rd-place race bullets
    const th = thirdOnly.filter(t => t === match.home || t === match.away);
    if (th.length === 2) {
      const h3 = thirdCount[match.home];
      const a3 = thirdCount[match.away];
      // Both fighting for 3rd-place slot
      const hwPts = hw[0] ? hw[0].standings.find(s => s.team === match.home)?.pts : null;
      const awPts = aw[0] ? aw[0].standings.find(s => s.team === match.away)?.pts : null;
      const drawPts = draw[0] ? draw[0].standings.find(s => {
        const rank = draw[0].standings.find(x => x.team === match.home)?.rank;
        return rank === 3 ? s.team === match.home : s.team === match.away;
      })?.pts : null;

      const drawHomeIs3rd = draw.length > 0 && draw[0].standings.find(x => x.team === match.home)?.rank === 3;
      if (draw.length > 0) {
        const drawSurvivor = drawHomeIs3rd ? match.home : match.away;
        const drawLoser = drawHomeIs3rd ? match.away : match.home;
        bullets.push({ kind: "warn", html: `A draw eliminates ${flag(drawLoser)} <strong>${esc(drawLoser)}</strong> and leaves ${flag(drawSurvivor)} <strong>${esc(drawSurvivor)}</strong> in the 3rd-place race with fewer points` });
      }
      if (hwPts != null && awPts != null && hwPts === awPts) {
        bullets.push({ kind: "info", html: `Winner of ${flag(match.home)} <strong>${esc(match.home)}</strong> vs ${flag(match.away)} <strong>${esc(match.away)}</strong> earns the group's 3rd-place slot and enters the best-8 race` });
      }
    } else if (th.length === 1) {
      const t = th[0];
      const isHome = t === match.home;
      const thirdScens = isHome ? hw : aw;
      const noThirdScens = isHome ? [...draw, ...aw] : [...draw, ...hw];
      const alwaysThirdWhenWin = thirdScens.every(s => s.standings.find(x => x.team === t)?.rank === 3);
      const eliminated4th = noThirdScens.every(s => s.standings.find(x => x.team === t)?.rank === 4);
      if (alwaysThirdWhenWin && eliminated4th) {
        bullets.push({ kind: "cond", html: `${flag(t)} <strong>${esc(t)}</strong> must win to enter the 3rd-place best-8 race` });
      }
    }
  }

  // Deduplicate bullets with identical html
  const seen = new Set();
  const uniqueBullets = bullets.filter(b => {
    if (seen.has(b.html)) return false;
    seen.add(b.html);
    return true;
  });

  return {
    unplayed,
    clinched,
    eliminated,
    contested,
    thirdOnly,
    scenarios,
    bullets: uniqueBullets,
    r32First: r32Info(group, 1),
    r32Second: r32Info(group, 2),
  };
}
