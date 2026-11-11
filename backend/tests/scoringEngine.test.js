const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../js/scoring-engine');

function baseSetup(ruleOverrides = {}) {
  const { rules } = engine.validateAndNormalizeRules(ruleOverrides);
  return {
    inningsNumber: 1,
    battingTeamId: 'teamA',
    battingTeamName: 'Gaon Lions',
    bowlingTeamId: 'teamB',
    bowlingTeamName: 'Bazaar Tigers',
    openingStrikerId: 'p1',
    openingStrikerName: 'Raju',
    openingNonStrikerId: 'p2',
    openingNonStrikerName: 'Vikram',
    openingBowlerId: 'b1',
    openingBowlerName: 'Suresh',
    battingSquad: [
      { playerId: 'p1', name: 'Raju' },
      { playerId: 'p2', name: 'Vikram' },
      { playerId: 'p3', name: 'Aman' },
      { playerId: 'p4', name: 'Deepak' }
    ],
    bowlingSquad: [
      { playerId: 'b1', name: 'Suresh' },
      { playerId: 'b2', name: 'Karan' }
    ],
    rules
  };
}

describe('ApnaScore Scoring & Custom Rule Engine', () => {
  it('1. Normal scoring (0, 1, 2, 3, 4, 6) and odd/even strike rotation', () => {
    const setup = baseSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 1 }, // Raju 1 -> Vikram on strike
      { eventId: 'e2', sequence: 2, batRuns: 2 }, // Vikram 2 -> Vikram stays on strike
      { eventId: 'e3', sequence: 3, batRuns: 3 }, // Vikram 3 -> Raju on strike
      { eventId: 'e4', sequence: 4, batRuns: 4 }, // Raju 4 -> Raju stays on strike
      { eventId: 'e5', sequence: 5, batRuns: 6 }, // Raju 6 -> Raju stays on strike
      { eventId: 'e6', sequence: 6, batRuns: 0 }  // Over ends -> Vikram on strike
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 16);
    assert.equal(state.legalBalls, 6);
    assert.equal(state.oversString, '1.0');
    assert.equal(state.completedOvers, 1);
    assert.equal(state.needsBowlerChange, true);
    assert.equal(state.strikerId, 'p2');
    assert.equal(state.nonStrikerId, 'p1');
    assert.equal(state.battingStats.p1.runs, 11);
    assert.equal(state.battingStats.p1.fours, 1);
    assert.equal(state.battingStats.p1.sixes, 1);
    assert.equal(state.battingStats.p2.runs, 5);
    assert.equal(state.bowlingStats.b1.overs, '1.0');
    assert.equal(state.bowlingStats.b1.runs, 16);
  });

  it('2. Wide with additional runs: does not rotate on plain wide, rotates on odd additional run', () => {
    const setup = baseSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'wide', additionalExtraRuns: 0 }, // 1 run, striker remains p1
      { eventId: 'e2', sequence: 2, extraType: 'wide', additionalExtraRuns: 1 }  // 2 runs, 1 completed -> rotates to p2!
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 3);
    assert.equal(state.legalBalls, 0);
    assert.equal(state.extrasBreakdown.wides, 3);
    assert.equal(state.strikerId, 'p2');
    assert.equal(state.battingStats.p1.balls, 0);
    assert.equal(state.bowlingStats.b1.wides, 2);
  });

  it('3. No-ball with bat runs and Free Hit enforcement', () => {
    const setup = baseSetup();
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'no_ball', batRuns: 4 }, // 1 NB + 4 bat = 5 runs, p1 stays on strike, Free Hit active
      { eventId: 'e2', sequence: 2, batRuns: 1 } // Free Hit ball, 1 run -> p2 on strike, Free Hit cleared
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 6);
    assert.equal(state.legalBalls, 1);
    assert.equal(state.isFreeHit, false);
    assert.equal(state.battingStats.p1.runs, 5);
    assert.equal(state.battingStats.p1.fours, 1);
    assert.equal(state.extrasBreakdown.noBalls, 1);
    assert.equal(state.bowlingStats.b1.noBalls, 1);
    assert.equal(state.strikerId, 'p2');

    // Verify Free Hit blocks bowled dismissal
    const mid = engine.replayInnings(setup, [events[0]]);
    assert.equal(mid.isFreeHit, true);
    const val = engine.validateDeliveryInput(mid, { isWicket: true, wicketType: 'bowled' }, setup.rules);
    assert.equal(val.valid, false);
    const runOutVal = engine.validateDeliveryInput(mid, { isWicket: true, wicketType: 'run_out' }, setup.rules);
    assert.equal(runOutVal.valid, true);
  });

  it('4. Byes, Leg-byes, and Overthrows follow custom rules', () => {
    const setup = baseSetup({
      extras: {
        overthrow: { countsToBatsman: true, countsToBowler: true, rotatesStrikeOnOdd: true }
      }
    });
    const events = [
      { eventId: 'e1', sequence: 1, extraType: 'bye', additionalExtraRuns: 1 }, // 1 bye, rotates to p2
      { eventId: 'e2', sequence: 2, extraType: 'leg_bye', additionalExtraRuns: 2 }, // 2 lb, stays p2
      { eventId: 'e3', sequence: 3, batRuns: 1, overthrowRuns: 2 } // 1+2=3 odd -> rotates to p1, p2 gets 3 runs
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.totalRuns, 6);
    assert.equal(state.extrasBreakdown.byes, 1);
    assert.equal(state.extrasBreakdown.legByes, 2);
    assert.equal(state.extrasBreakdown.overthrows, 2);
    assert.equal(state.battingStats.p2.runs, 3);
    assert.equal(state.bowlingStats.b1.runs, 3); // byes & leg-byes don't count against bowler
    assert.equal(state.strikerId, 'p1');
  });

  it('5. Wicket on legal delivery and Run out on non-legal delivery', () => {
    const setup = baseSetup();
    const events = [
      { eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'bowled' },
      { eventId: 'e2', sequence: 2, eventType: 'new_batsman', playerId: 'p3', playerName: 'Aman' },
      { eventId: 'e3', sequence: 3, extraType: 'wide', additionalExtraRuns: 1, isWicket: true, wicketType: 'run_out', dismissedSlot: 'non_striker' }
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.wickets, 2);
    assert.equal(state.battingStats.p1.isOut, true);
    assert.equal(state.battingStats.p2.isOut, true);
    assert.equal(state.bowlingStats.b1.wickets, 1); // Run out does not credit bowler
    assert.equal(state.fallOfWickets.length, 2);
    assert.equal(state.needsNewBatsman, true);
  });

  it('6. Manual Swap Batsmen, Retired Hurt (can return), Retired Out (counts as wicket)', () => {
    const setup = baseSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 2 }, // p1 = 2
      { eventId: 'e2', sequence: 2, eventType: 'swap_batsmen' }, // p2 now striker
      { eventId: 'e3', sequence: 3, eventType: 'retire', slot: 'striker', wicketType: 'retired_hurt', replacementPlayerId: 'p3', replacementPlayerName: 'Aman' },
      { eventId: 'e4', sequence: 4, batRuns: 4 }, // p3 = 4
      { eventId: 'e5', sequence: 5, eventType: 'retire', slot: 'striker', wicketType: 'retired_out', replacementPlayerId: 'p2', replacementPlayerName: 'Vikram' }
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.wickets, 1); // only retired_out counts as wicket
    assert.equal(state.battingStats.p3.isOut, true);
    assert.equal(state.battingStats.p2.isRetiredHurt, false); // returned!
    assert.equal(state.strikerId, 'p2');
  });

  it('7. Undo and Edit Previous Ball via deterministic replay', () => {
    const setup = baseSetup();
    const events = [
      { eventId: 'e1', sequence: 1, batRuns: 4 },
      { eventId: 'e2', sequence: 2, batRuns: 6 },
      { eventId: 'e3', sequence: 3, batRuns: 1 }
    ];
    const before = engine.replayInnings(setup, events);
    assert.equal(before.totalRuns, 11);

    // Undo last event (void e3)
    events[2].isVoided = true;
    const afterUndo = engine.replayInnings(setup, events);
    assert.equal(afterUndo.totalRuns, 10);
    assert.equal(afterUndo.legalBalls, 2);
    assert.equal(afterUndo.strikerId, 'p1');

    // Edit e2 from 6 to 2
    events[1].batRuns = 2;
    const afterEdit = engine.replayInnings(setup, events);
    assert.equal(afterEdit.totalRuns, 6);
    assert.equal(afterEdit.battingStats.p1.sixes, 0);
  });

  it('8. Last-man batting & Unlimited wickets custom village rules', () => {
    const setup = baseSetup({
      format: { playersPerTeam: 3, oversPerInnings: 2 },
      localRules: { lastManBatting: true }
    });
    const events = [
      { eventId: 'e1', sequence: 1, isWicket: true, wicketType: 'bowled' },
      { eventId: 'e2', sequence: 2, eventType: 'new_batsman', playerId: 'p3', playerName: 'Aman' },
      { eventId: 'e3', sequence: 3, isWicket: true, wicketType: 'caught' },
      // Now only p2 (non-striker) remains, promoted automatically to striker because lastManBatting = true!
      { eventId: 'e4', sequence: 4, batRuns: 1 } // Lone batter keeps strike
    ];
    const state = engine.replayInnings(setup, events);
    assert.equal(state.wickets, 2);
    assert.equal(state.status, 'live');
    assert.equal(state.strikerId, 'p2');
    assert.equal(state.nonStrikerId, null);
    assert.equal(state.needsNewBatsman, false);
    assert.equal(state.totalRuns, 1);

    // 3rd wicket ends innings
    events.push({ eventId: 'e5', sequence: 5, isWicket: true, wicketType: 'bowled' });
    const ended = engine.replayInnings(setup, events);
    assert.equal(ended.status, 'completed');
    assert.equal(ended.endReason, 'all_out');
  });

  it('9. Target chased, Tie evaluation, and Net Run Rate (including all-out rule)', () => {
    const setup2 = baseSetup({ format: { oversPerInnings: 5 } });
    setup2.inningsNumber = 2;
    setup2.target = 10;
    const chaseEvents = [
      { eventId: 'e1', sequence: 1, batRuns: 6 },
      { eventId: 'e2', sequence: 2, batRuns: 4 }
    ];
    const inn2 = engine.replayInnings(setup2, chaseEvents);
    assert.equal(inn2.status, 'completed');
    assert.equal(inn2.endReason, 'target_chased');
    assert.equal(inn2.totalRuns, 10);

    const inn1 = { totalRuns: 9, wickets: 5, battingTeamId: 'teamB', battingTeamName: 'Bazaar Tigers' };
    const res = engine.evaluateMatchResult(inn1, inn2, setup2.rules);
    assert.equal(res.winnerTeamId, 'teamA');
    assert.match(res.marginText, /won by 10 wickets/);

    // NRR: Team scored 100 in 10 overs (not all out), conceded 90 in 8.0 overs (opponent all out in 10-over match -> credited 10 overs!)
    const nrr = engine.calculateTeamNRR([
      {
        runsScored: 100,
        ballsFaced: 60,
        wasAllOut: false,
        runsConceded: 90,
        ballsBowled: 48,
        opponentWasAllOut: true,
        scheduledOvers: 10,
        ballsPerOver: 6
      }
    ]);
    assert.equal(nrr, 1.0); // 100/10 - 90/10 = +1.000
  });
});
