import { R32_FIXTURES, THIRD_SLOT_CANDIDATES, resolveThirdPlaceSlots } from "./bracket-data.js";

/**
 * Resolves all 16 Round of 32 fixtures against a given set of group
 * standings. Safe to call even when groupStandings is incomplete or empty
 * (e.g. before Firestore data has loaded) — every lookup is guarded, so
 * unresolved slots come back as { team: null, ... } instead of throwing.
 */
export function resolveBracket(groupStandings, thirdPlace, allGroupsComplete) {
  let slotAssignment = null;
  let statusNote = "";

  if (!allGroupsComplete) {
    statusNote = "Third-place slots lock in once every group has played all 3 matches. Showing what's confirmed so far.";
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

  function describeSlot(descriptor) {
    if (descriptor.type === "winner" || descriptor.type === "runnerup") {
      const idx = descriptor.type === "winner" ? 0 : 1;
      const standing = groupStandings?.[descriptor.group]?.[idx];
      const label = `${descriptor.type === "winner" ? "Winner" : "Runner-up"} Group ${descriptor.group}`;
      if (!standing) return { team: null, label, sub: "Loading…" };
      if (!standing.groupComplete) return { team: null, label, sub: `Group ${descriptor.group} in progress` };
      if (standing.tiedNote) return { team: null, label, sub: "Tied — insufficient data to separate" };
      return { team: standing.team, label, sub: null };
    }
    const candidates = THIRD_SLOT_CANDIDATES[descriptor.slot].join("/");
    const label = `Best 3rd Group ${candidates}`;
    if (!slotAssignment) return { team: null, label, sub: "3rd-place race still in progress" };
    const group = slotAssignment[descriptor.slot];
    const standing = groupStandings?.[group]?.[2];
    if (!standing) return { team: null, label, sub: "Loading…" };
    if (standing.tiedNote) return { team: null, label, sub: "Tied — insufficient data to separate" };
    return { team: standing.team, label: `3rd Group ${group}`, sub: null };
  }

  const fixtures = R32_FIXTURES.map((fx) => ({
    ...fx,
    home: describeSlot(fx.home),
    away: describeSlot(fx.away),
  }));

  return { fixtures, statusNote };
}
