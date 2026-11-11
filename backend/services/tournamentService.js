const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Team = require('../models/Team');
const engine = require('./scoringEngine');

/**
 * Generates automatic fixtures for a tournament based on its format and approved teams.
 */
async function generateFixturesForTournament(tournamentId) {
  const tournament = await Tournament.findById(tournamentId).populate('registeredTeams.teamId', 'name shortName village');
  if (!tournament) throw new Error('Tournament not found');

  const approved = (tournament.registeredTeams || []).filter((r) => r.status === 'approved' && r.teamId);
  if (approved.length < 2) {
    throw new Error('At least 2 approved teams are required to generate fixtures.');
  }

  // Clear previously generated unplayed fixtures
  await TournamentFixture.deleteMany({ tournamentId: tournament._id, status: 'scheduled' });

  const fixtures = [];
  let matchCounter = 1;
  const baseDate = new Date(tournament.startDate || Date.now());

  const makeFixture = (teamA, teamB, roundName, roundOrder, groupName = 'Group A') => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + Math.floor((matchCounter - 1) / 2));
    fixtures.push({
      tournamentId: tournament._id,
      roundName,
      roundOrder,
      matchNumber: matchCounter++,
      groupName,
      teamAId: teamA ? teamA._id : null,
      teamAName: teamA ? teamA.name : 'TBD',
      teamBId: teamB ? teamB._id : null,
      teamBName: teamB ? teamB.name : 'TBD',
      scheduledDate: d,
      venue: tournament.village,
      status: 'scheduled'
    });
  };

  const teams = approved.map((a) => ({
    _id: a.teamId._id,
    name: a.teamId.name,
    groupName: a.groupName || 'Group A'
  }));

  const fmt = tournament.format;

  if (fmt === 'knockout' || fmt === 'double_elimination') {
    const roundName = teams.length <= 2 ? 'Final' : teams.length <= 4 ? 'Semi-Final' : 'Quarter-Final';
    for (let i = 0; i < teams.length; i += 2) {
      if (teams[i + 1]) {
        makeFixture(teams[i], teams[i + 1], roundName, 1, 'Knockout');
      }
    }
    if (teams.length > 2) {
      makeFixture(null, null, 'Final', 2, 'Knockout');
    }
  } else if (fmt === 'group_stage') {
    const groups = {};
    teams.forEach((t, idx) => {
      const grp = t.groupName || (idx % 2 === 0 ? 'Group A' : 'Group B');
      groups[grp] = groups[grp] || [];
      groups[grp].push(t);
    });
    for (const [grp, grpTeams] of Object.entries(groups)) {
      for (let i = 0; i < grpTeams.length; i++) {
        for (let j = i + 1; j < grpTeams.length; j++) {
          makeFixture(grpTeams[i], grpTeams[j], `${grp} League`, 1, grp);
        }
      }
    }
    makeFixture(null, null, 'Semi-Final 1', 2, 'Knockout');
    makeFixture(null, null, 'Semi-Final 2', 2, 'Knockout');
    makeFixture(null, null, 'Final', 3, 'Knockout');
  } else {
    // league, round_robin, league_knockout
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        makeFixture(teams[i], teams[j], 'League Stage', 1, 'League');
      }
    }
    if (fmt === 'league_knockout') {
      if (teams.length >= 4) {
        makeFixture(null, null, 'Semi-Final 1', 2, 'Knockout');
        makeFixture(null, null, 'Semi-Final 2', 2, 'Knockout');
      }
      makeFixture(null, null, 'Final', 3, 'Knockout');
    }
  }

  const created = await TournamentFixture.insertMany(fixtures);
  await rebuildPointsTable(tournament._id);
  return created;
}

/**
 * Recalculates the entire tournament Points Table & Net Run Rate from completed tournament matches.
 */
async function rebuildPointsTable(tournamentId) {
  const tournament = await Tournament.findById(tournamentId).populate('registeredTeams.teamId', 'name');
  if (!tournament) return [];

  const approved = (tournament.registeredTeams || []).filter((r) => r.status === 'approved' && r.teamId);
  const pCfg = tournament.pointsConfig || { win: 2, loss: 0, tie: 1, noResult: 1, tieBreaker: 'nrr' };

  const tableMap = new Map();
  for (const reg of approved) {
    const tid = String(reg.teamId._id);
    tableMap.set(tid, {
      tournamentId: tournament._id,
      groupName: reg.groupName || 'Group A',
      teamId: reg.teamId._id,
      teamName: reg.teamId.name,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      matchStats: [],
      runsScored: 0,
      oversFacedDecimal: 0,
      runsConceded: 0,
      oversBowledDecimal: 0,
      netRunRate: 0,
      qualified: false
    });
  }

  const matches = await Match.find({
    tournamentId: tournament._id,
    status: { $in: ['completed', 'tied', 'abandoned'] }
  });

  const matchIds = matches.map((m) => m._id);
  const inningsList = await Innings.find({ matchId: { $in: matchIds } });
  const inningsByMatch = new Map();
  for (const inn of inningsList) {
    const mid = String(inn.matchId);
    if (!inningsByMatch.has(mid)) inningsByMatch.set(mid, []);
    inningsByMatch.get(mid).push(inn);
  }

  for (const m of matches) {
    const idA = String(m.teamA.teamId);
    const idB = String(m.teamB.teamId);
    const rowA = tableMap.get(idA);
    const rowB = tableMap.get(idB);
    if (rowA) rowA.played += 1;
    if (rowB) rowB.played += 1;

    if (m.status === 'abandoned') {
      if (rowA) { rowA.noResult += 1; rowA.points += pCfg.noResult; }
      if (rowB) { rowB.noResult += 1; rowB.points += pCfg.noResult; }
      continue;
    }

    if (m.status === 'tied' || (m.result && m.result.isTie)) {
      if (rowA) { rowA.tied += 1; rowA.points += pCfg.tie; }
      if (rowB) { rowB.tied += 1; rowB.points += pCfg.tie; }
    } else if (m.result && m.result.winnerTeamId) {
      const winnerId = String(m.result.winnerTeamId);
      if (rowA) {
        if (winnerId === idA) { rowA.won += 1; rowA.points += pCfg.win; }
        else { rowA.lost += 1; rowA.points += pCfg.loss; }
      }
      if (rowB) {
        if (winnerId === idB) { rowB.won += 1; rowB.points += pCfg.win; }
        else { rowB.lost += 1; rowB.points += pCfg.loss; }
      }
    }

    // NRR calculation with all-out innings credit rule
    const mInnings = inningsByMatch.get(String(m._id)) || [];
    const inn1 = mInnings.find((i) => i.inningsNumber === 1);
    const inn2 = mInnings.find((i) => i.inningsNumber === 2);
    if (inn1 && inn2 && inn1.computedState && inn2.computedState) {
      const rules = m.rulesSnapshot || {};
      const bpo = (rules.format && rules.format.ballsPerOver) || 6;
      const scheduledOvers = m.oversPerInnings || 20;
      const maxWickets = (rules.format && rules.format.maxWickets) || 10;
      const unlimited = Boolean(rules.format && rules.format.unlimitedWickets);

      const inn1AllOut = !unlimited && (inn1.wickets >= maxWickets || inn1.computedState.endReason === 'all_out');
      const inn2AllOut = !unlimited && (inn2.wickets >= maxWickets || inn2.computedState.endReason === 'all_out');

      const bat1Row = tableMap.get(String(inn1.battingTeamId));
      const bat2Row = tableMap.get(String(inn2.battingTeamId));

      if (bat1Row) {
        bat1Row.matchStats.push({
          runsScored: inn1.totalRuns,
          ballsFaced: inn1.legalBalls,
          wasAllOut: inn1AllOut,
          runsConceded: inn2.totalRuns,
          ballsBowled: inn2.legalBalls,
          opponentWasAllOut: inn2AllOut,
          scheduledOvers,
          ballsPerOver: bpo
        });
      }
      if (bat2Row) {
        bat2Row.matchStats.push({
          runsScored: inn2.totalRuns,
          ballsFaced: inn2.legalBalls,
          wasAllOut: inn2AllOut,
          runsConceded: inn1.totalRuns,
          ballsBowled: inn1.legalBalls,
          opponentWasAllOut: inn1AllOut,
          scheduledOvers,
          ballsPerOver: bpo
        });
      }
    }
  }

  const rows = Array.from(tableMap.values()).map((r) => {
    r.netRunRate = engine.calculateTeamNRR(r.matchStats);
    r.runsScored = r.matchStats.reduce((s, x) => s + x.runsScored, 0);
    r.runsConceded = r.matchStats.reduce((s, x) => s + x.runsConceded, 0);
    delete r.matchStats;
    return r;
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (pCfg.tieBreaker === 'wins' && b.won !== a.won) return b.won - a.won;
    return b.netRunRate - a.netRunRate;
  });

  // Mark top 4 (or top 2) as qualified
  const qualCount = rows.length >= 4 ? 4 : 2;
  rows.forEach((r, idx) => {
    r.qualified = r.played > 0 && idx < qualCount;
  });

  await PointsTable.deleteMany({ tournamentId: tournament._id });
  if (rows.length > 0) {
    await PointsTable.insertMany(rows);
  }
  return rows;
}

module.exports = {
  generateFixturesForTournament,
  rebuildPointsTable
};
