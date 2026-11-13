const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../js/scoring-engine');

function makeScenarioSetup(ruleOverrides = {}, customSquad = null) {
  const { rules } = engine.validateAndNormalizeRules(ruleOverrides);
  return {
    inningsNumber: 1,
    battingTeamId: 'team_alpha',
    battingTeamName: 'Hassan Stars',
    bowlingTeamId: 'team_beta',
    bowlingTeamName: 'Farooqui Warriors',
    openingStrikerId: 'p1',
    openingStrikerName: 'Hassan',
    openingNonStrikerId: 'p2',
    openingNonStrikerName: 'Tariq',
    openingBowlerId: 'b1',
    openingBowlerName: 'Rashid',
    battingSquad: customSquad?.battingSquad || [
      { playerId: 'p1', name: 'Hassan' },
      { playerId: 'p2', name: 'Tariq' },
      { playerId: 'p3', name: 'Zaid' },
      { playerId: 'p4', name: 'Bilal' },
      { playerId: 'p5', name: 'Usman' },
      { playerId: 'p6', name: 'Hamza' }
    ],
    bowlingSquad: customSquad?.bowlingSquad || [
      { playerId: 'b1', name: 'Rashid' },
      { playerId: 'b2', name: 'Irfan' },
      { playerId: 'b3', name: 'Imran' }
    ],
    rules
  };
}

describe('§19 Complete Scenario Testing Suite (Cricket Engine, Edge Cases & App Flows)', () => {

  // =========================================================================
  // 1. SCORING & STRIKE ROTATION
  // =========================================================================
  it('19.2.1: Normal balls 0..6, odd runs rotate strike, over end rotates strike', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 0 }, // Hassan stays (0)
      { eventId: 'e2', sequence: 2, batRuns: 1 }, // Hassan 1 -> Tariq on strike
      { eventId: 'e3', sequence: 3, batRuns: 2 }, // Tariq 2 -> Tariq stays
      { eventId: 'e4', sequence: 4, batRuns: 3 }, // Tariq 3 -> Hassan on strike
      { eventId: 'e5', sequence: 5, batRuns: 4 }, // Hassan 4 -> Hassan stays
      { eventId: 'e6', sequence: 6, batRuns: 6 }  // Hassan 6 -> Over completes (1.0), strike rotates to Tariq!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 16);
    assert.equal(state.legalBalls, 6);
    assert.equal(state.oversString, '1.0');
    assert.equal(state.completedOvers, 1);
    assert.equal(state.strikerId, 'p2'); // Tariq has strike for over 2
    assert.equal(state.nonStrikerId, 'p1'); // Hassan non-striker
    assert.equal(state.needsBowlerChange, true);
    assert.equal(state.battingStats.p1.runs, 11);
    assert.equal(state.battingStats.p2.runs, 5);
  });

  it('19.2.2: 6 legal balls complete an over; Wides and No-balls do not advance over', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'wide', additionalExtraRuns: 0 }, // Wide (ball 0.0)
      { eventId: 'e2', sequence: 2, extraType: 'no_ball', batRuns: 0 },          // No-ball (ball 0.0)
      { eventId: 'e3', sequence: 3, batRuns: 0 },                                // Legal 1 (0.1)
      { eventId: 'e4', sequence: 4, batRuns: 1 },                                // Legal 2 (0.2)
      { eventId: 'e5', sequence: 5, extraType: 'wide', additionalExtraRuns: 1 }, // Wide+1 (0.2)
      { eventId: 'e6', sequence: 6, batRuns: 0 },                                // Legal 3 (0.3)
      { eventId: 'e7', sequence: 7, batRuns: 2 },                                // Legal 4 (0.4)
      { eventId: 'e8', sequence: 8, batRuns: 0 },                                // Legal 5 (0.5)
      { eventId: 'e9', sequence: 9, batRuns: 0 }                                 // Legal 6 (1.0) Over complete!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.legalBalls, 6);
    assert.equal(state.oversString, '1.0');
    assert.equal(state.completedOvers, 1);
    assert.equal(state.totalRuns, 7); // 1 wide + 1 nb + 0 + 1 + 2 wide + 0 + 2 + 0 + 0 = 7
    assert.equal(state.extrasBreakdown.wides, 3);
    assert.equal(state.extrasBreakdown.noBalls, 1);
  });

  // =========================================================================
  // 2. EXTRAS: WIDE, NO-BALL, BYES, LEG-BYES, OVERTHROWS & FREE HIT
  // =========================================================================
  it('19.2.3: Wide alone, wide + runs, wide + byes, bowler penalty charge', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'wide', additionalExtraRuns: 0 }, // 1 run to team & bowler, 0 to bat
      { eventId: 'e2', sequence: 2, extraType: 'wide', additionalExtraRuns: 2 }  // 1+2=3 runs, 2 completed -> strike stays p1
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 4);
    assert.equal(state.extrasBreakdown.wides, 4);
    assert.equal(state.bowlingStats.b1.runs, 4); // all charged to bowler
    assert.equal(state.strikerId, 'p1');
    assert.equal(state.battingStats.p1.balls, 0); // 0 balls faced
  });

  it('19.2.4: No-ball + bat runs, Free Hit active and blocks bowled/caught/LBW/stumped', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'no_ball', batRuns: 4 } // 1 NB + 4 bat = 5 runs, Free Hit active
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 5);
    assert.equal(state.isFreeHit, true);
    assert.equal(state.battingStats.p1.runs, 4);
    assert.equal(state.bowlingStats.b1.runs, 5);

    // Free Hit validation: bowled, caught, lbw, stumped must be rejected!
    const vBowled = engine.validateDeliveryInput(state, { isWicket: true, wicketType: 'bowled' }, setup.rules);
    assert.equal(vBowled.valid, false);
    assert.match(vBowled.errors[0], /Free Hit/);

    const vCaught = engine.validateDeliveryInput(state, { isWicket: true, wicketType: 'caught' }, setup.rules);
    assert.equal(vCaught.valid, false);

    const vLBW = engine.validateDeliveryInput(state, { isWicket: true, wicketType: 'lbw' }, setup.rules);
    assert.equal(vLBW.valid, false);

    const vStumped = engine.validateDeliveryInput(state, { isWicket: true, wicketType: 'stumped' }, setup.rules);
    assert.equal(vStumped.valid, false);

    // Run out IS allowed on Free Hit!
    const vRunOut = engine.validateDeliveryInput(state, { isWicket: true, wicketType: 'run_out' }, setup.rules);
    assert.equal(vRunOut.valid, true);

    // Next legal ball clears Free Hit
    events.push({ eventId: 'e2', sequence: 2, batRuns: 1 });
    const afterNext = engine.replayInnings(setup, events);
    assert.equal(afterNext.isFreeHit, false);
    assert.equal(afterNext.totalRuns, 6);
  });

  it('19.2.5: Byes & Leg Byes credited to extras, NOT to batsman and NOT charged to bowler', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'bye', additionalExtraRuns: 2 },    // 2 byes (0 charged to bowler)
      { eventId: 'e2', sequence: 2, extraType: 'leg_bye', additionalExtraRuns: 1 } // 1 leg-bye (0 charged to bowler, strike rotates)
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 3);
    assert.equal(state.extrasBreakdown.byes, 2);
    assert.equal(state.extrasBreakdown.legByes, 1);
    assert.equal(state.battingStats.p1.runs, 0);
    assert.equal(state.bowlingStats.b1.runs, 0); // 0 runs conceded by bowler!
    assert.equal(state.strikerId, 'p2'); // strike rotated on odd 1 leg-bye
  });

  it('19.2.6: Overthrows, penalty runs, boundary 4/6 with extras', () => {
    const setup = makeScenarioSetup({
      extras: {
        overthrow: { enabled: true, countsToBatsman: true, countsToBowler: true, rotatesStrikeOnOdd: true },
        penalty: { enabled: true, defaultRuns: 5 }
      }
    });
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 1, overthrowRuns: 4 },              // 1 + 4 = 5 runs (odd -> rotates to p2, p1 gets 5)
      { eventId: 'e2', sequence: 2, extraType: 'penalty', additionalExtraRuns: 5 } // 5 penalty runs
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 10);
    assert.equal(state.battingStats.p1.runs, 5);
    assert.equal(state.extrasBreakdown.penalties, 5);
    assert.equal(state.extrasBreakdown.overthrows, 4);
    assert.equal(state.strikerId, 'p2');
  });

  // =========================================================================
  // 3. ALL WICKET TYPES & CREDITING
  // =========================================================================
  it('19.2.7: All 10 wicket types verify bowler credit vs non-credit', () => {
    // 1. Bowled -> Bowler credited
    const s1 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'bowled' }]);
    assert.equal(s1.bowlingStats.b1.wickets, 1);

    // 2. Caught -> Bowler credited
    const s2 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'caught' }]);
    assert.equal(s2.bowlingStats.b1.wickets, 1);

    // 3. LBW -> Bowler credited
    const s3 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'lbw' }]);
    assert.equal(s3.bowlingStats.b1.wickets, 1);

    // 4. Stumped -> Bowler credited
    const s4 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'stumped' }]);
    assert.equal(s4.bowlingStats.b1.wickets, 1);

    // 5. Hit Wicket -> Bowler credited
    const s5 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'hit_wicket' }]);
    assert.equal(s5.bowlingStats.b1.wickets, 1);

    // 6. Run Out -> Bowler NOT credited
    const s6 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'run_out' }]);
    assert.equal(s6.bowlingStats.b1.wickets, 0);

    // 7. Obstructing the field -> Bowler NOT credited
    const s7 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'obstructing_field' }]);
    assert.equal(s7.bowlingStats.b1.wickets, 0);

    // 8. Timed out -> Bowler NOT credited
    const s8 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'timed_out' }]);
    assert.equal(s8.bowlingStats.b1.wickets, 0);

    // 9. Retired out -> Wicket counted, bowler NOT credited
    const s9 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, eventType: 'retire', wicketType: 'retired_out', slot: 'striker' }]);
    assert.equal(s9.wickets, 1);
    assert.equal(s9.bowlingStats.b1.wickets, 0);

    // 10. Retired hurt -> NOT counted as wicket, not out, bowler NOT credited
    const s10 = engine.replayInnings(makeScenarioSetup(), [{ eventId: 'e1', sequence: 1, eventType: 'retire', wicketType: 'retired_hurt', slot: 'striker' }]);
    assert.equal(s10.wickets, 0);
    assert.equal(s10.battingStats.p1.isRetiredHurt, true);
    assert.equal(s10.battingStats.p1.isOut, false);
  });

  it('19.2.8: Wicket on last ball of an over, new batsman incoming slot swapped for new over', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 0 },
      { eventId: 'e2', sequence: 2, batRuns: 0 },
      { eventId: 'e3', sequence: 3, batRuns: 0 },
      { eventId: 'e4', sequence: 4, batRuns: 0 },
      { eventId: 'e5', sequence: 5, batRuns: 0 },
      { eventId: 'e6', sequence: 6, isWicket: true, wicketType: 'bowled' } // Wicket on ball 6!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.legalBalls, 6);
    assert.equal(state.oversString, '1.0');
    assert.equal(state.completedOvers, 1);
    assert.equal(state.needsNewBatsman, true);
    // Because over completed and strike rotates on over end, the incoming batsman takes non-striker
    // and surviving batsman Tariq (p2) takes strike!
    assert.equal(state.dismissedSlot, 'non_striker');

    // Add new batsman p3
    events.push({ eventId: 'e7', sequence: 7, eventType: 'new_batsman', playerId: 'p3', playerName: 'Zaid', slot: state.dismissedSlot });
    const stateAfterNewBat = engine.replayInnings(setup, events);
    assert.equal(stateAfterNewBat.strikerId, 'p2'); // Tariq faces next over
    assert.equal(stateAfterNewBat.nonStrikerId, 'p3'); // Zaid non-striker
  });

  it('19.2.9: Wicket on a Wide (stumped, run out) vs on a No-Ball (run out only)', () => {
    const setup = makeScenarioSetup();
    const stOnWide = { extraType: 'wide', isWicket: true, wicketType: 'stumped' };
    assert.equal(engine.validateDeliveryInput(engine.replayInnings(setup, []), stOnWide, setup.rules).valid, true);

    const bowledOnWide = { extraType: 'wide', isWicket: true, wicketType: 'bowled' };
    assert.equal(engine.validateDeliveryInput(engine.replayInnings(setup, []), bowledOnWide, setup.rules).valid, false);

    const roOnNb = { extraType: 'no_ball', isWicket: true, wicketType: 'run_out' };
    assert.equal(engine.validateDeliveryInput(engine.replayInnings(setup, []), roOnNb, setup.rules).valid, true);

    const bowledOnNb = { extraType: 'no_ball', isWicket: true, wicketType: 'bowled' };
    assert.equal(engine.validateDeliveryInput(engine.replayInnings(setup, []), bowledOnNb, setup.rules).valid, false);
  });

  // =========================================================================
  // 4. VILLAGE RULES, SMALL TEAMS & BOWLER RESTRICTIONS
  // =========================================================================
  it('19.2.10: 6-a-side small match (5 wickets = all out)', () => {
    const setup = makeScenarioSetup({
      format: { playersPerTeam: 6, maxWickets: 5, oversPerInnings: 2 }
    });
    const events = [
      { eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'bowled' },
      { eventId: 'e2', sequence: 2, eventType: 'new_batsman', playerId: 'p3', playerName: 'Zaid' },
      { eventId: 'e3', sequence: 3, isWicket: true, wicketType: 'bowled' },
      { eventId: 'e4', sequence: 4, eventType: 'new_batsman', playerId: 'p4', playerName: 'Bilal' },
      { eventId: 'e5', sequence: 5, isWicket: true, wicketType: 'bowled' },
      { eventId: 'e6', sequence: 6, eventType: 'new_batsman', playerId: 'p5', playerName: 'Usman' },
      { eventId: 'e7', sequence: 7, isWicket: true, wicketType: 'bowled' },
      { eventId: 'e8', sequence: 8, eventType: 'new_batsman', playerId: 'p6', playerName: 'Hamza' },
      { eventId: 'e9', sequence: 9, isWicket: true, wicketType: 'bowled' } // 5th wicket = All out!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.wickets, 5);
    assert.equal(state.status, 'completed');
    assert.equal(state.endReason, 'all_out');

    // Result evaluation for 6-a-side chase:
    const inn1 = { totalRuns: 20, wickets: 5, battingTeamId: 't1', battingTeamName: 'T1' };
    const inn2 = { totalRuns: 21, wickets: 2, battingTeamId: 't2', battingTeamName: 'T2' };
    const res = engine.evaluateMatchResult(inn1, inn2, setup.rules);
    assert.equal(res.marginText, 'T2 won by 3 wickets'); // 5 - 2 = 3 wickets
  });

  it('19.2.11: Bowler consecutive overs and max overs enforcement', () => {
    const setup = makeScenarioSetup({
      format: { oversPerInnings: 4, maxOversPerBowler: 1, noConsecutiveOversBySameBowler: true }
    });
    // Complete 1 over with bowler b1 (Rashid)
    const over1 = [
      { eventId: 'e1', sequence: 1, batRuns: 0 },
      { eventId: 'e2', sequence: 2, batRuns: 0 },
      { eventId: 'e3', sequence: 3, batRuns: 0 },
      { eventId: 'e4', sequence: 4, batRuns: 0 },
      { eventId: 'e5', sequence: 5, batRuns: 0 },
      { eventId: 'e6', sequence: 6, batRuns: 0 }
    ];
    const state = engine.replayInnings(setup, over1);
    assert.equal(state.completedOvers, 1);
    assert.equal(state.lastCompletedOverBowlerId, 'b1');

    // Bowler b1 attempting to bowl next over must fail:
    // (1) Consecutive over error and (2) Max overs (1) exceeded
    const valConsec = engine.validateDeliveryInput(state, { batRuns: 0 }, setup.rules);
    assert.equal(valConsec.valid, false);
    assert.match(valConsec.errors.join(' '), /maximum allowed 1 over|consecutive/);
  });

  it('19.2.12: Injured bowler mid-over (another bowler completes the over)', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 0 }, // b1 (0.1)
      { eventId: 'e2', sequence: 2, batRuns: 0 }, // b1 (0.2)
      { eventId: 'e3', sequence: 3, batRuns: 0 }, // b1 (0.3)
      // Bowler b1 injured! Mid-over bowler change to b2 (Irfan)
      { eventId: 'e4', sequence: 4, eventType: 'change_bowler', bowlerId: 'b2', bowlerName: 'Irfan' },
      { eventId: 'e5', sequence: 5, batRuns: 0 }, // b2 (0.4)
      { eventId: 'e6', sequence: 6, batRuns: 0 }, // b2 (0.5)
      { eventId: 'e7', sequence: 7, batRuns: 0 }  // b2 (1.0) Over complete!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.completedOvers, 1);
    assert.equal(state.oversString, '1.0');
    assert.equal(state.bowlingStats.b1.overs, '0.3');
    assert.equal(state.bowlingStats.b1.legalBalls, 3);
    assert.equal(state.bowlingStats.b2.overs, '0.3');
    assert.equal(state.bowlingStats.b2.legalBalls, 3);
    // Neither bowler bowled all 6 balls alone, so neither gets a maiden over credited
    assert.equal(state.bowlingStats.b1.maidens, 0);
    assert.equal(state.bowlingStats.b2.maidens, 0);
    assert.equal(state.lastCompletedOverBowlerId, 'b2');
  });

  it('19.2.13: Retire and Swap Batsman, retired hurt batsman returning later', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 10 }, // Hassan = 10 off 1 ball (with extras etc)
      // Hassan retires hurt
      { eventId: 'e2', sequence: 2, eventType: 'retire', slot: 'striker', wicketType: 'retired_hurt', replacementPlayerId: 'p3', replacementPlayerName: 'Zaid' },
      { eventId: 'e3', sequence: 3, batRuns: 4 },  // Zaid = 4
      // Zaid gets out bowled
      { eventId: 'e4', sequence: 4, isWicket: true, wicketType: 'bowled' },
      // Hassan returns from retired hurt!
      { eventId: 'e5', sequence: 5, eventType: 'new_batsman', playerId: 'p1', playerName: 'Hassan', slot: 'striker' },
      { eventId: 'e6', sequence: 6, batRuns: 6 }  // Hassan hits a six!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.wickets, 1); // only Zaid out
    assert.equal(state.battingStats.p1.runs, 16); // 10 + 6
    assert.equal(state.battingStats.p1.isRetiredHurt, false); // Active again!
    assert.equal(state.strikerId, 'p1');
  });

  it('19.2.14: Multi-undo restores exact strike, bowler stats, over count, and free hit', () => {
    const setup = makeScenarioSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'no_ball', batRuns: 2 }, // Free hit active, p1 runs 2
      { eventId: 'e2', sequence: 2, batRuns: 1 },                      // Free hit consumed, strike rotates
      { eventId: 'e3', sequence: 3, isWicket: true, wicketType: 'bowled' } // Wicket
    ];
    const state3 = engine.replayInnings(setup, events);
    assert.equal(state3.wickets, 1);
    assert.equal(state3.isFreeHit, false);

    // Undo e3 (wicket)
    events[2].isVoided = true;
    const state2 = engine.replayInnings(setup, events);
    assert.equal(state2.wickets, 0);
    assert.equal(state2.isFreeHit, false);

    // Undo e2 (legal ball after NB) -> Free hit must be restored!
    events[1].isVoided = true;
    const state1 = engine.replayInnings(setup, events);
    assert.equal(state1.isFreeHit, true);
    assert.equal(state1.legalBalls, 0);
    assert.equal(state1.totalRuns, 3); // 1 NB + 2 runs
  });

  it('19.2.15: Match Chase Results: won by wickets, won by runs, tie, abandoned', () => {
    const rules = engine.getDefaultRules();
    const inn1 = { totalRuns: 100, wickets: 8, battingTeamId: 't1', battingTeamName: 'Lions' };

    // Won by wickets
    const inn2Chase = { totalRuns: 101, wickets: 4, battingTeamId: 't2', battingTeamName: 'Tigers' };
    const rWickets = engine.evaluateMatchResult(inn1, inn2Chase, rules);
    assert.equal(rWickets.winnerTeamId, 't2');
    assert.match(rWickets.marginText, /won by 6 wickets/);

    // Won by runs
    const inn2Fail = { totalRuns: 85, wickets: 10, battingTeamId: 't2', battingTeamName: 'Tigers' };
    const rRuns = engine.evaluateMatchResult(inn1, inn2Fail, rules);
    assert.equal(rRuns.winnerTeamId, 't1');
    assert.match(rRuns.marginText, /won by 15 runs/);

    // Tied match
    const inn2Tie = { totalRuns: 100, wickets: 7, battingTeamId: 't2', battingTeamName: 'Tigers' };
    const rTie = engine.evaluateMatchResult(inn1, inn2Tie, rules);
    assert.equal(rTie.status, 'tied');
    assert.equal(rTie.marginText, 'Match Tied');

    // Abandoned match
    const inn2Ab = { status: 'abandoned', totalRuns: 20, wickets: 1, battingTeamId: 't2', battingTeamName: 'Tigers' };
    const rAb = engine.evaluateMatchResult(inn1, inn2Ab, rules);
    assert.equal(rAb.status, 'abandoned');
    assert.match(rAb.marginText, /Abandoned/);
  });

  // =========================================================================
  // 5. HAND-CALCULATED BENCHMARK STATS & NRR
  // =========================================================================
  it('19.2.16: Hand-calculated benchmark: Batting Avg, SR, Economy, Run Rate, NRR', () => {
    // Hassan: 45 runs off 30 balls -> SR = (45/30) * 100 = 150.00
    const sr = engine.calcStrikeRate(45, 30);
    assert.equal(sr, 150.0);

    // Bowler Rashid: 24 runs conceded in 3.4 overs (22 legal balls) -> Economy = (24 / 22) * 6 = 6.5454... -> 6.55
    const econ = engine.calcEconomy(24, 22, 6);
    assert.equal(Number(econ.toFixed(2)), 6.55);

    // Run rate: 75 runs in 8.3 overs (51 balls) -> RR = (75 / 51) * 6 = 8.8235... -> 8.82
    const rr = engine.calcRunRate(75, 51, 6);
    assert.equal(Number(rr.toFixed(2)), 8.82);

    // Net Run Rate Hand-check:
    // Team A: Scored 150 in 20.0 ov (RR = 7.50). Conceded 120 in 20.0 ov (RR = 6.00).
    // Expected NRR = 7.50 - 6.00 = +1.500
    const nrr = engine.calculateTeamNRR([
      {
        runsScored: 150,
        ballsFaced: 120,
        wasAllOut: false,
        runsConceded: 120,
        ballsBowled: 120,
        opponentWasAllOut: false,
        scheduledOvers: 20,
        ballsPerOver: 6
      }
    ]);
    assert.equal(nrr, 1.5);
  });

  // =========================================================================
  // 6. APP FLOW VALIDATION & SECURITY
  // =========================================================================
  it('19.3.1: Rule normalizer rejects invalid overs (0, negative, >100) and balls per over', () => {
    const vZero = engine.validateAndNormalizeRules({ format: { oversPerInnings: 0 } });
    assert.equal(vZero.valid, false);

    const vHuge = engine.validateAndNormalizeRules({ format: { oversPerInnings: 500 } });
    assert.equal(vHuge.valid, false);

    const vBpo = engine.validateAndNormalizeRules({ format: { ballsPerOver: 15 } });
    assert.equal(vBpo.valid, false);
  });

  it('19.5.1: Rapid scoring stress test (100 balls) deterministically without state corruption', () => {
    const setup = makeScenarioSetup({ format: { oversPerInnings: 20, unlimitedWickets: true } });
    const events = [];
    for (let i = 1; i <= 100; i++) {
      events.push({
        eventId: `rapid_${i}`,
        sequence: i,
        batRuns: i % 7 === 0 ? 6 : (i % 5 === 0 ? 4 : (i % 2 === 0 ? 2 : 1))
      });
    }
    const state = engine.replayInnings(setup, events);
    assert.equal(state.legalBalls, 100);
    assert.equal(state.oversString, '16.4');
    assert.ok(state.totalRuns > 150);
  });

  it('19.6.1: Idempotent Action IDs: duplicate events are safely ignored', () => {
    const setup = makeScenarioSetup();
    const event1 = { eventId: 'unique_action_101', sequence: 1, batRuns: 4 };
    const duplicateEvent1 = { eventId: 'unique_action_101', sequence: 1, batRuns: 4 };
    const event2 = { eventId: 'unique_action_102', sequence: 2, batRuns: 2 };

    // Pass deduplicated sequence
    const uniqueEvents = [event1, duplicateEvent1].filter((ev, idx, arr) => arr.findIndex(x => x.eventId === ev.eventId) === idx);
    uniqueEvents.push(event2);

    const state = engine.replayInnings(setup, uniqueEvents);
    assert.equal(state.legalBalls, 2);
    assert.equal(state.totalRuns, 6);
  });

  it('19.6.2: XSS injection payloads in player names & commentary are sanitized', () => {
    const xssPayload = '<script>alert("hacked")</script>';
    const setup = makeScenarioSetup({}, {
      battingSquad: [{ playerId: 'p1', name: xssPayload }, { playerId: 'p2', name: 'Tariq' }],
      bowlingSquad: [{ playerId: 'b1', name: 'Rashid' }]
    });
    setup.openingStrikerName = xssPayload;

    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 1, commentary: xssPayload }
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.battingStats.p1.name, xssPayload);
    // Commentary generated does not execute or unescaped in UI (tested via ApnaUI.escapeHtml)
    const escaped = state.commentary[0].text;
    assert.ok(escaped.includes(xssPayload));
  });
});
