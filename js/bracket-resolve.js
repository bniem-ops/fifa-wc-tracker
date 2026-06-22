import { KNOCKOUT_MATCHES, THIRD_SLOT_CANDIDATES, resolveThirdPlaceSlots } from "./bracket-data.js";

/**
 * Resolves all 32 knockout matches (Round of 32 through Final, plus the
 * Third Place Match) against group standings and any actual knockout
 * results recorded so far.
 *
 * Matches are processed in ascending number order (73 -> 104), which is
 * always a valid topological order here: every later-round match only
 * ever references earlier-numbered matches as its feeders, so a single
 * forward pass resolves the whole bracket with no recursion needed.
 *
 * @param groupStandings  output of computeAllStandings(...).groupStandings
 * @param thirdPlace      output of computeAllStandings(...).thirdPlace
 * @param allGroupsComplete  output of computeAllStandings(...).allGroupsComplete
 * @param knockoutResults  { [matchNum]: { homeScore, awayScore, wentToPenalties, homePens, awayPens, status } }
 *
 * Returns { matchesByNum, statusNote } where matchesByNum[num] is
 * { ...matchDef, home: {team,code,label,sub}, away: {...}, winner, loser, result }
 */
export function resolveKnockoutBracket(groupStandings, thirdPlace, allGroupsComplete, knockoutResults = {}) {
  let slotAssignment = null;
  let statusNote = "";

  if (!allGroupsComplete) {
    statusNote = "Round of 32 third-place slots lock in once every group has played all 3 matches. Showing what's confirmed so far.";
  } else {
    const straddles = (thirdPlace || []).some((t) => t.rankStart <= 8 && t.rankEnd > 8);
    if (straddles) {
      statusNote = "The 8th qualifying 3rd-place spot is tied and can't be resolved without fair-play/FIFA-ranking data — those slots show as TBD.";
    } else {
      const qualifyingGroups = thirdPlace.filter((t) => t.rankStart <= 8).map((t) => t.group);
      slotAssignment = resolveThirdPlaceSlots(qualifyingGroups);
      if (!slotAssignment) statusNote = "Couldn't resolve the third-place combination — this shouldn't happen.";
    }
  }

  const matchesByNum = {};

  function describeSlot(descriptor) {
    if (descriptor.type === "winner" || descriptor.type === "runnerup") {
      const idx = descriptor.type === "winner" ? 0 : 1;
      const standing = groupStandings?.[descriptor.group]?.[idx];
      const code = `${descriptor.group}${idx + 1}`;
      const label = `${descriptor.type === "winner" ? "Winner" : "Runner-up"} Group ${descriptor.group}`;
      if (!standing) return { team: null, code, label, sub: "Loading…" };
      if (standing.groupComplete) {
        if (standing.tiedNote) return { team: null, code, label, sub: "Tied — insufficient data to separate" };
        return { team: standing.team, code, label, sub: null };
      }
      const clinched = descriptor.type === "winner" ? standing.clinched1st : standing.clinched2nd;
      if (clinched) return { team: standing.team, code, label, sub: null };
      return { team: null, code, label, sub: `Group ${descriptor.group} in progress` };
    }

    if (descriptor.type === "third") {
      const candidates = THIRD_SLOT_CANDIDATES[descriptor.slot].join("/");
      const label = `Best 3rd Group ${candidates}`;
      if (!slotAssignment) return { team: null, code: "3rd", label, sub: "3rd-place race still in progress" };
      const group = slotAssignment[descriptor.slot];
      const standing = groupStandings?.[group]?.[2];
      const code = `${group}3`;
      if (!standing) return { team: null, code, label, sub: "Loading…" };
      if (standing.tiedNote) return { team: null, code, label, sub: "Tied — insufficient data to separate" };
      return { team: standing.team, code, label: `3rd Group ${group}`, sub: null };
    }

    // winnerOf / loserOf a prior match — that match is guaranteed to already
    // be in matchesByNum since match numbers only ever reference lower ones.
    const prior = matchesByNum[descriptor.match];
    const isWinner = descriptor.type === "winnerOf";
    const code = `${isWinner ? "W" : "L"}${descriptor.match}`;
    const label = `${isWinner ? "Winner" : "Loser"} Match ${descriptor.match}`;
    const team = prior ? (isWinner ? prior.winner : prior.loser) : null;
    if (team) return { team, code, label, sub: null };
    return { team: null, code, label, sub: prior && !prior.home.team ? "Teams not yet determined" : "Match not yet played" };
  }

  for (const match of KNOCKOUT_MATCHES) {
    const home = describeSlot(match.home);
    const away = describeSlot(match.away);
    const kr = knockoutResults[match.num];

    let winner = null;
    let loser = null;
    let result = null;

    if (kr && kr.status === "played" && home.team && away.team) {
      let winnerSide = null;
      if (kr.homeScore !== kr.awayScore) {
        winnerSide = kr.homeScore > kr.awayScore ? "home" : "away";
      } else if (kr.wentToPenalties && kr.homePens !== kr.awayPens) {
        winnerSide = kr.homePens > kr.awayPens ? "home" : "away";
      }
      if (winnerSide) {
        winner = winnerSide === "home" ? home.team : away.team;
        loser = winnerSide === "home" ? away.team : home.team;
        result = kr;
      }
    }

    matchesByNum[match.num] = { ...match, home, away, winner, loser, result };
  }

  return { matchesByNum, statusNote };
}
