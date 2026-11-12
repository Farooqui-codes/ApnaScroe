const { v4: uuidv4 } = require('uuid');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Delivery = require('../models/Delivery');
const Team = require('../models/Team');
const Player = require('../models/Player');
const TournamentFixture = require('../models/TournamentFixture');
const Award = require('../models/Award');
const engine = require('../services/scoringEngine');
const syncService = require('../services/syncService');
const statsService = require('../services/statsService');
const tournamentService = require('../services/tournamentService');
const liveSocket = require('../sockets/liveSocket');
const { logAudit } = require('../utils/logger');

function makeMatchCode() {
  return 'AS-' + uuidv4().slice(0, 6).toUpperCase();
}

function buildMatchVisibility(req) {
  if (req.user) {
    if (req.user.role === 'super_admin') return {};
    return {
      $or: [
        { ownerType: { $ne: 'guest' }, isPublic: true },
        { userId: req.user._id },
        { scorerId: req.user._id },
        { authorizedScorers: req.user._id }
      ]
    };
  }
  if (req.guest) {
    return {
      $or: [
        { ownerType: 'guest', guestId: req.guest.guestId },
        { ownerType: { $ne: 'guest' }, isPublic: true }
      ]
    };
  }
  return { ownerType: { $ne: 'guest' }, isPublic: true };
}

async function listMatches(req, res, next) {
  try {
    const { status, tournamentId, teamId, search, mine, simpleOnly, tournamentOnly } = req.query;
    const andClauses = [buildMatchVisibility(req)];

    if (mine === '1') {
      if (req.guest) {
        andClauses.push({ ownerType: 'guest', guestId: req.guest.guestId });
      } else if (req.user) {
        andClauses.push({ $or: [{ userId: req.user._id }, { scorerId: req.user._id }, { authorizedScorers: req.user._id }] });
      } else {
        return res.json({ success: true, matches: [] });
      }
    }
    if (simpleOnly === '1') {
      andClauses.push({ tournamentId: null });
    } else if (tournamentOnly === '1') {
      andClauses.push({ tournamentId: { $ne: null } });
    }
    if (status) {
      andClauses.push({ status: status.includes(',') ? { $in: status.split(',') } : status });
    }
    if (tournamentId) andClauses.push({ tournamentId });
    if (teamId) {
      andClauses.push({ $or: [{ 'teamA.teamId': teamId }, { 'teamB.teamId': teamId }] });
    }
    if (search) {
      andClauses.push({
        $or: [
          { title: new RegExp(String(search), 'i') },
          { venue: new RegExp(String(search), 'i') },
          { 'teamA.name': new RegExp(String(search), 'i') },
          { 'teamB.name': new RegExp(String(search), 'i') }
        ]
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const filter = { $and: andClauses };

    const [total, matches] = await Promise.all([
      Match.countDocuments(filter),
      Match.find(filter)
        .sort({ matchDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);
    const matchIds = matches.map((m) => m._id);
    const innings = await Innings.find({ matchId: { $in: matchIds } })
      .select('matchId inningsNumber battingTeamName totalRuns wickets oversString status target')
      .lean();

    const innMap = {};
    for (const i of innings) {
      const k = String(i.matchId);
      if (!innMap[k]) innMap[k] = [];
      innMap[k].push(i);
    }

    const enriched = matches.map((m) => ({
      ...m,
      inningsSummary: (innMap[String(m._id)] || []).sort((a, b) => a.inningsNumber - b.inningsNumber)
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      matches: enriched,
      pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
    });
  } catch (err) {
    next(err);
  }
}

async function getMatch(req, res, next) {
  try {
    const match = await Match.findById(req.params.id).populate('tournamentId', 'name village format');
    if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

    if (match.ownerType === 'guest') {
      if (!req.guest || req.guest.guestId !== match.guestId) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to private guest match.' });
      }
    }

    const innings = await Innings.find({ matchId: match._id }).sort({ inningsNumber: 1 }).lean();
    const deliveries = await Delivery.find({ matchId: match._id, isVoided: { $ne: true } })
      .sort({ inningsNumber: 1, sequence: 1 })
      .lean();

    res.json({ success: true, match, innings, deliveries });
  } catch (err) {
    next(err);
  }
}

async function createMatch(req, res, next) {
  try {
    const {
      title,
      clientMatchId,
      tournamentId,
      fixtureId,
      teamAId,
      teamBId,
      teamAName,
      teamBName,
      teamAPlayerNames,
      teamBPlayerNames,
      teamASquad,
      teamBSquad,
      teamACaptainId,
      teamAWicketkeeperId,
      teamBCaptainId,
      teamBWicketkeeperId,
      matchDate,
      venue,
      matchType,
      ballType,
      oversPerInnings,
      playersPerTeam,
      tossWinnerTeamId,
      tossWinnerSide,
      tossDecision,
      rules,
      officials,
      startImmediately,
      isPublic
    } = req.body;

    const isGuest = Boolean(req.guest && !req.user);

    if (isGuest && (tournamentId || fixtureId || isPublic === true)) {
      return res.status(403).json({
        success: false,
        requiresAccount: true,
        message: 'Create a free account to publish your match and manage tournaments.'
      });
    }

    if ((!teamAId && !teamAName) || (!teamBId && !teamBName)) {
      return res.status(400).json({ success: false, message: 'Both Team A and Team B are required.' });
    }
    if (teamAId && teamBId && String(teamAId) === String(teamBId)) {
      return res.status(400).json({ success: false, message: 'Team A and Team B must be different teams.' });
    }
    if (!teamAId && !teamBId && String(teamAName).trim().toLowerCase() === String(teamBName).trim().toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Team A and Team B names must be different.' });
    }

    if (clientMatchId) {
      const existing = await Match.findOne({ clientMatchId });
      if (existing) {
        if (existing.ownerType === 'guest' && (!req.guest || existing.guestId !== req.guest.guestId)) {
          return res.status(403).json({ success: false, message: 'Access denied.' });
        }
        const innings = await Innings.find({ matchId: existing._id }).sort({ inningsNumber: 1 });
        return res.status(200).json({ success: true, match: existing, innings, deduplicated: true });
      }
    }

    const resolveOrCreateTeam = async (id, name, playerNames) => {
      if (id) {
        return await Team.findById(id).populate('players', 'name');
      }
      const cleanName = String(name).trim();
      const ownerQuery = isGuest
        ? { ownerType: 'guest', guestId: req.guest.guestId, name: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        : { ownerType: 'user', userId: req.user._id, name: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };

      let teamDoc = await Team.findOne(ownerQuery).populate('players', 'name');
      if (!teamDoc) {
        const short = cleanName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'TEAM';
        teamDoc = await Team.create({
          ownerType: isGuest ? 'guest' : 'user',
          guestId: isGuest ? req.guest.guestId : null,
          userId: req.user ? req.user._id : null,
          managerId: req.user ? req.user._id : null,
          name: cleanName,
          shortName: short,
          village: venue ? String(venue).trim() : 'Local Ground',
          inviteCode: isGuest ? '' : uuidv4().slice(0, 8).toUpperCase()
        });
      }

      if (Array.isArray(playerNames) && playerNames.length > 0) {
        const createdPlayers = [];
        for (const rawName of playerNames) {
          const pName = String(rawName || '').trim();
          if (!pName) continue;
          const pDoc = await Player.create({
            ownerType: isGuest ? 'guest' : 'user',
            guestId: isGuest ? req.guest.guestId : null,
            userId: req.user ? req.user._id : null,
            createdBy: req.user ? req.user._id : null,
            name: pName,
            village: teamDoc.village || 'Local Ground',
            teams: [teamDoc._id]
          });
          teamDoc.players.push(pDoc._id);
          createdPlayers.push(pDoc);
        }
        await teamDoc.save();
        return await Team.findById(teamDoc._id).populate('players', 'name');
      }
      return teamDoc;
    };

    const [teamA, teamB] = await Promise.all([
      resolveOrCreateTeam(teamAId, teamAName, teamAPlayerNames),
      resolveOrCreateTeam(teamBId, teamBName, teamBPlayerNames)
    ]);
    if (!teamA || !teamB) {
      return res.status(404).json({ success: false, message: 'Selected team(s) not found.' });
    }

    const mergedRawRules = Object.assign({}, rules || {}, {
      format: Object.assign({}, (rules && rules.format) || {}, {
        oversPerInnings: oversPerInnings || (rules && rules.format && rules.format.oversPerInnings) || 6,
        playersPerTeam: playersPerTeam || (rules && rules.format && rules.format.playersPerTeam) || 11,
        ballType: ballType || (rules && rules.format && rules.format.ballType) || 'tennis'
      })
    });

    const validation = engine.validateAndNormalizeRules(mergedRawRules);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.errors.join(' ') });
    }
    const rulesSnapshot = validation.rules;

    const buildSquad = (providedSquad, teamDoc, capId, wkId) => {
      if (Array.isArray(providedSquad) && providedSquad.length > 0) {
        return providedSquad.map((p) => ({
          playerId: p.playerId || p._id,
          name: p.name || 'Player',
          isSubstitute: Boolean(p.isSubstitute),
          isCaptain: String(p.playerId || p._id) === String(capId),
          isWicketkeeper: String(p.playerId || p._id) === String(wkId)
        }));
      }
      return (teamDoc.players || []).map((p) => ({
        playerId: p._id,
        name: p.name,
        isSubstitute: false,
        isCaptain: String(p._id) === String(capId || teamDoc.captainId),
        isWicketkeeper: String(p._id) === String(wkId || teamDoc.viceCaptainId)
      }));
    };

    const squadA = buildSquad(teamASquad, teamA, teamACaptainId, teamAWicketkeeperId);
    const squadB = buildSquad(teamBSquad, teamB, teamBCaptainId, teamBWicketkeeperId);

    let tossWinner = teamA;
    if (tossWinnerSide === 'B' || (tossWinnerTeamId && String(tossWinnerTeamId) === String(teamB._id))) {
      tossWinner = teamB;
    }
    const decision = tossDecision === 'bowl' ? 'bowl' : 'bat';
    const hasToss = Boolean(tossWinnerTeamId || tossWinnerSide);
    const battingFirst =
      (String(tossWinner._id) === String(teamA._id) && decision === 'bat') ||
      (String(tossWinner._id) === String(teamB._id) && decision === 'bowl')
        ? teamA
        : teamB;
    const bowlingFirst = String(battingFirst._id) === String(teamA._id) ? teamB : teamA;

    const matchTitle = (title && String(title).trim()) || `${teamA.name} vs ${teamB.name}`;

    const match = await Match.create({
      ownerType: isGuest ? 'guest' : 'user',
      guestId: isGuest ? req.guest.guestId : null,
      userId: req.user ? req.user._id : null,
      title: matchTitle,
      matchCode: makeMatchCode(),
      clientMatchId: clientMatchId || undefined,
      tournamentId: tournamentId || null,
      fixtureId: fixtureId || null,
      teamA: {
        teamId: teamA._id,
        name: teamA.name,
        shortName: teamA.shortName,
        logoUrl: teamA.logoUrl,
        squad: squadA,
        captainId: teamACaptainId || teamA.captainId || null,
        wicketkeeperId: teamAWicketkeeperId || null
      },
      teamB: {
        teamId: teamB._id,
        name: teamB.name,
        shortName: teamB.shortName,
        logoUrl: teamB.logoUrl,
        squad: squadB,
        captainId: teamBCaptainId || teamB.captainId || null,
        wicketkeeperId: teamBWicketkeeperId || null
      },
      matchDate: matchDate ? new Date(matchDate) : new Date(),
      venue: venue ? String(venue).trim() : teamA.village || 'Village Ground',
      matchType: matchType || (tournamentId ? 'tournament' : 'friendly'),
      ballType: rulesSnapshot.format.ballType,
      oversPerInnings: rulesSnapshot.format.oversPerInnings,
      playersPerTeam: rulesSnapshot.format.playersPerTeam,
      toss: {
        winnerTeamId: hasToss ? tossWinner._id : null,
        winnerTeamName: hasToss ? tossWinner.name : '',
        decision: hasToss ? decision : ''
      },
      rulesSnapshot,
      status: startImmediately === false ? 'upcoming' : 'live',
      currentInningsNumber: 1,
      officials: officials || {},
      scorerId: req.user ? req.user._id : null,
      authorizedScorers: req.user ? [req.user._id] : [],
      isPublic: isGuest ? false : (isPublic !== false)
    });

    const inn1State = engine.createEmptyInningsState({
      inningsNumber: 1,
      battingTeamId: battingFirst._id,
      battingTeamName: battingFirst.name,
      bowlingTeamId: bowlingFirst._id,
      bowlingTeamName: bowlingFirst.name,
      battingSquad: String(battingFirst._id) === String(teamA._id) ? squadA : squadB,
      bowlingSquad: String(bowlingFirst._id) === String(teamA._id) ? squadA : squadB,
      rules: rulesSnapshot
    });

    const innings1 = await Innings.create({
      matchId: match._id,
      inningsNumber: 1,
      battingTeamId: battingFirst._id,
      battingTeamName: battingFirst.name,
      bowlingTeamId: bowlingFirst._id,
      bowlingTeamName: bowlingFirst.name,
      status: match.status === 'upcoming' ? 'upcoming' : 'live',
      computedState: inn1State
    });

    if (fixtureId) {
      await TournamentFixture.findByIdAndUpdate(fixtureId, {
        matchId: match._id,
        status: match.status === 'live' ? 'live' : 'scheduled'
      });
    }

    await logAudit({ req, action: 'MATCH_CREATED', entityType: 'Match', entityId: match._id, details: { title: match.title, ownerType: match.ownerType } });

    res.status(201).json({
      success: true,
      match,
      innings: [innings1],
      warnings: validation.warnings
    });
  } catch (err) {
    next(err);
  }
}

async function startSecondInnings(req, res, next) {
  try {
    const match = req.match;
    const existingInn2 = await Innings.findOne({ matchId: match._id, inningsNumber: 2 });
    if (existingInn2) {
      return res.json({ success: true, match, innings: existingInn2 });
    }

    const inn1 = await Innings.findOne({ matchId: match._id, inningsNumber: 1 });
    if (!inn1) return res.status(400).json({ success: false, message: 'First innings not found.' });

    if (inn1.status !== 'completed') {
      inn1.status = 'completed';
      await inn1.save();
    }

    const target = (inn1.totalRuns || 0) + 1;
    const battingSecondId = inn1.bowlingTeamId;
    const battingSecondName = inn1.bowlingTeamName;
    const bowlingSecondId = inn1.battingTeamId;
    const bowlingSecondName = inn1.battingTeamName;

    const batSquad = String(battingSecondId) === String(match.teamA.teamId) ? match.teamA.squad : match.teamB.squad;
    const bowlSquad = String(bowlingSecondId) === String(match.teamA.teamId) ? match.teamA.squad : match.teamB.squad;

    const inn2State = engine.createEmptyInningsState({
      inningsNumber: 2,
      battingTeamId: battingSecondId,
      battingTeamName: battingSecondName,
      bowlingTeamId: bowlingSecondId,
      bowlingTeamName: bowlingSecondName,
      target,
      battingSquad: batSquad,
      bowlingSquad: bowlSquad,
      rules: match.rulesSnapshot
    });

    const innings2 = await Innings.create({
      matchId: match._id,
      inningsNumber: 2,
      battingTeamId: battingSecondId,
      battingTeamName: battingSecondName,
      bowlingTeamId: bowlingSecondId,
      bowlingTeamName: bowlingSecondName,
      target,
      status: 'live',
      computedState: inn2State
    });

    match.currentInningsNumber = 2;
    match.status = 'live';
    await match.save();
    await syncService.upsertScorecard(match);

    liveSocket.emitMatchUpdate(String(match._id), { match, activeInnings: innings2 });
    res.status(201).json({ success: true, match, innings: innings2 });
  } catch (err) {
    next(err);
  }
}

async function startSuperOver(req, res, next) {
  try {
    const parent = req.match;
    const superRules = Object.assign({}, parent.rulesSnapshot, {
      format: Object.assign({}, parent.rulesSnapshot.format, {
        oversPerInnings: 1,
        maxWickets: 2,
        unlimitedWickets: false,
        maxOversPerBowler: 1
      })
    });

    const superMatch = await Match.create({
      ownerType: parent.ownerType,
      guestId: parent.guestId,
      userId: parent.userId,
      title: `${parent.title} (Super Over)`,
      matchCode: makeMatchCode(),
      tournamentId: parent.tournamentId,
      teamA: parent.teamA,
      teamB: parent.teamB,
      matchDate: new Date(),
      venue: parent.venue,
      matchType: 'super_over',
      ballType: parent.ballType,
      oversPerInnings: 1,
      playersPerTeam: parent.playersPerTeam,
      rulesSnapshot: superRules,
      status: 'live',
      currentInningsNumber: 1,
      isSuperOver: true,
      parentMatchId: parent._id,
      scorerId: req.user ? req.user._id : null,
      authorizedScorers: parent.authorizedScorers,
      isPublic: parent.isPublic
    });

    const inn1State = engine.createEmptyInningsState({
      inningsNumber: 1,
      battingTeamId: parent.teamB.teamId,
      battingTeamName: parent.teamB.name,
      bowlingTeamId: parent.teamA.teamId,
      bowlingTeamName: parent.teamA.name,
      battingSquad: parent.teamB.squad,
      bowlingSquad: parent.teamA.squad,
      rules: superRules
    });

    const innings1 = await Innings.create({
      matchId: superMatch._id,
      inningsNumber: 1,
      battingTeamId: parent.teamB.teamId,
      battingTeamName: parent.teamB.name,
      bowlingTeamId: parent.teamA.teamId,
      bowlingTeamName: parent.teamA.name,
      status: 'live',
      computedState: inn1State
    });

    res.status(201).json({ success: true, match: superMatch, innings: [innings1] });
  } catch (err) {
    next(err);
  }
}

async function updateMatchControl(req, res, next) {
  try {
    const match = req.match;
    const { action, playerOfMatchId, playerOfMatchName, officials, teamASquad, teamBSquad, scorerUserId, deviceId } = req.body;

    if (action === 'publish') {
      if (!req.user) {
        return res.status(403).json({
          success: false,
          requiresAccount: true,
          message: 'Create a free account to publish your match and manage tournaments.'
        });
      }
      match.isPublic = true;
    } else if (action === 'pause') {
      match.status = 'paused';
    } else if (action === 'resume' || action === 'start') {
      match.status = 'live';
      await Innings.updateOne({ matchId: match._id, inningsNumber: match.currentInningsNumber }, { status: 'live' });
    } else if (action === 'abandon') {
      match.status = 'abandoned';
      match.result = Object.assign({}, match.result || {}, { marginText: 'Match Abandoned (No Result)' });
      await Innings.updateMany({ matchId: match._id }, { status: 'abandoned' });
    } else if (action === 'complete') {
      const inn1 = await Innings.findOne({ matchId: match._id, inningsNumber: 1 });
      const inn2 = await Innings.findOne({ matchId: match._id, inningsNumber: 2 });
      if (inn1 && inn2) {
        const resEval = engine.evaluateMatchResult(inn1.computedState || inn1, inn2.computedState || inn2, match.rulesSnapshot);
        if (resEval) {
          match.status = resEval.status;
          match.result = Object.assign({}, match.result || {}, resEval);
        }
      } else {
        match.status = 'completed';
      }
      if (playerOfMatchName || playerOfMatchId) {
        match.result.playerOfMatchId = playerOfMatchId || null;
        match.result.playerOfMatchName = playerOfMatchName || '';
      }
      if (playerOfMatchId) {
        await Award.create({
          awardType: 'player_of_match',
          title: 'Player of the Match',
          playerId: playerOfMatchId,
          playerName: playerOfMatchName || 'Player',
          matchId: match._id,
          tournamentId: match.tournamentId || null,
          metricText: match.result.marginText || match.title
        });
      }
      await Innings.updateMany({ matchId: match._id }, { status: 'completed' });
    } else if (action === 'update_playing_xi') {
      if (Array.isArray(teamASquad)) match.teamA.squad = teamASquad;
      if (Array.isArray(teamBSquad)) match.teamB.squad = teamBSquad;
    } else if (action === 'assign_scorer' && scorerUserId && req.user) {
      if (!match.authorizedScorers.some((id) => String(id) === String(scorerUserId))) {
        match.authorizedScorers.push(scorerUserId);
      }
    } else if (action === 'take_lock') {
      match.scorerLock = {
        deviceId: deviceId || 'web',
        userId: req.user ? req.user._id : null,
        guestId: req.guest ? req.guest.guestId : null,
        lockedAt: new Date()
      };
    }

    if (officials) {
      match.officials = Object.assign({}, match.officials || {}, officials);
    }
    if (playerOfMatchId && action !== 'complete') {
      match.result = Object.assign({}, match.result || {}, {
        playerOfMatchId,
        playerOfMatchName: playerOfMatchName || ''
      });
    }

    await match.save();
    await syncService.upsertScorecard(match);

    if (['complete', 'abandon'].includes(action)) {
      if (match.fixtureId) {
        await TournamentFixture.findByIdAndUpdate(match.fixtureId, {
          status: action === 'abandon' ? 'cancelled' : 'completed',
          winnerTeamId: (match.result && match.result.winnerTeamId) || null,
          resultText: (match.result && match.result.marginText) || ''
        });
      }
      if (match.tournamentId) {
        await tournamentService.rebuildPointsTable(match.tournamentId);
      }
      await statsService.syncPlayersAndTeamsForMatch(match._id);
    }

    liveSocket.emitMatchUpdate(String(match._id), { match });
    res.json({ success: true, match });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMatches,
  getMatch,
  createMatch,
  startSecondInnings,
  startSuperOver,
  updateMatchControl
};
