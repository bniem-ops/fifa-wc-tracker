# World Cup 26 Group Stage Tracker

A static site (GitHub Pages) + Firebase Firestore tracker for the FIFA World
Cup 2026 group stage. Real results are admin-entered and live for everyone;
anyone can also flip on "what-if mode" to test hypothetical scores for
unplayed matches and share the exact scenario via a link, without touching
the real data.

## 1. Firebase setup (one time)

1. **Get your web config.** Firebase Console → Project settings → General →
   "Your apps" → add/open your Web app → copy the config object into
   `js/firebase-config.js`, replacing the placeholder values.

2. **Enable Firestore** (if not already): Firebase Console → Build →
   Firestore Database → Create database (production mode is fine, the rules
   below lock it down).

3. **Enable Email/Password sign-in:** Authentication → Sign-in method →
   enable "Email/Password".

4. **Create your one admin account:** Authentication → Users → Add user →
   enter the email/password you'll use to log into `/admin.html`.

5. **Lock down writes to just you:** copy that user's UID (shown in the
   Users table), paste it into `firestore.rules` in place of
   `REPLACE_WITH_YOUR_ADMIN_UID`, then go to Firestore → Rules, paste the
   full contents of `firestore.rules`, and click **Publish**.

## 2. Deploy to GitHub Pages

1. Copy everything in this folder into your repo (root, or a subfolder —
   just make sure the relative paths in the HTML files still resolve).
2. Commit and push.
3. Repo → Settings → Pages → Deploy from branch → pick your branch and the
   folder these files live in.
4. Visit `https://<your-username>.github.io/<repo-name>/`.

## 3. First run

1. Go to `/admin.html` and sign in with the admin account from step 1.4.
2. Click **Import schedule** once — this loads all 72 group-stage matches
   (with the results you already gave me baked in) into Firestore.
3. Go back to the main page — it should now show live standings.

## 4. Day to day

- **Entering a real result:** `/admin.html` → find the match → type the
  score → **Save**. It updates instantly for everyone viewing the tracker
  (no refresh needed).
- **What-if mode:** toggle it on the main page, type scores into any
  upcoming match, and the standings/status badges recompute live in your
  browser only. **Share scenario** copies a link that encodes exactly what
  you typed, so whoever opens it sees the same hypothetical — they can keep
  editing from there as their own fork. None of this touches real data.

## Status badges

- **Q** — qualified (clinched a top-2 spot, or confirmed as a top-8
  third-place team once all 12 groups are done)
- **E** — eliminated
- **—** — still alive
- **?** — genuinely unresolved tie. The app implements the 2026
  tiebreaker order through goal difference and goals scored; the final
  step (fair-play cards / FIFA ranking) isn't tracked here, so ties that
  survive everything else are flagged rather than guessed at.

Third-place teams show as "alive" with a provisional cross-group rank
until **all 12 groups** have finished their third match — that's when the
real best-8 cutoff is actually determined.

## Round of 32 bracket

`/bracket.html` shows all 16 fixed Round of 32 fixtures (Matches 73–88),
auto-filled from live standings:

- **Group winner/runner-up slots** fill in as soon as that group has played
  all 3 matches (and isn't itself stuck on an unresolved tie).
- **Third-place slots** ("Best 3rd Group X/Y/Z...") only fill in once **all
  12 groups** are complete, using FIFA's actual **Annex C** allocation
  table — the official pre-published lookup covering all 495 possible
  combinations of which 8 groups' third-place teams qualify, so the slot a
  given third-place team lands in is exactly what FIFA would assign, not an
  approximation.
- Toggling **what-if mode** on the main tracker and clicking through to
  Bracket carries the scenario over, so you can preview how a hypothetical
  result would reshape the bracket.

## Files

- `index.html` / `js/app.js` — the public tracker
- `bracket.html` / `js/bracket.js` — the Round of 32 bracket
- `js/bracket-data.js` — the 16 fixed fixture slots + FIFA's Annex C table
- `admin.html` / `js/admin.js` — score entry (auth-gated)
- `js/standings-engine.js` — pure tiebreaker/qualification logic (no
  Firebase dependency — see `test.mjs` for a standalone sanity check)
- `js/schedule-data.js` — the master 72-match schedule, used only by the
  one-time import button
- `firestore.rules` — paste into Firebase Console → Firestore → Rules
