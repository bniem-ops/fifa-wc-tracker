// Standings engine for the FIFA World Cup 2026 group stage.
//
// Tiebreaker order implemented (2026 rules — head-to-head comes BEFORE
// overall goal difference, which is new this cycle):
//   1. Points
//   2. Head-to-head points (only among the tied teams' own matches)
//   3. Head-to-head goal difference
//   4. Head-to-head goals scored
//   5. Overall group goal difference
//   6. Overall group goals scored
//   7. Fair-play / FIFA ranking — NOT IMPLEMENTED (no card or ranking data
//      available). Teams still tied after step 6 are flagged with
//      `tiedNote` instead of being silently ordered, so the UI can be
//      honest about the limitation rather than guessing.
//
// Third-place cross-group ranking has no head-to-head step (those teams
// never played each other), so it goes straight to points -> GD -> goals.

/** Derives {group: [team, team, team, team]} straight from a match list,
 *  in first-seen order, so the live app never has to depend on the
 *  static seed file once Firestore has been seeded. */
export function buildGroupsFromMatches(matches) {
  const groups = {};
  for (const match of matches) {
    if (!groups[match.group]) groups[match.group] = [];
    for (const team of [match.home, match.away]) {
      if (!groups[match.group].includes(team)) groups[match.group].push(team);
    }
  }
  return groups;
}

/** Merges what-if overrides (keyed by match id -> {homeScore, awayScore})
 *  on top of the real match list, marking those matches "played" for the
 *  purposes of computation without mutating Firestore. */
export function applyOverrides(matches, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return matches;
  return matches.map((m) => {
    const o = overrides[m.id];
    if (!o) return m;
    return { ...m, homeScore: o.homeScore, awayScore: o.awayScore, status: "played" };
  });
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function baseStats(team, matches) {
  let p = 0, w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const match of matches) {
    if (match.status !== "played") continue;
    if (match.home !== team && match.away !== team) continue;
    const gfor = match.home === team ? match.homeScore : match.awayScore;
    const gagainst = match.home === team ? match.awayScore : match.homeScore;
    p++;
    gf += gfor;
    ga += gagainst;
    if (gfor > gagainst) w++;
    else if (gfor === gagainst) d++;
    else l++;
  }
  return { team, p, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d };
}

// Sorts objects (each with a `.team`) into ordered "tiers" of equal rank
// according to the given numeric keys, descending. Returns an array of
// arrays of team names, best tier first.
function tierBy(arr, keys) {
  const sorted = [...arr].sort((a, b) => {
    for (const k of keys) {
      if (b[k] !== a[k]) return b[k] - a[k];
    }
    return 0;
  });
  const tiers = [];
  for (const item of sorted) {
    const last = tiers[tiers.length - 1];
    if (last && keys.every((k) => last.sample[k] === item[k])) {
      last.teams.push(item.team);
    } else {
      tiers.push({ sample: item, teams: [item.team] });
    }
  }
  return tiers.map((t) => t.teams);
}

function resolveTier(tier, groupMatches) {
  if (tier.length === 1) return [tier[0]];

  const tierTeams = tier.map((s) => s.team);
  const h2hMatches = groupMatches.filter(
    (m) => m.status === "played" && tierTeams.includes(m.home) && tierTeams.includes(m.away)
  );
  const h2hStats = tierTeams.map((t) => baseStats(t, h2hMatches));
  const h2hTiers = tierBy(h2hStats, ["pts", "gd", "gf"]);

  const result = [];
  for (const subtierTeams of h2hTiers) {
    if (subtierTeams.length === 1) {
      result.push(tier.find((s) => s.team === subtierTeams[0]));
      continue;
    }
    // Still tied on head-to-head -> fall back to overall group GD/goals.
    const subtierStats = subtierTeams.map((t) => tier.find((s) => s.team === t));
    const overallTiers = tierBy(subtierStats, ["gd", "gf"]);
    for (const finalTeams of overallTiers) {
      if (finalTeams.length === 1) {
        result.push(subtierStats.find((s) => s.team === finalTeams[0]));
      } else {
        const stillTied = finalTeams
          .map((t) => subtierStats.find((s) => s.team === t))
          .sort((a, b) => a.team.localeCompare(b.team));
        for (const t of stillTied) {
          t.tiedNote = "Unresolved tie (would need fair-play cards or FIFA ranking to separate)";
        }
        result.push(...stillTied);
      }
    }
  }
  return result;
}

/** Ranks the 4 teams in a group, applying the full tiebreaker ladder. */
export function computeGroupStandings(group, groupTeams, allMatches) {
  const groupMatches = allMatches.filter(
    (m) => groupTeams.includes(m.home) && groupTeams.includes(m.away)
  );
  const groupComplete = groupMatches.every((m) => m.status === "played");

  const stats = groupTeams.map((team) => {
    const s = baseStats(team, groupMatches);
    s.group = group;
    s.remainingMatches = groupMatches.filter(
      (m) => m.status === "upcoming" && (m.home === team || m.away === team)
    ).length;
    s.maxPts = s.pts + 3 * s.remainingMatches;
    s.groupComplete = groupComplete;
    return s;
  });

  const ptsTiers = tierBy(stats, ["pts"]);
  const ranked = [];
  for (const teamsAtThisPts of ptsTiers) {
    const tierStats = teamsAtThisPts.map((t) => stats.find((s) => s.team === t));
    ranked.push(...resolveTier(tierStats, groupMatches));
  }
  ranked.forEach((s, i) => (s.rank = i + 1));
  return ranked;
}

/** Cross-group ranking of the 12 third-place teams (no head-to-head step). */
export function computeThirdPlaceRanking(groupStandingsByGroup) {
  const thirds = Object.values(groupStandingsByGroup).map((standings) => standings[2]);
  const tiers = tierBy(thirds, ["pts", "gd", "gf"]);

  const ranked = [];
  let rank = 1;
  for (const teamNames of tiers) {
    const tierObjs = teamNames.map((t) => thirds.find((x) => x.team === t));
    const start = rank;
    const end = rank + tierObjs.length - 1;
    for (const o of tierObjs) {
      ranked.push({ ...o, rankStart: start, rankEnd: end });
    }
    rank = end + 1;
  }
  return ranked.sort((a, b) => a.rankStart - b.rankStart);
}

function teamStatus(standing, thirdPlaceEntry, allGroupsComplete) {
  const { rank, groupComplete, maxPts, pts, group } = standing;

  if (!groupComplete) {
    // Can this team still be caught by enough rivals to drop out of top 2?
    // (Computed by caller via rivalsCouldCatch passed on the object.)
    if (standing.rivalsCouldCatch <= 1) {
      return { code: "QUALIFIED", label: "Qualified", detail: "Clinched top 2 — no longer catchable" };
    }
    return { code: "ALIVE", label: "Alive", detail: `${standing.remainingMatches} match(es) left in Group ${group}` };
  }

  if (rank === 1 || rank === 2) {
    return { code: "QUALIFIED", label: "Qualified", detail: `Finished ${ordinal(rank)} in Group ${group}` };
  }
  if (rank === 4) {
    return { code: "ELIMINATED", label: "Eliminated", detail: `Finished 4th in Group ${group}` };
  }

  // rank === 3: depends on the cross-group third-place race.
  if (!allGroupsComplete) {
    const rankText =
      thirdPlaceEntry.rankStart === thirdPlaceEntry.rankEnd
        ? `${ordinal(thirdPlaceEntry.rankStart)}`
        : `tied ${ordinal(thirdPlaceEntry.rankStart)}–${ordinal(thirdPlaceEntry.rankEnd)}`;
    return {
      code: "ALIVE",
      label: "Alive — 3rd place race",
      detail: `Currently ${rankText} among 3rd-place teams (provisional, other groups still playing)`,
    };
  }
  if (thirdPlaceEntry.rankEnd <= 8) {
    return { code: "QUALIFIED", label: "Qualified", detail: `Best 3rd-place teams: finished ${ordinal(thirdPlaceEntry.rankStart)}` };
  }
  if (thirdPlaceEntry.rankStart > 8) {
    return { code: "ELIMINATED", label: "Eliminated", detail: `Best 3rd-place teams: finished ${ordinal(thirdPlaceEntry.rankStart)}` };
  }
  return {
    code: "CONTESTED",
    label: "Tie unresolved",
    detail: "Tied across groups for the final qualifying spot — not enough data (cards/ranking) to separate",
  };
}

/**
 * Top-level entry point: given every match (real + any what-if overrides
 * merged in) and the group->teams map, returns full standings, the
 * third-place cross-group ranking, and a status for every team.
 */
export function computeAllStandings(allMatches, GROUPS) {
  const groupStandings = {};
  for (const [group, teams] of Object.entries(GROUPS)) {
    groupStandings[group] = computeGroupStandings(group, teams, allMatches);
  }

  // Attach rivalsCouldCatch and clinched1st for status checks.
  for (const [group, standings] of Object.entries(groupStandings)) {
    const groupMatches = allMatches.filter((m) =>
      standings.some((s) => s.team === m.home) && standings.some((s) => s.team === m.away)
    );
    for (const s of standings) {
      const others = standings.filter((o) => o.team !== s.team);
      s.rivalsCouldCatch = others.filter((o) => o.maxPts >= s.pts).length;

      // A team has clinched 1st if every rival who could still match their points
      // has already been beaten head-to-head (guaranteeing H2H pts advantage).
      const potentialCatchers = others.filter((o) => o.maxPts >= s.pts);
      s.clinched1st = !s.groupComplete && potentialCatchers.every((rival) => {
        const h2h = groupMatches.find(
          (m) => m.status === "played" &&
            ((m.home === s.team && m.away === rival.team) ||
             (m.home === rival.team && m.away === s.team))
        );
        if (!h2h) return false;
        const sGoals = h2h.home === s.team ? h2h.homeScore : h2h.awayScore;
        const rGoals = h2h.home === s.team ? h2h.awayScore : h2h.homeScore;
        return sGoals > rGoals;
      });
    }
  }

  const allGroupsComplete = Object.values(groupStandings).every((s) => s[0].groupComplete);
  const thirdPlace = computeThirdPlaceRanking(groupStandings);

  const statuses = {};
  for (const standings of Object.values(groupStandings)) {
    for (const s of standings) {
      const thirdEntry = s.rank === 3 ? thirdPlace.find((t) => t.team === s.team) : null;
      statuses[s.team] = teamStatus(s, thirdEntry, allGroupsComplete);
    }
  }

  return { groupStandings, thirdPlace, allGroupsComplete, statuses };
}
