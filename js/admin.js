import {
  db, matchesCollection, knockoutMatchesCollection, doc, getDocs, setDoc, updateDoc,
  auth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "./firebase-init.js";
import { SCHEDULE, FLAGS } from "./schedule-data.js";
import { computeAllStandings, buildGroupsFromMatches } from "./standings-engine.js";
import { resolveKnockoutBracket } from "./bracket-resolve.js";
import { KNOCKOUT_MATCHES, ROUND_LABELS } from "./bracket-data.js";

const flag = (team) => FLAGS[team] || "🏳️";

const loginCard = document.getElementById("login-card");
const adminPanel = document.getElementById("admin-panel");
const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-msg");
const logoutBtn = document.getElementById("logout-btn");
const seedBtn = document.getElementById("seed-btn");
const seedMsg = document.getElementById("seed-msg");
const matchList = document.getElementById("match-list");
const knockoutList = document.getElementById("knockout-list");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginMsg.textContent = "Sign-in failed: " + err.message;
    loginMsg.className = "status-msg err";
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

seedBtn.addEventListener("click", async () => {
  const existing = await getDocs(matchesCollection);
  if (!existing.empty) {
    const ok = confirm(
      `The matches collection already has ${existing.size} documents. Importing again will overwrite any matches whose IDs match the schedule (A1, A2, ... L6) but won't touch anything else. Continue?`
    );
    if (!ok) return;
  }
  seedBtn.disabled = true;
  seedMsg.textContent = "Importing…";
  seedMsg.className = "status-msg";
  try {
    for (const match of SCHEDULE) {
      await setDoc(doc(db, "matches", match.id), match);
    }
    seedMsg.textContent = `Imported ${SCHEDULE.length} matches.`;
    seedMsg.className = "status-msg ok";
    await loadMatchList();
    await loadKnockoutList();
  } catch (err) {
    seedMsg.textContent = "Import failed: " + err.message;
    seedMsg.className = "status-msg err";
  } finally {
    seedBtn.disabled = false;
  }
});

async function loadMatchList() {
  const snap = await getDocs(matchesCollection);
  const matches = snap.docs.map((d) => d.data()).sort((a, b) => (a.id < b.id ? -1 : 1));

  matchList.innerHTML = matches
    .map(
      (m) => `
      <div class="admin-match-row" data-id="${m.id}">
        <span class="group-pill">${m.group}</span>
        <span class="teams">${flag(m.home)} ${m.home} <span style="color:var(--text-muted)">vs</span> ${m.away} ${flag(m.away)}</span>
        <span style="font-size:11px;color:var(--text-muted);">${m.date}</span>
        <input type="number" min="0" max="20" class="score-input" data-side="home" value="${m.homeScore ?? ""}" />
        <span style="color:var(--text-muted)">\u2013</span>
        <input type="number" min="0" max="20" class="score-input" data-side="away" value="${m.awayScore ?? ""}" />
        <button class="btn-ghost save-row" data-id="${m.id}">Save</button>
        <span class="row-msg" style="font-size:11px;"></span>
      </div>`
    )
    .join("");

  matchList.querySelectorAll(".save-row").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".admin-match-row");
      const id = row.dataset.id;
      const homeInput = row.querySelector('[data-side="home"]');
      const awayInput = row.querySelector('[data-side="away"]');
      const homeScore = homeInput.value === "" ? null : Number(homeInput.value);
      const awayScore = awayInput.value === "" ? null : Number(awayInput.value);
      const status = homeScore == null || awayScore == null ? "upcoming" : "played";
      const msgEl = row.querySelector(".row-msg");
      try {
        await updateDoc(doc(db, "matches", id), { homeScore, awayScore, status });
        msgEl.textContent = "Saved";
        msgEl.style.color = "var(--accent-green)";
        loadKnockoutList();
      } catch (err) {
        msgEl.textContent = "Failed: " + err.message;
        msgEl.style.color = "var(--accent-red)";
      }
      setTimeout(() => (msgEl.textContent = ""), 2000);
    });
  });
}

async function loadKnockoutList() {
  const [groupSnap, knockoutSnap] = await Promise.all([getDocs(matchesCollection), getDocs(knockoutMatchesCollection)]);
  const groupMatches = groupSnap.docs.map((d) => d.data());

  if (groupMatches.length === 0) {
    knockoutList.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Import the group schedule first — the bracket needs group results to know who's playing.</p>`;
    return;
  }

  const knockoutResults = {};
  knockoutSnap.docs.forEach((d) => (knockoutResults[Number(d.id)] = d.data()));

  const GROUPS = buildGroupsFromMatches(groupMatches);
  const { groupStandings, thirdPlace, allGroupsComplete } = computeAllStandings(groupMatches, GROUPS);
  const { matchesByNum } = resolveKnockoutBracket(groupStandings, thirdPlace, allGroupsComplete, knockoutResults);

  knockoutList.innerHTML = KNOCKOUT_MATCHES.map((def) => {
    const m = matchesByNum[def.num];
    const ready = Boolean(m.home.team && m.away.team);
    const r = m.result;
    const homeLabel = m.home.team ? `${flag(m.home.team)} ${m.home.team}` : `<span style="color:var(--text-muted)">${m.home.code}</span>`;
    const awayLabel = m.away.team ? `${flag(m.away.team)} ${m.away.team}` : `<span style="color:var(--text-muted)">${m.away.code}</span>`;

    if (!ready) {
      return `
        <div class="admin-match-row" style="opacity:0.55;">
          <span class="group-pill">${def.round}</span>
          <span class="teams">M${def.num}: ${homeLabel} <span style="color:var(--text-muted)">vs</span> ${awayLabel}</span>
          <span style="font-size:11px;color:var(--text-muted);">not yet determined</span>
        </div>`;
    }

    return `
      <div class="admin-match-row" data-num="${def.num}" data-home="${m.home.team}" data-away="${m.away.team}">
        <span class="group-pill">${def.round}</span>
        <span class="teams">M${def.num}: ${homeLabel} <span style="color:var(--text-muted)">vs</span> ${awayLabel}</span>
        <input type="number" min="0" max="20" class="score-input ko-score" data-side="home" value="${r ? r.homeScore : ""}" />
        <span style="color:var(--text-muted)">\u2013</span>
        <input type="number" min="0" max="20" class="score-input ko-score" data-side="away" value="${r ? r.awayScore : ""}" />
        <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
          <input type="checkbox" class="ko-pens-toggle" ${r && r.wentToPenalties ? "checked" : ""} /> Pens
        </label>
        <span class="ko-pens-inputs" style="display:${r && r.wentToPenalties ? "inline-flex" : "none"};gap:4px;align-items:center;">
          <input type="number" min="0" max="20" class="score-input ko-pens" data-side="home" value="${r && r.homePens != null ? r.homePens : ""}" />
          <span style="color:var(--text-muted)">\u2013</span>
          <input type="number" min="0" max="20" class="score-input ko-pens" data-side="away" value="${r && r.awayPens != null ? r.awayPens : ""}" />
        </span>
        <button class="btn-ghost save-row ko-save" data-num="${def.num}">Save</button>
        <span class="row-msg" style="font-size:11px;"></span>
      </div>`;
  }).join("");

  knockoutList.querySelectorAll(".ko-pens-toggle").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const wrap = e.target.closest(".admin-match-row").querySelector(".ko-pens-inputs");
      wrap.style.display = e.target.checked ? "inline-flex" : "none";
    });
  });

  knockoutList.querySelectorAll(".ko-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".admin-match-row");
      const num = Number(btn.dataset.num);
      const homeScore = Number(row.querySelector('.ko-score[data-side="home"]').value);
      const awayScore = Number(row.querySelector('.ko-score[data-side="away"]').value);
      const wentToPenalties = row.querySelector(".ko-pens-toggle").checked;
      const homePens = wentToPenalties ? Number(row.querySelector('.ko-pens[data-side="home"]').value) : null;
      const awayPens = wentToPenalties ? Number(row.querySelector('.ko-pens[data-side="away"]').value) : null;
      const msgEl = row.querySelector(".row-msg");

      if (homeScore === awayScore && (!wentToPenalties || homePens === awayPens)) {
        msgEl.textContent = "Knockout matches need a winner — check Pens if it was a draw.";
        msgEl.style.color = "var(--accent-red)";
        return;
      }

      const homeTeam = row.dataset.home;
      const awayTeam = row.dataset.away;
      const winner = wentToPenalties
        ? (homePens > awayPens ? homeTeam : awayTeam)
        : (homeScore > awayScore ? homeTeam : awayTeam);

      try {
        await setDoc(doc(db, "knockoutMatches", String(num)), {
          homeScore, awayScore, wentToPenalties, homePens, awayPens, status: "played", winner,
        });
        msgEl.textContent = "Saved";
        msgEl.style.color = "var(--accent-green)";
        loadKnockoutList(); // refresh so any now-determined later-round matches show up
      } catch (err) {
        msgEl.textContent = "Failed: " + err.message;
        msgEl.style.color = "var(--accent-red)";
      }
    });
  });
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginCard.style.display = "none";
    adminPanel.style.display = "block";
    document.getElementById("user-email").textContent = user.email;
    loadMatchList();
    loadKnockoutList();
  } else {
    loginCard.style.display = "block";
    adminPanel.style.display = "none";
  }
});
