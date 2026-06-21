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
   `REPLACE_WITH_YOUR_ADMIN_UID` (it appears twice — once for `matches`,
   once for `knockoutMatches`), then go to Firestore → Rules, paste the
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

## Knockout bracket

`/bracket.html` is a real tournament bracket — columns for Round of 32
through the Final, plus a separate Third Place Match box — not a fixture
list:

- **Resolved slots** show the actual team name. **Undetermined slots**
  show a compact code instead of a sentence: `A1` (Group A winner), `B2`
  (Group B runner-up), `3rd` (an unresolved best-third slot), `W73` /
  `L101` (winner/loser of a specific match) — never "Winner Group A" or
  "TBD" on the card itself.
- **No venue/date/time on the cards.** Click any matchup to open an
  in-page modal with the match number, both teams, date, time, venue, and
  status — without leaving the page.
- **Round of 32** resolves from group standings exactly as before, using
  FIFA's Annex C table for the third-place slots.
- **Round of 16 onward only resolves once real results are entered in
  Admin.** There's no what-if mechanism for the knockout rounds (only for
  group-stage scores) — a match needs an actual winner before anything
  downstream of it can fill in. Toggling what-if mode still affects how
  the Round of 32 column fills in, carried over from the tracker.
- Layout uses a flexbox trick to auto-center each round's matchups between
  their two feeder matches — no manual pixel math, and it stays correct
  no matter how the matches resolve. Scrolls horizontally on both desktop
  and mobile.

The tracker page also keeps a condensed **"Potential Round of 32"**
preview under Best Third-Place Teams when what-if mode is on, sharing the
exact same resolution logic as the full bracket page.

## Entering knockout results (Admin)

`/admin.html` now has a **Knockout results** panel below the group score
list. Every one of the 32 knockout matches is listed; only the ones where
both teams are already determined are editable. Enter the score, and if
it was drawn after extra time, tick **Pens** and enter the shootout score
— a knockout match can't be saved without a winner. Saving immediately
recomputes the bracket, so newly-determined later-round matchups appear
right away.

## Files

- `index.html` / `js/app.js` — the public tracker
- `bracket.html` / `js/bracket.js` — the knockout bracket (Round of 32 → Final + 3rd place)
- `js/bracket-data.js` — all 32 knockout match slots + FIFA's Annex C table
- `js/bracket-resolve.js` — shared resolution engine (used by the bracket page, the admin knockout panel, and the tracker's inline preview)
- `admin.html` / `js/admin.js` — group score entry + knockout result entry (auth-gated)
- `js/standings-engine.js` — pure tiebreaker/qualification logic (no
  Firebase dependency — see `test.mjs` for a standalone sanity check)
- `js/schedule-data.js` — the master 72-match schedule, used only by the
  one-time import button
- `firestore.rules` — paste into Firebase Console → Firestore → Rules
