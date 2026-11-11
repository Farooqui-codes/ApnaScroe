const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../js/scoring-engine');
const pdfService = require('../services/pdfService');

function makeSetup(overrides = {}) {
  const { rules } = engine.validateAndNormalizeRules(overrides);
  return {
    inningsNumber: 1,
    battingTeamId: 'tA',
    battingTeamName: 'Rampur Lions',
    bowlingTeamId: 'tB',
    bowlingTeamName: 'Kishanpur Tigers',
    openingStrikerId: 'p1',
    openingStrikerName: 'Ramesh',
    openingNonStrikerId: 'p2',
    openingNonStrikerName: 'Suresh',
    openingBowlerId: 'b1',
    openingBowlerName: 'Vikash',
    battingSquad: Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i + 1}`, name: `Batter ${i + 1} Long Village Name` })),
    bowlingSquad: [
      { playerId: 'b1', name: 'Vikash' },
      { playerId: 'b2', name: 'Deepak' }
    ],
    rules
  };
}

describe('Custom Cricket Rules & PDF Generation Verification', () => {
  it('validates all 6 built-in rule presets cleanly', () => {
    const presets = engine.getRulePresets();
    assert.equal(presets.length, 6);
    for (const p of presets) {
      const res = engine.validateAndNormalizeRules(p);
      assert.equal(res.valid, true, `Preset ${p.presetId} failed validation`);
    }
  });

  it('supports unlimited wickets in gully/street cricket', () => {
    const setup = makeSetup({
      format: { oversPerInnings: 2, playersPerTeam: 4, unlimitedWickets: true }
    });
    const events = [
      { eventId: '1', sequence: 1, isWicket: true, wicketType: 'bowled' },
      { eventId: '2', sequence: 2, eventType: 'new_batsman', playerId: 'p3', playerName: 'P3' },
      { eventId: '3', sequence: 3, isWicket: true, wicketType: 'caught' },
      { eventId: '4', sequence: 4, eventType: 'new_batsman', playerId: 'p4', playerName: 'P4' },
      { eventId: '5', sequence: 5, isWicket: true, wicketType: 'bowled' },
      { eventId: '6', sequence: 6, eventType: 'new_batsman', playerId: 'p1', playerName: 'P1' },
      { eventId: '7', sequence: 7, isWicket: true, wicketType: 'bowled' }
    ];
    const st = engine.replayInnings(setup, events);
    assert.equal(st.wickets, 4);
    assert.equal(st.status, 'live'); // Does NOT end at 3 or 4 wickets!
  });

  it('handles wide counting as legal delivery when configured', () => {
    const setup = makeSetup({
      extras: { wide: { enabled: true, baseRuns: 2, countsAsLegalDelivery: true, countsToBowler: false } }
    });
    const st = engine.replayInnings(setup, [
      { eventId: 'w1', sequence: 1, extraType: 'wide', additionalExtraRuns: 0 }
    ]);
    assert.equal(st.totalRuns, 2);
    assert.equal(st.legalBalls, 1);
    assert.equal(st.bowlingStats.b1.runs, 0);
  });

  it('handles overthrow NOT credited to batsman when configured off', () => {
    const setup = makeSetup({
      extras: { overthrow: { enabled: true, countsToTeam: true, countsToBatsman: false, countsToBowler: true, rotatesStrikeOnOdd: true } }
    });
    const st = engine.replayInnings(setup, [
      { eventId: 'o1', sequence: 1, batRuns: 1, overthrowRuns: 2 }
    ]);
    assert.equal(st.totalRuns, 3);
    assert.equal(st.battingStats.p1.runs, 1);
    assert.equal(st.bowlingStats.b1.runs, 3);
    assert.equal(st.strikerId, 'p2');
  });

  it('computes maiden over accurately when bowler concedes 0 runs in full over', () => {
    const setup = makeSetup();
    const events = [
      { eventId: 'm1', sequence: 1, batRuns: 0 },
      { eventId: 'm2', sequence: 2, extraType: 'bye', additionalExtraRuns: 1 }, // byes don't count against bowler!
      { eventId: 'm3', sequence: 3, batRuns: 0 },
      { eventId: 'm4', sequence: 4, batRuns: 0 },
      { eventId: 'm5', sequence: 5, batRuns: 0 },
      { eventId: 'm6', sequence: 6, batRuns: 0 }
    ];
    const st = engine.replayInnings(setup, events);
    assert.equal(st.totalRuns, 1);
    assert.equal(st.completedOvers, 1);
    assert.equal(st.bowlingStats.b1.maidens, 1);
    assert.equal(st.bowlingStats.b1.runs, 0);
  });

  it('generates genuine multi-page PDFKit match scorecard buffer', async () => {
    const setup = makeSetup({ format: { oversPerInnings: 10 } });
    const events = [];
    let seq = 1;
    for (let i = 0; i < 12; i++) {
      events.push({ eventId: `ev_${seq}`, sequence: seq++, batRuns: i % 2 === 0 ? 4 : 1 });
    }
    const state1 = engine.replayInnings(setup, events);
    const match = {
      _id: 'match123',
      title: 'Rampur Premier League Final',
      venue: 'Panchayat Ground, Rampur',
      matchDate: new Date(),
      oversPerInnings: 10,
      ballType: 'tennis',
      teamA: { name: 'Rampur Lions' },
      teamB: { name: 'Kishanpur Tigers' },
      toss: { winnerTeamName: 'Rampur Lions', decision: 'bat' },
      status: 'completed',
      result: { marginText: 'Rampur Lions won by 15 runs', playerOfMatchName: 'Batter 1' },
      officials: { umpire1: 'Mohan', scorerName: 'Arjun' },
      rulesSnapshot: setup.rules
    };
    const inningsList = [
      {
        inningsNumber: 1,
        battingTeamName: 'Rampur Lions',
        totalRuns: state1.totalRuns,
        wickets: state1.wickets,
        legalBalls: state1.legalBalls,
        oversString: state1.oversString,
        extrasBreakdown: state1.extrasBreakdown,
        computedState: state1
      },
      {
        inningsNumber: 2,
        battingTeamName: 'Kishanpur Tigers',
        totalRuns: Math.max(0, state1.totalRuns - 15),
        wickets: 6,
        legalBalls: 12,
        oversString: '2.0',
        target: state1.totalRuns + 1,
        extrasBreakdown: state1.extrasBreakdown,
        computedState: state1
      }
    ];

    const pdfBuf = await pdfService.generateMatchScorecardPDF({
      match,
      inningsList,
      tournament: { name: 'Rampur Premier League' }
    });
    assert.ok(Buffer.isBuffer(pdfBuf));
    assert.ok(pdfBuf.length > 5000, 'PDF buffer should contain full scorecard content');
    assert.equal(pdfBuf.subarray(0, 5).toString('utf8'), '%PDF-');
  });

  it('generates genuine PDFKit tournament results & points table buffer', async () => {
    const pdfBuf = await pdfService.generateTournamentPDF({
      tournament: { name: 'Gaon Cup 2026', village: 'Rampur', format: 'league_knockout', oversPerMatch: 8, status: 'completed', entryFee: 500, prizeMoney: '₹11,000' },
      pointsTable: [
        { teamName: 'Rampur Lions', played: 3, won: 3, lost: 0, tied: 0, points: 6, netRunRate: 1.45, qualified: true },
        { teamName: 'Kishanpur Tigers', played: 3, won: 2, lost: 1, tied: 0, points: 4, netRunRate: 0.32, qualified: true }
      ],
      fixtures: [
        { matchNumber: 1, roundName: 'Final', teamAName: 'Rampur Lions', teamBName: 'Kishanpur Tigers', resultText: 'Rampur Lions won by 15 runs' }
      ],
      awards: [{ title: 'Orange Cap', playerName: 'Ramesh', metricText: '185 Runs' }]
    });
    assert.ok(Buffer.isBuffer(pdfBuf));
    assert.equal(pdfBuf.subarray(0, 5).toString('utf8'), '%PDF-');
  });
});
