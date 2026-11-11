const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Player = require('../models/Player');
const Team = require('../models/Team');
const Award = require('../models/Award');
const engine = require('./scoringEngine');

/**
 * Rebuilds a match's Scorecard document and updates involved Players' career stats
 * deterministically from all completed / live innings records.
 */
async function syncPlayersAndTeamsForMatch(matchId) {
  const match = await Match.findById(matchId);
  if (!match) return;

  const playerIds = new Set();
  for (const p of match.teamA.squad || []) playerIds.add(String(p.playerId));
  for (const p of match.teamB.squad || []) playerIds.add(String(p.playerId));

  // Rebuild career stats for each involved player across all completed/live matches
  for (const pid of playerIds) {
    await rebuildPlayerCareerStats(pid);
  }

  // Rebuild team stats for both teams
  await rebuildTeamStats(match.teamA.teamId);
  await rebuildTeamStats(match.teamB.teamId);
}

async function rebuildPlayerCareerStats(playerId) {
  const player = await Player.findById(playerId);
  if (!player) return null;

  const matches = await Match.find({
    status: { $in: ['completed', 'tied'] },
    $or: [
      { 'teamA.squad.playerId': player._id },
      { 'teamB.squad.playerId': player._id }
    ]
  }).select('_id result.playerOfMatchId');

  const matchIds = matches.map((m) => m._id);
  const inningsList = await Innings.find({ matchId: { $in: matchIds } });

  let inningsCount = 0;
  let notOuts = 0;
  let runs = 0;
  let ballsFaced = 0;
  let highestScore = 0;
  let highestNotOut = false;
  let fours = 0;
  let sixes = 0;
  let fifties = 0;
  let hundreds = 0;

  let oversBowledBalls = 0;
  let runsConceded = 0;
  let wickets = 0;
  let maidens = 0;
  let bestBowlingWickets = 0;
  let bestBowlingRuns = 9999;
  let catches = 0;

  const pid = String(player._id);

  for (const inn of inningsList) {
    const state = inn.computedState;
    if (!state) continue;

    if (state.battingStats && state.battingStats[pid]) {
      const b = state.battingStats[pid];
      if (b.balls > 0 || b.isOut || b.runs > 0) {
        inningsCount += 1;
        if (!b.isOut) notOuts += 1;
        runs += b.runs || 0;
        ballsFaced += b.balls || 0;
        fours += b.fours || 0;
        sixes += b.sixes || 0;
        if ((b.runs || 0) >= 100) hundreds += 1;
        else if ((b.runs || 0) >= 50) fifties += 1;

        if ((b.runs || 0) > highestScore || ((b.runs || 0) === highestScore && !b.isOut && !highestNotOut)) {
          highestScore = b.runs || 0;
          highestNotOut = !b.isOut;
        }
      }
    }

    if (state.bowlingStats && state.bowlingStats[pid]) {
      const bw = state.bowlingStats[pid];
      oversBowledBalls += bw.legalBalls || 0;
      runsConceded += bw.runs || 0;
      wickets += bw.wickets || 0;
      maidens += bw.maidens || 0;

      if (
        (bw.wickets || 0) > bestBowlingWickets ||
        ((bw.wickets || 0) === bestBowlingWickets && (bw.runs || 0) < bestBowlingRuns)
      ) {
        bestBowlingWickets = bw.wickets || 0;
        bestBowlingRuns = bw.runs || 0;
      }
    }

    // Count catches from batting dismissals
    if (state.battingStats) {
      for (const batEntry of Object.values(state.battingStats)) {
        if (batEntry.dismissalType === 'caught' && String(batEntry.fielderId) === pid) {
          catches += 1;
        }
      }
    }
  }

  const dismissals = Math.max(0, inningsCount - notOuts);
  const average = dismissals > 0 ? Number((runs / dismissals).toFixed(2)) : runs;
  const strikeRate = engine.calcStrikeRate(runs, ballsFaced);
  const bowlingAverage = wickets > 0 ? Number((runsConceded / wickets).toFixed(2)) : 0;
  const economy = engine.calcEconomy(runsConceded, oversBowledBalls, 6);
  const potmAwards = matches.filter((m) => m.result && String(m.result.playerOfMatchId) === pid).length;

  player.stats = {
    matches: matches.length,
    innings: inningsCount,
    notOuts,
    runs,
    ballsFaced,
    highestScore,
    highestNotOut,
    average,
    strikeRate,
    fours,
    sixes,
    fifties,
    hundreds,
    oversBowledBalls,
    runsConceded,
    wickets,
    maidens,
    bowlingAverage,
    economy,
    bestBowlingWickets,
    bestBowlingRuns: bestBowlingWickets > 0 ? bestBowlingRuns : 0,
    catches,
    potmAwards
  };

  await player.save();
  return player;
}

async function rebuildTeamStats(teamId) {
  const team = await Team.findById(teamId);
  if (!team) return null;

  const matches = await Match.find({
    status: { $in: ['completed', 'tied', 'abandoned'] },
    $or: [{ 'teamA.teamId': team._id }, { 'teamB.teamId': team._id }]
  });

  let won = 0;
  let lost = 0;
  let tied = 0;
  let noResult = 0;

  for (const m of matches) {
    if (m.status === 'abandoned') {
      noResult += 1;
    } else if (m.status === 'tied' || (m.result && m.result.isTie)) {
      tied += 1;
    } else if (m.result && m.result.winnerTeamId) {
      if (String(m.result.winnerTeamId) === String(team._id)) won += 1;
      else lost += 1;
    }
  }

  const points = won * 2 + tied + noResult;
  team.stats = {
    matchesPlayed: matches.length,
    won,
    lost,
    tied,
    noResult,
    points,
    rankingPoints: 1000 + won * 25 + tied * 10 - lost * 10
  };
  await team.save();
  return team;
}

/**
 * Computes filtered statistics and leaderboards directly from matches & innings.
 */
async function getFilteredLeaderboards(filters = {}) {
  const matchQuery = { status: { $in: ['completed', 'tied', 'live'] } };
  if (filters.tournamentId) matchQuery.tournamentId = filters.tournamentId;
  if (filters.teamId) {
    matchQuery.$or = [{ 'teamA.teamId': filters.teamId }, { 'teamB.teamId': filters.teamId }];
  }
  if (filters.fromDate || filters.toDate) {
    matchQuery.matchDate = {};
    if (filters.fromDate) matchQuery.matchDate.$gte = new Date(filters.fromDate);
    if (filters.toDate) matchQuery.matchDate.$lte = new Date(filters.toDate);
  }

  const matches = await Match.find(matchQuery).select('_id matchDate tournamentId teamA teamB result');
  const matchIds = matches.map((m) => m._id);

  const playerFilter = {};
  if (filters.village) playerFilter.village = new RegExp(filters.village, 'i');
  const playersList = await Player.find(playerFilter).select('name village photoUrl teams');
  const playerMap = new Map(playersList.map((p) => [String(p._id), p]));

  const inningsList = await Innings.find({ matchId: { $in: matchIds } });
  const agg = new Map();

  function ensureEntry(pid, name) {
    if (filters.village && !playerMap.has(pid)) return null;
    if (filters.teamId) {
      const pObj = playerMap.get(pid);
      if (pObj && !(pObj.teams || []).some((t) => String(t) === String(filters.teamId))) {
        // Also allow if played in the filtered team's match
      }
    }
    if (!agg.has(pid)) {
      const pObj = playerMap.get(pid);
      agg.set(pid, {
        playerId: pid,
        name: (pObj && pObj.name) || name || 'Player',
        village: (pObj && pObj.village) || '',
        photoUrl: (pObj && pObj.photoUrl) || '',
        matches: new Set(),
        runs: 0,
        balls: 0,
        highestScore: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        bowlingBalls: 0,
        runsConceded: 0,
        catches: 0,
        mvpPoints: 0
      });
    }
    return agg.get(pid);
  }

  for (const inn of inningsList) {
    const st = inn.computedState;
    if (!st) continue;

    if (st.battingStats) {
      for (const b of Object.values(st.battingStats)) {
        const entry = ensureEntry(String(b.playerId), b.name);
        if (!entry) continue;
        entry.matches.add(String(inn.matchId));
        entry.runs += b.runs || 0;
        entry.balls += b.balls || 0;
        entry.fours += b.fours || 0;
        entry.sixes += b.sixes || 0;
        if ((b.runs || 0) > entry.highestScore) entry.highestScore = b.runs || 0;
        entry.mvpPoints += (b.runs || 0) * 1 + (b.fours || 0) * 1 + (b.sixes || 0) * 2;
        if (b.dismissalType === 'caught' && b.fielderId) {
          const fielder = ensureEntry(String(b.fielderId), 'Fielder');
          if (fielder) {
            fielder.catches += 1;
            fielder.mvpPoints += 10;
          }
        }
      }
    }

    if (st.bowlingStats) {
      for (const bw of Object.values(st.bowlingStats)) {
        const entry = ensureEntry(String(bw.playerId), bw.name);
        if (!entry) continue;
        entry.matches.add(String(inn.matchId));
        entry.wickets += bw.wickets || 0;
        entry.bowlingBalls += bw.legalBalls || 0;
        entry.runsConceded += bw.runs || 0;
        entry.mvpPoints += (bw.wickets || 0) * 25;
      }
    }
  }

  const rows = Array.from(agg.values()).map((r) => ({
    playerId: r.playerId,
    name: r.name,
    village: r.village,
    photoUrl: r.photoUrl,
    matches: r.matches.size,
    runs: r.runs,
    balls: r.balls,
    highestScore: r.highestScore,
    strikeRate: engine.calcStrikeRate(r.runs, r.balls),
    fours: r.fours,
    sixes: r.sixes,
    wickets: r.wickets,
    overs: engine.formatOvers(r.bowlingBalls, 6),
    runsConceded: r.runsConceded,
    economy: engine.calcEconomy(r.runsConceded, r.bowlingBalls, 6),
    catches: r.catches,
    mvpPoints: r.mvpPoints
  }));

  const mostRuns = rows.slice().sort((a, b) => b.runs - a.runs || b.strikeRate - a.strikeRate).slice(0, 15);
  const mostWickets = rows.slice().sort((a, b) => b.wickets - a.wickets || a.economy - b.economy).slice(0, 15);
  const highestScore = rows.slice().sort((a, b) => b.highestScore - a.highestScore || b.runs - a.runs).slice(0, 15);
  const bestStrikeRate = rows.filter((r) => r.balls >= 10).sort((a, b) => b.strikeRate - a.strikeRate).slice(0, 15);
  const bestEconomy = rows.filter((r) => r.bowlingBalls >= 6).sort((a, b) => a.economy - b.economy).slice(0, 15);
  const mostSixes = rows.slice().sort((a, b) => b.sixes - a.sixes || b.runs - a.runs).slice(0, 15);
  const mostFours = rows.slice().sort((a, b) => b.fours - a.fours || b.runs - a.runs).slice(0, 15);
  const mostCatches = rows.slice().sort((a, b) => b.catches - a.catches).slice(0, 15);
  const playerOfTournament = rows.slice().sort((a, b) => b.mvpPoints - a.mvpPoints).slice(0, 10);

  return {
    mostRuns,
    mostWickets,
    highestScore,
    bestStrikeRate,
    bestEconomy,
    mostSixes,
    mostFours,
    mostCatches,
    orangeCap: mostRuns[0] || null,
    purpleCap: mostWickets[0] || null,
    playerOfTournament: playerOfTournament[0] || null,
    mvpLeaderboard: playerOfTournament
  };
}

module.exports = {
  syncPlayersAndTeamsForMatch,
  rebuildPlayerCareerStats,
  rebuildTeamStats,
  getFilteredLeaderboards
};
