const { v4: uuidv4 } = require('uuid');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const syncService = require('../services/syncService');
const engine = require('../services/scoringEngine');
const liveSocket = require('../sockets/liveSocket');

/**
 * Syncs an offline-created or offline-scored match and its pending ball events idempotently.
 */
async function syncOfflineMatch(req, res, next) {
  try {
    const { matchId, clientMatchId, matchData, inningsNumber, events, deviceId } = req.body;
    let match = null;

    if (matchId && /^[0-9a-fA-F]{24}$/.test(String(matchId))) {
      match = await Match.findById(matchId);
    }
    if (!match && clientMatchId) {
      match = await Match.findOne({ clientMatchId });
    }

    // If match was created entirely offline, create it on the server now
    if (!match && matchData) {
      const val = engine.validateAndNormalizeRules(matchData.rules || matchData.rulesSnapshot || {});
      match = await Match.create({
        title: matchData.title || `${matchData.teamA.name} vs ${matchData.teamB.name}`,
        matchCode: 'AS-' + uuidv4().slice(0, 6).toUpperCase(),
        clientMatchId: clientMatchId || uuidv4(),
        tournamentId: matchData.tournamentId || null,
        teamA: matchData.teamA,
        teamB: matchData.teamB,
        matchDate: matchData.matchDate ? new Date(matchData.matchDate) : new Date(),
        venue: matchData.venue || 'Village Ground',
        matchType: matchData.matchType || 'friendly',
        ballType: val.rules.format.ballType,
        oversPerInnings: val.rules.format.oversPerInnings,
        playersPerTeam: val.rules.format.playersPerTeam,
        toss: matchData.toss || {},
        rulesSnapshot: val.rules,
        status: matchData.status || 'live',
        currentInningsNumber: Number(inningsNumber || 1),
        scorerId: req.user._id,
        authorizedScorers: [req.user._id],
        scorerLock: { deviceId: deviceId || 'offline', userId: req.user._id, lockedAt: new Date() }
      });

      const innSetup = matchData.inningsSetup || {
        inningsNumber: 1,
        battingTeamId: matchData.teamA.teamId,
        battingTeamName: matchData.teamA.name,
        bowlingTeamId: matchData.teamB.teamId,
        bowlingTeamName: matchData.teamB.name
      };

      await Innings.create({
        matchId: match._id,
        inningsNumber: innSetup.inningsNumber || 1,
        battingTeamId: innSetup.battingTeamId,
        battingTeamName: innSetup.battingTeamName,
        bowlingTeamId: innSetup.bowlingTeamId,
        bowlingTeamName: innSetup.bowlingTeamName,
        target: innSetup.target || null,
        openingStrikerId: innSetup.openingStrikerId || null,
        openingStrikerName: innSetup.openingStrikerName || '',
        openingNonStrikerId: innSetup.openingNonStrikerId || null,
        openingNonStrikerName: innSetup.openingNonStrikerName || '',
        openingBowlerId: innSetup.openingBowlerId || null,
        openingBowlerName: innSetup.openingBowlerName || '',
        status: 'live',
        computedState: engine.createEmptyInningsState({
          ...innSetup,
          rules: val.rules
        })
      });
    }

    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found for synchronization.' });
    }

    // Verify permission
    const uid = String(req.user._id);
    const allowed =
      req.user.role === 'super_admin' ||
      String(match.scorerId) === uid ||
      (match.authorizedScorers || []).some((id) => String(id) === uid);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'You do not have permission to sync scores for this match.' });
    }

    const result = await syncService.syncOfflineEvents({
      match,
      inningsNumber: Number(inningsNumber || match.currentInningsNumber || 1),
      events: Array.isArray(events) ? events : [],
      deviceId: deviceId || 'offline',
      userId: req.user._id
    });

    if (!result.ok) {
      return res.status(result.conflict ? 409 : 400).json({
        success: false,
        conflict: result.conflict,
        message: result.message
      });
    }

    liveSocket.emitMatchUpdate(String(match._id), {
      matchId: String(match._id),
      match,
      innings: result.innings,
      state: result.state
    });

    res.json({
      success: true,
      matchId: match._id,
      match,
      innings: result.innings,
      state: result.state,
      syncedCount: result.syncedCount,
      duplicateCount: result.duplicateCount
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { syncOfflineMatch };
