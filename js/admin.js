import {
  db, matchesCollection, doc, getDocs, setDoc, updateDoc,
  auth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "./firebase-init.js";
import { SCHEDULE, FLAGS } from "./schedule-data.js";

const flag = (team) => FLAGS[team] || "🏳️";

const loginCard = document.getElementById("login-card");
const adminPanel = document.getElementById("admin-panel");
const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-msg");
const logoutBtn = document.getElementById("logout-btn");
const seedBtn = document.getElementById("seed-btn");
const seedMsg = document.getElementById("seed-msg");
const matchList = document.getElementById("match-list");

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
      } catch (err) {
        msgEl.textContent = "Failed: " + err.message;
        msgEl.style.color = "var(--accent-red)";
      }
      setTimeout(() => (msgEl.textContent = ""), 2000);
    });
  });
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginCard.style.display = "none";
    adminPanel.style.display = "block";
    document.getElementById("user-email").textContent = user.email;
    loadMatchList();
  } else {
    loginCard.style.display = "block";
    adminPanel.style.display = "none";
  }
});
