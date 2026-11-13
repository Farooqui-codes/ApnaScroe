# ApnaScore – Complete Scenario Testing & Verification Report (§19)

**Date**: 13 November 2026  
**Auditor**: Antigravity AI Engine  
**Platform**: ApnaScore (Apne Gaon ka Apna Scorer)  
**Target Repository**: `https://github.com/Farooqui-codes/ApnaScroe.git`  
**Overall Status**: **PASSED (100% Green Suite – 62 Tests Total: 40 Unit/Rule/Security + 22 Headless Browser CDP)**

---

## 1. Executive Summary & Root Cause Fixes

During the deep scenario audit across cricket scoring rules, village formats, app flows, stress, and security, **three high-priority logic bugs** were identified and permanently resolved at the engine root level:

1. **Wicket on the Last Ball of an Over (Law 18 / Over-end Strike Rotation)**:
   - *Bug*: When a striker was bowled/caught on ball 6 of an over, the engine swapped `dismissedSlot` to `'non_striker'`, but failed to move the surviving non-striker into `state.strikerId`. When the new incoming batsman was added in the next over, the surviving batter was replaced at non-striker and the striker remained `null`.
   - *Root Cause Fix*: In `js/scoring-engine.js` (and `backend/services/scoringEngine.js`), on over-end strike rotation when a wicket has fallen, the surviving batter is now deterministically rotated to face the next over (`state.strikerId = state.nonStrikerId; state.nonStrikerId = null; state.dismissedSlot = 'non_striker'`), placing the incoming batsman at the non-striker end.
2. **Injured / Mid-Over Bowler Split Over Maiden Attribution**:
   - *Bug*: When Bowler A bowled 3 balls and got injured, and Bowler B completed the remaining 3 balls with 0 runs conceded, Bowler B was incorrectly awarded a full maiden over (`bowler.maidens += 1`) because `state.currentOverLegalBalls >= 6`.
   - *Root Cause Fix*: Added `state.currentBowlerLegalBallsInOver` tracking that resets upon `change_bowler`. A maiden over is now strictly awarded only if the same bowler bowled all 6 balls of the over alone (`state.currentBowlerLegalBallsInOver >= bpo`).
3. **Small-Team (Village Cricket) Chase Margin Calculation**:
   - *Bug*: In small-sided matches (e.g. 6-a-side where total wickets is 5), winning a chase with 2 wickets down was reporting "won by 8 wickets" because the default max wickets was hardcoded to 10.
   - *Root Cause Fix*: Updated `evaluateMatchResult()` to dynamically calculate `maxWickets = rules.format.maxWickets || (rules.format.playersPerTeam - 1) || 10`. A 6-a-side team winning with 2 down now accurately displays *"Team won by 3 wickets"*.
4. **Engine-Level Bowler Quota & Consecutive Over Enforcement**:
   - *Bug*: Previously, `maxOversPerBowler` and `noConsecutiveOversBySameBowler` were checked primarily in UI modals. Direct API submissions or event streams could bypass them.
   - *Root Cause Fix*: Integrated strict validation into `validateDeliveryInput()`, rejecting balls bowled by a bowler who exceeded their quota or bowled two consecutive overs.
5. **Innings Revert on Undo**:
   - *Enhancement*: Added support in `undoLastBall()`: if `activeInnings.inningsNumber > 1` and no balls have been bowled yet in the 2nd innings, tapping Undo prompts the user and cleanly rolls back to the 1st innings.
6. **Squad Name Deduplication & Team Name Length Constraints**:
   - *Enhancement*: Added automatic deduplication in `parsePlayerNames()` preventing identical player names within the same squad, and enforced a maximum length of 50 characters on team names across frontend wizard and backend API.

---

## 2. Complete Test Matrix

| # | Scenario | Steps / Action | Expected Result | Actual Result | Status | Fix Applied |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **1** | Normal Scoring (0..6) | Score 0, 1, 2, 3, 4, 6 | Odd runs rotate strike; even runs keep strike; over ends at 6 | Score: 16 runs in 1.0 ov; striker rotated | **PASS** | Verified strike rotation |
| **2** | 6 Legal Balls per Over | Bowl Wide, No-ball, 6 legal balls | Wides/NBs do not advance over; 6 legal balls complete over | Legal balls: 6, Overs: 1.0, 7 total runs | **PASS** | Re-bowl rules verified |
| **3** | Wide + Additional Runs | Record Wide + 0, Wide + 2 runs | 4 extras to team & bowler; 0 balls to batsman; odd running runs rotate strike | 4 wides, 0 balls faced by batter, bowler charged 4 | **PASS** | Extras attribution verified |
| **4** | No-Ball & Free Hit | Record NB + 4; attempt Bowled on next ball | 5 runs, Free Hit active; bowled/caught/LBW/stumped blocked; run-out allowed | Bowled rejected with "Free Hit" error; run out allowed | **PASS** | Free Hit gate verified |
| **5** | Byes & Leg Byes | Record 2 Byes, 1 Leg-Bye | Credited to team extras; 0 runs to batsman; 0 runs conceded by bowler | Extras: 3, Bowler runs: 0, Strike rotated on 1 LB | **PASS** | Bowler economy protected |
| **6** | Overthrows & Penalties | 1 bat run + 4 overthrows; 5 penalty runs | 5 runs to batsman/team; 5 penalty runs to team & bowler | Score: 10, Batsman: 5 runs, Penalties: 5 | **PASS** | Overthrow rules verified |
| **7** | All 10 Wicket Types | Test Bowled, Caught, LBW, Stumped, Hit Wkt, Run Out, Ret Out, Ret Hurt, Obstructing, Timed Out | Bowler credited for Bowled/Caught/LBW/Stumped/Hit Wicket only; Run Out & others not credited | Bowler wickets: 1 for bowling dismissals; 0 for others | **PASS** | Standard Law 18/21 verified |
| **8** | Wicket on Ball 6 of Over | Striker bowled on 6th ball; over completes | Over ends; surviving batter moves to striker for new over; new bat takes non-striker | Surviving batter on strike for Over 2; new bat at non-striker | **PASS** | Fixed over-end strike swap |
| **9** | Wicket on Wide vs No-Ball | Test Stumped on Wide; Bowled on Wide; Run Out on NB; Bowled on NB | Wide allows stumped & run-out; NB allows run-out only | Stumped on Wide: Valid; Bowled on NB: Rejected | **PASS** | Extra dismissal matrix verified |
| **10** | 6-a-side Village Match | 6 players per team; 5 wickets fall | Innings completed on 5th wicket (all out); chase result: "won by 3 wickets" | All out on 5th wicket; "won by 3 wickets" verified | **PASS** | Fixed small-team maxWickets |
| **11** | Bowler Consecutive & Max Overs | Bowler finishes Over 1 (max quota 1); attempts Over 2 | Blocked with "maximum allowed 1 over" or "consecutive over" error | Delivery rejected with clear error message | **PASS** | Added quota check to engine |
| **12** | Injured Bowler Mid-Over | Bowler 1 bowls 3 balls; Bowler 2 bowls 3 balls (0 runs conceded) | Over 1.0 complete; both bowlers have 0.3 ov; neither awarded false maiden | Overs: 0.3 & 0.3; maidens: 0 & 0 | **PASS** | Fixed maiden tracking logic |
| **13** | Retired Hurt Return | Batter retires hurt; later returns on wicket | Retired hurt marked not out; returns to crease with original runs intact | Runs: 16 (10+6), not out, active at crease | **PASS** | Verified re-entry workflow |
| **14** | Multi-Undo Replay | Score NB+2, legal 1, wicket; undo wicket; undo legal 1 | Exact state rolled back; Free Hit restored after undoing post-NB ball | Free Hit: true, Legal balls: 0, Score: 3 | **PASS** | Deterministic event replay |
| **15** | Match Chase Results | Chase > Target, < Target, Equal, Abandoned | "Won by X wickets", "Won by Y runs", "Match Tied", "Match Abandoned" | All 4 result outcomes and margin texts exact | **PASS** | Result evaluator verified |
| **16** | Hand-Calculated Stats Check | SR (45 off 30b), Econ (24 in 22b), RR (75 in 51b), NRR (150/20 vs 120/20) | SR: 150.0, Econ: 6.55, RR: 8.82, NRR: +1.500 | SR: 150.0, Econ: 6.55, RR: 8.82, NRR: 1.500 | **PASS** | Mathematical match verified |
| **17** | Rule Input Validation | Pass overs = 0, overs = 500, ballsPerOver = 15 | Rejected with clean validation errors (overs 1..100, bpo 1..12) | `valid: false` with specific field errors | **PASS** | Input boundaries verified |
| **18** | Rapid Scoring Stress (100b) | Score 100 deliveries continuously | Deterministic replay, zero state drift or memory corruption | Legal balls: 100, Overs: 16.4, 0 errors | **PASS** | Engine throughput verified |
| **19** | Idempotent Sync / Action IDs | Duplicate event IDs sent in sync stream | Duplicate event ignored; ball not scored twice | Legal balls: 2, duplicates safely discarded | **PASS** | Sync idempotency verified |
| **20** | XSS Injection Defense | Submit `<script>alert("hacked")</script>` in names & notes | Stored safely, escaped via `ApnaUI.escapeHtml()`, zero script execution | Rendered cleanly as escaped text | **PASS** | XSS sanitization verified |
| **21** | 100dvh Scoring Screen (CDP) | Open `live-score.html` on 360px viewport | Entire scoring pad fits in 100dvh without page scroll | `bodyOverflow: hidden`, all controls visible | **PASS** | Mobile scoring verified |
| **22** | Toggle Chips + Run Pad (CDP) | Tap Wide chip $\rightarrow$ tap 1 | Records Wide + 1 run (2 runs total) and resets active chip | Score: 2-0, chipActive: false | **PASS** | Toggle chip interaction verified |
| **23** | Striker Swap Button (CDP) | Tap `⇄ Swap` button | Instantly swaps striker and non-striker | Raju & Vikram swapped immediately | **PASS** | Real-time crease swap verified |
| **24** | Undo Delivery in Browser (CDP)| Tap `↶ Undo` button | Rolls back last delivery and refreshes crease & scoreboard | Score restored to previous state | **PASS** | Browser undo verified |
| **25** | Smart Autocomplete (CDP) | Focus empty input; type "As"; type "Irfan" | Squad chips on empty; `<mark>` highlights; `+ Add player` option | Instant chips; `<mark>As</mark>if`; Add button | **PASS** | Autocomplete verified |
| **26** | Bottom Navigation Bar (CDP) | Inspect 5 tabs on 360px screen | Home, Matches, "+", Tournaments, Profile ($\ge$ 48px touch targets) | 5 tabs, minHeight: 52.3px | **PASS** | Ergonomics verified |
| **27** | Topbar Branding & Pills (CDP)| Inspect mobile topbar on dashboard | Brand green (`#208B4E`), desktop install & wifi pills hidden | Green topbar, clean mobile header | **PASS** | Mobile header verified |
| **28** | Tournament Points Table | 4 teams played; NRR calculated with all-out rule | Sorts by points, then wins/NRR; top teams marked qualified | Correct table ordering and NRR calculation | **PASS** | Tournament engine verified |
| **29** | PDF Scorecard Generation | Export complete & in-progress match | Genuine multi-page PDFKit buffer generated with batting/bowling | Valid PDF buffer with all tables | **PASS** | PDF generation verified |
| **30** | Guest Session Isolation | Guest B attempts to score Guest A match | HTTP 403 Forbidden | 403 Forbidden returned | **PASS** | RBAC security verified |

---

## 3. How to Run the Tests

You can re-run all 40 automated unit, rule, and scenario tests at any time before deploying:

```bash
npm test
```

To run all HTTP, RBAC, and security integration tests:

```bash
npm run test:all
```

To run the automated Chrome DevTools Protocol (CDP) headless browser mobile audit:

```bash
node scripts/verify_mobile_scoring.js
```

---

## 4. Manual Phone Testing Checklist (5-Minute Quick Test)

Follow this checklist on your own smartphone browser (Chrome / Safari):

1. **Mobile Shell & Navigation**:
   - Open `https://apnascore.onrender.com` (or localhost).
   - Verify the top app bar is brand green (`#208B4E`).
   - Tap the bottom navigation tabs (`Home`, `Matches`, `+`, `Tournaments`, `Profile`). Notice the subtle haptic vibration on each tap.
   - Open the hamburger menu: verify the drawer starts with the Online Status row, followed by Home, Pro, Pricing, Settings, Profile, Install App, and Feedback.
2. **Simple Match Creation**:
   - Tap the center `+` button in the bottom bar.
   - Enter Team A: "Rampur", Team B: "Nagpur", Overs: 6.
   - Tap "Start Scoring". Verify it opens the mobile scoring screen instantly.
3. **100dvh Scoring Screen & Crease**:
   - Confirm the scoring screen fits your entire phone screen without having to scroll up or down.
   - Notice the striker row has a `*` star and a soft green highlight.
4. **Scoring with Toggle Chips**:
   - Tap the `Wide` chip (it turns active green).
   - Tap `1` on the run pad: verify the score becomes `2-0` (1 wide + 1 run), extras become `2`, and the Wide chip turns off automatically.
   - Tap `4`: verify the score becomes `6-0` with a four celebration banner and vibration.
   - Tap `⇄ Swap`: verify the striker and non-striker immediately swap places.
   - Tap `↶ Undo`: verify the last delivery is rolled back cleanly.
5. **Smart Player Autocomplete**:
   - Tap on the bowler strip or tap `Wicket` $\rightarrow$ select dismissal $\rightarrow$ when the batsman selection modal opens:
   - Tap inside the empty name input: observe the squad player chips appear instantly for one-tap selection!
   - Type "Ra": observe matching letters highlighted with `<mark>`.
   - Type an unlisted name like "Sameer": observe `+ Add "Sameer" as new player` appears.
6. **Screen Wake Lock**:
   - Leave the phone on the table for 2 minutes while on the scoring screen: the screen stays ON and does not sleep.

---

## 5. Honest Testing Limitations (Device Specifics)

- **Automated Tests**: Completed using Node.js 20+ test runner and Headless Chromium via Chrome DevTools Protocol (CDP) simulating mobile viewports (320px, 360px, 390px, 412px).
- **Items Requiring Physical Device Verification**:
  1. **iOS Safari WebKit Bottom Toolbar**: While `100dvh` and `-webkit-fill-available` are in place, Safari's dynamic URL bar collapsing when scrolling outside standalone PWA mode should be observed on a physical iPhone.
  2. **Physical Vibration Motors**: `navigator.vibrate` is executed in code, but physical haptic intensity varies between Android Taptic engines and iOS Safari (which restricts Web Vibration API in Safari).
  3. **Installed PWA Splash Screen on iOS**: Adding to Home Screen via Safari Share sheet ("Add to Home Screen") should be tested manually once on an iOS device to observe the Apple touch icon and splash screen background.
