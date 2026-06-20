import { SCHEDULE, GROUPS } from "./js/schedule-data.js";
import { computeAllStandings, ordinal } from "./js/standings-engine.js";

const { groupStandings, thirdPlace, allGroupsComplete, statuses } = computeAllStandings(SCHEDULE, GROUPS);

console.log("allGroupsComplete:", allGroupsComplete);
console.log();

for (const [group, standings] of Object.entries(groupStandings)) {
  console.log(`Group ${group}`);
  for (const s of standings) {
    const st = statuses[s.team];
    console.log(
      `  ${s.rank}. ${s.team.padEnd(24)} P${s.p} W${s.w} D${s.d} L${s.l} GF${s.gf} GA${s.ga} GD${s.gd >= 0 ? "+" : ""}${s.gd} Pts${s.pts}` +
      `  [${st.code}] ${st.detail}` + (s.tiedNote ? `  ** ${s.tiedNote}` : "")
    );
  }
  console.log();
}

console.log("Third-place cross-group ranking:");
for (const t of thirdPlace) {
  console.log(`  ${t.rankStart === t.rankEnd ? t.rankStart : t.rankStart + "-" + t.rankEnd}. ${t.team.padEnd(24)} Group ${t.group}  Pts${t.pts} GD${t.gd} GF${t.gf}  [${statuses[t.team].code}]`);
}
