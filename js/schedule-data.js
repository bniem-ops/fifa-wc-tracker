// Master schedule for the FIFA World Cup 2026 group stage.
// This is the SOURCE OF TRUTH used once, by the admin "Import Schedule"
// button, to seed Firestore. After that, Firestore is the source of truth
// and this file is no longer read by the live app.
//
// homeScore/awayScore are null for matches not yet played.
// IDs are deterministic: <group><matchNumberInGroup>, e.g. "A1".."A6".

export const SCHEDULE = [
  // Group A
  m("A", 1, 1, "2026-06-11", "Mexico", "South Africa", 2, 0),
  m("A", 2, 1, "2026-06-11", "South Korea", "Czechia", 2, 1),
  m("A", 3, 2, "2026-06-18", "Czechia", "South Africa", 1, 1),
  m("A", 4, 2, "2026-06-18", "Mexico", "South Korea", 1, 0),
  m("A", 5, 3, "2026-06-24", "Czechia", "Mexico", null, null),
  m("A", 6, 3, "2026-06-24", "South Africa", "South Korea", null, null),

  // Group B
  m("B", 1, 1, "2026-06-12", "Canada", "Bosnia and Herzegovina", 1, 1),
  m("B", 2, 1, "2026-06-13", "Qatar", "Switzerland", 1, 1),
  m("B", 3, 2, "2026-06-18", "Switzerland", "Bosnia and Herzegovina", 4, 1),
  m("B", 4, 2, "2026-06-18", "Canada", "Qatar", 6, 0),
  m("B", 5, 3, "2026-06-24", "Switzerland", "Canada", null, null),
  m("B", 6, 3, "2026-06-24", "Bosnia and Herzegovina", "Qatar", null, null),

  // Group C
  m("C", 1, 1, "2026-06-13", "Brazil", "Morocco", 1, 1),
  m("C", 2, 1, "2026-06-13", "Haiti", "Scotland", 0, 1),
  m("C", 3, 2, "2026-06-19", "Scotland", "Morocco", 0, 1),
  m("C", 4, 2, "2026-06-19", "Brazil", "Haiti", 3, 0),
  m("C", 5, 3, "2026-06-24", "Scotland", "Brazil", null, null),
  m("C", 6, 3, "2026-06-24", "Morocco", "Haiti", null, null),

  // Group D
  m("D", 1, 1, "2026-06-12", "United States", "Paraguay", 4, 1),
  m("D", 2, 1, "2026-06-14", "Australia", "Turkey", 2, 0),
  m("D", 3, 2, "2026-06-19", "United States", "Australia", 2, 0),
  m("D", 4, 2, "2026-06-19", "Turkey", "Paraguay", 0, 1),
  m("D", 5, 3, "2026-06-25", "Turkey", "United States", null, null),
  m("D", 6, 3, "2026-06-25", "Paraguay", "Australia", null, null),

  // Group E
  m("E", 1, 1, "2026-06-14", "Germany", "Curacao", 7, 1),
  m("E", 2, 1, "2026-06-14", "Ivory Coast", "Ecuador", 1, 0),
  m("E", 3, 2, "2026-06-20", "Germany", "Ivory Coast", null, null),
  m("E", 4, 2, "2026-06-20", "Ecuador", "Curacao", null, null),
  m("E", 5, 3, "2026-06-25", "Ecuador", "Germany", null, null),
  m("E", 6, 3, "2026-06-25", "Curacao", "Ivory Coast", null, null),

  // Group F
  m("F", 1, 1, "2026-06-14", "Netherlands", "Japan", 2, 2),
  m("F", 2, 1, "2026-06-14", "Sweden", "Tunisia", 5, 1),
  m("F", 3, 2, "2026-06-20", "Netherlands", "Sweden", null, null),
  m("F", 4, 2, "2026-06-21", "Tunisia", "Japan", null, null),
  m("F", 5, 3, "2026-06-25", "Tunisia", "Netherlands", null, null),
  m("F", 6, 3, "2026-06-25", "Japan", "Sweden", null, null),

  // Group G
  m("G", 1, 1, "2026-06-15", "Belgium", "Egypt", 1, 1),
  m("G", 2, 1, "2026-06-15", "Iran", "New Zealand", 2, 2),
  m("G", 3, 2, "2026-06-21", "Belgium", "Iran", null, null),
  m("G", 4, 2, "2026-06-21", "New Zealand", "Egypt", null, null),
  m("G", 5, 3, "2026-06-26", "New Zealand", "Belgium", null, null),
  m("G", 6, 3, "2026-06-26", "Egypt", "Iran", null, null),

  // Group H
  m("H", 1, 1, "2026-06-15", "Spain", "Cape Verde", 0, 0),
  m("H", 2, 1, "2026-06-15", "Saudi Arabia", "Uruguay", 1, 1),
  m("H", 3, 2, "2026-06-21", "Spain", "Saudi Arabia", null, null),
  m("H", 4, 2, "2026-06-21", "Uruguay", "Cape Verde", null, null),
  m("H", 5, 3, "2026-06-26", "Uruguay", "Spain", null, null),
  m("H", 6, 3, "2026-06-26", "Cape Verde", "Saudi Arabia", null, null),

  // Group I
  m("I", 1, 1, "2026-06-16", "France", "Senegal", 3, 1),
  m("I", 2, 1, "2026-06-16", "Iraq", "Norway", 1, 4),
  m("I", 3, 2, "2026-06-22", "France", "Iraq", null, null),
  m("I", 4, 2, "2026-06-22", "Norway", "Senegal", null, null),
  m("I", 5, 3, "2026-06-26", "Norway", "France", null, null),
  m("I", 6, 3, "2026-06-26", "Senegal", "Iraq", null, null),

  // Group J
  m("J", 1, 1, "2026-06-16", "Argentina", "Algeria", 3, 0),
  m("J", 2, 1, "2026-06-17", "Austria", "Jordan", 3, 1),
  m("J", 3, 2, "2026-06-22", "Argentina", "Austria", null, null),
  m("J", 4, 2, "2026-06-22", "Jordan", "Algeria", null, null),
  m("J", 5, 3, "2026-06-27", "Jordan", "Argentina", null, null),
  m("J", 6, 3, "2026-06-27", "Algeria", "Austria", null, null),

  // Group K
  m("K", 1, 1, "2026-06-17", "Portugal", "DR Congo", 1, 1),
  m("K", 2, 1, "2026-06-17", "Uzbekistan", "Colombia", 1, 3),
  m("K", 3, 2, "2026-06-23", "Portugal", "Uzbekistan", null, null),
  m("K", 4, 2, "2026-06-23", "Colombia", "DR Congo", null, null),
  m("K", 5, 3, "2026-06-27", "Colombia", "Portugal", null, null),
  m("K", 6, 3, "2026-06-27", "DR Congo", "Uzbekistan", null, null),

  // Group L
  m("L", 1, 1, "2026-06-17", "England", "Croatia", 4, 2),
  m("L", 2, 1, "2026-06-17", "Ghana", "Panama", 1, 0),
  m("L", 3, 2, "2026-06-23", "England", "Ghana", null, null),
  m("L", 4, 2, "2026-06-23", "Panama", "Croatia", null, null),
  m("L", 5, 3, "2026-06-27", "Panama", "England", null, null),
  m("L", 6, 3, "2026-06-27", "Croatia", "Ghana", null, null),
];

function m(group, num, matchday, date, home, away, homeScore, awayScore) {
  return {
    id: `${group}${num}`,
    group,
    matchday,
    date,
    home,
    away,
    homeScore,
    awayScore,
    status: homeScore == null ? "upcoming" : "played",
  };
}

// Derived: which group each team belongs to, in first-seen order.
export const GROUPS = {};
for (const match of SCHEDULE) {
  if (!GROUPS[match.group]) GROUPS[match.group] = [];
  for (const team of [match.home, match.away]) {
    if (!GROUPS[match.group].includes(team)) GROUPS[match.group].push(team);
  }
}

// Flag emoji per team, for display only. Falls back to a blank flag.
export const FLAGS = {
  "Mexico": "🇲🇽", "South Africa": "🇿🇦", "South Korea": "🇰🇷", "Czechia": "🇨🇿",
  "Canada": "🇨🇦", "Bosnia and Herzegovina": "🇧🇦", "Qatar": "🇶🇦", "Switzerland": "🇨🇭",
  "Brazil": "🇧🇷", "Morocco": "🇲🇦", "Haiti": "🇭🇹", "Scotland": "🏴",
  "United States": "🇺🇸", "Paraguay": "🇵🇾", "Australia": "🇦🇺", "Turkey": "🇹🇷",
  "Germany": "🇩🇪", "Curacao": "🇨🇼", "Ivory Coast": "🇨🇮", "Ecuador": "🇪🇨",
  "Netherlands": "🇳🇱", "Japan": "🇯🇵", "Sweden": "🇸🇪", "Tunisia": "🇹🇳",
  "Belgium": "🇧🇪", "Egypt": "🇪🇬", "Iran": "🇮🇷", "New Zealand": "🇳🇿",
  "Spain": "🇪🇸", "Cape Verde": "🇨🇻", "Saudi Arabia": "🇸🇦", "Uruguay": "🇺🇾",
  "France": "🇫🇷", "Senegal": "🇸🇳", "Iraq": "🇮🇶", "Norway": "🇳🇴",
  "Argentina": "🇦🇷", "Algeria": "🇩🇿", "Austria": "🇦🇹", "Jordan": "🇯🇴",
  "Portugal": "🇵🇹", "DR Congo": "🇨🇩", "Uzbekistan": "🇺🇿", "Colombia": "🇨🇴",
  "England": "🏴", "Croatia": "🇭🇷", "Ghana": "🇬🇭", "Panama": "🇵🇦",
};
