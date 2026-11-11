const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const GuestSession = require('../models/GuestSession');
const GuestMigrationJob = require('../models/GuestMigrationJob');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Delivery = require('../models/Delivery');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Scorecard = require('../models/Scorecard');
const ScoringRule = require('../models/ScoringRule');
const AuditLog = require('../models/AuditLog');
const engine = require('./scoringEngine');
const syncService = require('./syncService');

function isValidObjectId(id) {
  return Boolean(id && /^[0-9a-fA-F]{24}$/.test(String(id)));
}

/**
 * Safely migrates all server-side & local IndexedDB guest data to a registered User account.
 * Guarantees idempotency via migrationId + (sourceGuestId, clientId), preserves original
 * rulesSnapshot and match results, never overwrites existing account data, and verifies
 * persisted counts before marking migration completed.
 */
async function migrateGuestToUser({
  targetUser,
  guestId,
  deviceId,
  migrationId,
  localData = {},
  onAfterStep = null
}) {
  if (!targetUser || !targetUser._id) {
    throw new Error('Authenticated target user is required for migration.');
  }
  if (!guestId) {
    throw new Error('guestId is required for migration.');
  }

  const migId = migrationId || `mig_${Date.now()}_${uuidv4().slice(0, 8)}`;

  // 1. Idempotency check: if this migrationId already completed & verified, return cached result
  let job = await GuestMigrationJob.findOne({ migrationId: migId });
  if (job && job.status === 'completed' && job.verified) {
    return {
      success: true,
      alreadyCompleted: true,
      verified: true,
      migrationId: migId,
      importedCounts: job.importedCounts,
      job
    };
  }

  if (!job) {
    job = await GuestMigrationJob.create({
      migrationId: migId,
      guestId,
      targetUserId: targetUser._id,
      status: 'in_progress',
      startedAt: new Date(),
      idMappings: { teams: {}, players: {}, matches: {}, innings: {}, rules: {} }
    });
  } else {
    job.status = 'in_progress';
    job.errorDetails = null;
    if (!job.startedAt) job.startedAt = new Date();
    await job.save();
  }

  const sessionDoc = await GuestSession.findOne({ guestId });
  if (sessionDoc) {
    sessionDoc.migrationStatus = 'in_progress';
    await sessionDoc.save();
  }

  const idMappings = Object.assign(
    { teams: {}, players: {}, matches: {}, innings: {}, rules: {} },
    job.idMappings || {}
  );
  const counts = {
    players: 0,
    teams: 0,
    customRules: 0,
    matches: 0,
    innings: 0,
    deliveries: 0,
    scorecards: 0
  };
  const now = new Date();

  try {
    // ------------------------------------------------------------------
    // STEP 1: Migrate Players (Server guest players + Local IndexedDB players)
    // ------------------------------------------------------------------
    const serverPlayers = await Player.find({ ownerType: 'guest', guestId });
    for (const sp of serverPlayers) {
      sp.ownerType = 'user';
      sp.guestId = null;
      sp.userId = targetUser._id;
      sp.createdBy = targetUser._id;
      sp.sourceGuestId = guestId;
      sp.migratedAt = now;
      await sp.save();
      idMappings.players[String(sp._id)] = String(sp._id);
      if (sp.clientId) idMappings.players[sp.clientId] = String(sp._id);
      counts.players += 1;
    }

    const localPlayers = Array.isArray(localData.players) ? localData.players : [];
    for (const lp of localPlayers) {
      const lKey = String(lp.localId || lp._id || lp.clientId || '');
      if (!lKey) continue;
      let mappedId = idMappings.players[lKey];
      if (!mappedId) {
        const existing = await Player.findOne({
          $or: [
            { sourceGuestId: guestId, clientId: lKey },
            ...(isValidObjectId(lKey) ? [{ _id: lKey, userId: targetUser._id }] : [])
          ]
        });
        if (existing) {
          mappedId = String(existing._id);
        } else {
          const created = await Player.create({
            ownerType: 'user',
            guestId: null,
            userId: targetUser._id,
            createdBy: targetUser._id,
            clientId: lKey,
            sourceGuestId: guestId,
            migratedAt: now,
            name: lp.name || 'Player',
            village: lp.village || 'Local Ground',
            phone: lp.phone || '',
            age: lp.age || null,
            jerseyNumber: lp.jerseyNumber ?? null,
            battingStyle: lp.battingStyle || 'Right-hand bat',
            bowlingStyle: lp.bowlingStyle || 'Right-arm medium',
            role: lp.role || 'All-rounder',
            stats: lp.stats || undefined
          });
          mappedId = String(created._id);
          counts.players += 1;
        }
        idMappings.players[lKey] = mappedId;
      }
    }

    if (onAfterStep) await onAfterStep('players', { job, idMappings, counts });

    // ------------------------------------------------------------------
    // STEP 2: Migrate Teams (Server guest teams + Local IndexedDB teams)
    // ------------------------------------------------------------------
    const serverTeams = await Team.find({ ownerType: 'guest', guestId });
    for (const st of serverTeams) {
      st.ownerType = 'user';
      st.guestId = null;
      st.userId = targetUser._id;
      st.managerId = targetUser._id;
      st.sourceGuestId = guestId;
      st.migratedAt = now;
      if (!st.inviteCode) st.inviteCode = uuidv4().slice(0, 8).toUpperCase();
      await st.save();
      idMappings.teams[String(st._id)] = String(st._id);
      if (st.clientId) idMappings.teams[st.clientId] = String(st._id);
      counts.teams += 1;
    }

    const localTeams = Array.isArray(localData.teams) ? localData.teams : [];
    for (const lt of localTeams) {
      const lKey = String(lt.localId || lt._id || lt.clientId || '');
      if (!lKey) continue;
      let mappedId = idMappings.teams[lKey];
      if (!mappedId) {
        const existing = await Team.findOne({
          $or: [
            { sourceGuestId: guestId, clientId: lKey },
            ...(isValidObjectId(lKey) ? [{ _id: lKey, userId: targetUser._id }] : [])
          ]
        });
        if (existing) {
          mappedId = String(existing._id);
        } else {
          const mappedPlayers = (lt.playerIds || lt.players || [])
            .map((pid) => idMappings.players[String(pid)] || (isValidObjectId(pid) ? String(pid) : null))
            .filter(Boolean);

          const capId = lt.captainId ? (idMappings.players[String(lt.captainId)] || (isValidObjectId(lt.captainId) ? lt.captainId : null)) : null;
          const wkId = lt.viceCaptainId ? (idMappings.players[String(lt.viceCaptainId)] || (isValidObjectId(lt.viceCaptainId) ? lt.viceCaptainId : null)) : null;

          const created = await Team.create({
            ownerType: 'user',
            guestId: null,
            userId: targetUser._id,
            managerId: targetUser._id,
            clientId: lKey,
            sourceGuestId: guestId,
            migratedAt: now,
            name: lt.name || 'Team',
            shortName: lt.shortName || String(lt.name || 'TM').slice(0, 4).toUpperCase(),
            village: lt.village || 'Local Ground',
            ownerName: lt.ownerName || '',
            players: mappedPlayers,
            captainId: capId,
            viceCaptainId: wkId,
            inviteCode: uuidv4().slice(0, 8).toUpperCase()
          });
          mappedId = String(created._id);
          counts.teams += 1;
        }
        idMappings.teams[lKey] = mappedId;
      }
    }

    if (onAfterStep) await onAfterStep('teams', { job, idMappings, counts });

    // ------------------------------------------------------------------
    // STEP 3: Migrate Custom Scoring Rule Presets
    // ------------------------------------------------------------------
    const serverRules = await ScoringRule.find({ ownerType: 'guest', guestId });
    for (const sr of serverRules) {
      sr.ownerType = 'user';
      sr.guestId = null;
      sr.userId = targetUser._id;
      sr.createdBy = targetUser._id;
      sr.sourceGuestId = guestId;
      sr.migratedAt = now;
      await sr.save();
      idMappings.rules[String(sr._id)] = String(sr._id);
      counts.customRules += 1;
    }

    const localRules = Array.isArray(localData.customRules) ? localData.customRules : [];
    for (const lr of localRules) {
      const lKey = String(lr.localId || lr._id || lr.clientId || '');
      if (!lKey) continue;
      if (!idMappings.rules[lKey]) {
        const existing = await ScoringRule.findOne({ sourceGuestId: guestId, clientId: lKey });
        if (existing) {
          idMappings.rules[lKey] = String(existing._id);
        } else {
          const val = engine.validateAndNormalizeRules(lr.rules || {});
          const created = await ScoringRule.create({
            ownerType: 'user',
            guestId: null,
            userId: targetUser._id,
            createdBy: targetUser._id,
            clientId: lKey,
            sourceGuestId: guestId,
            migratedAt: now,
            name: lr.name || 'Custom Preset',
            presetId: lr.presetId || ('mig_' + Date.now()),
            description: lr.description || 'Migrated from guest session',
            isSystemPreset: false,
            rules: val.rules
          });
          idMappings.rules[lKey] = String(created._id);
          counts.customRules += 1;
        }
      }
    }

    if (onAfterStep) await onAfterStep('rules', { job, idMappings, counts });

    // ------------------------------------------------------------------
    // STEP 4: Migrate Matches, Innings, Deliveries & Scorecards
    // ------------------------------------------------------------------
    const serverMatches = await Match.find({ ownerType: 'guest', guestId });
    for (const sm of serverMatches) {
      sm.ownerType = 'user';
      sm.guestId = null;
      sm.userId = targetUser._id;
      sm.scorerId = targetUser._id;
      if (!sm.authorizedScorers.some((id) => String(id) === String(targetUser._id))) {
        sm.authorizedScorers.push(targetUser._id);
      }
      sm.sourceGuestId = guestId;
      sm.migratedAt = now;
      await sm.save();

      await Scorecard.updateMany(
        { matchId: sm._id },
        { ownerType: 'user', guestId: null, userId: targetUser._id, sourceGuestId: guestId, migratedAt: now }
      );

      idMappings.matches[String(sm._id)] = String(sm._id);
      if (sm.clientMatchId) idMappings.matches[sm.clientMatchId] = String(sm._id);
      counts.matches += 1;
      counts.innings += await Innings.countDocuments({ matchId: sm._id });
      counts.deliveries += await Delivery.countDocuments({ matchId: sm._id, isVoided: { $ne: true } });
      counts.scorecards += await Scorecard.countDocuments({ matchId: sm._id });
    }

    const localMatches = Array.isArray(localData.matches) ? localData.matches : [];
    const localDeliveries = Array.isArray(localData.deliveries) ? localData.deliveries : [];

    const resolveTeamObjectId = async (teamRef, fallbackName) => {
      const refStr = teamRef ? String(teamRef) : '';
      if (idMappings.teams[refStr] && isValidObjectId(idMappings.teams[refStr])) {
        return new mongoose.Types.ObjectId(idMappings.teams[refStr]);
      }
      if (isValidObjectId(refStr)) {
        const exists = await Team.exists({ _id: refStr });
        if (exists) return new mongoose.Types.ObjectId(refStr);
      }
      // Auto-create placeholder team for guest quick matches that didn't create a full Team record
      const autoKey = `auto_team_${refStr || fallbackName}`;
      if (idMappings.teams[autoKey]) return new mongoose.Types.ObjectId(idMappings.teams[autoKey]);
      const created = await Team.create({
        ownerType: 'user',
        userId: targetUser._id,
        managerId: targetUser._id,
        clientId: autoKey,
        sourceGuestId: guestId,
        migratedAt: now,
        name: fallbackName || 'Local Team',
        shortName: String(fallbackName || 'LT').slice(0, 4).toUpperCase(),
        village: 'Local Ground',
        inviteCode: uuidv4().slice(0, 8).toUpperCase()
      });
      idMappings.teams[autoKey] = String(created._id);
      if (refStr) idMappings.teams[refStr] = String(created._id);
      counts.teams += 1;
      return created._id;
    };

    const resolveSquad = (squadArr) =>
      (squadArr || []).map((p) => {
        const rawPid = String(p.playerId || p._id || '');
        const mapped = idMappings.players[rawPid];
        const finalId = isValidObjectId(mapped)
          ? new mongoose.Types.ObjectId(mapped)
          : (isValidObjectId(rawPid) ? new mongoose.Types.ObjectId(rawPid) : new mongoose.Types.ObjectId());
        return {
          playerId: finalId,
          name: p.name || 'Player',
          isSubstitute: Boolean(p.isSubstitute),
          isCaptain: Boolean(p.isCaptain),
          isWicketkeeper: Boolean(p.isWicketkeeper)
        };
      });

    for (const lmBundle of localMatches) {
      const lm = lmBundle.match || lmBundle;
      const clientMatchKey = String(lm.clientMatchId || lmBundle.clientMatchId || lmBundle.localId || lm._id || '');
      if (!clientMatchKey) continue;

      let matchDoc = null;
      const existingByKey = await Match.findOne({
        $or: [
          { clientMatchId: clientMatchKey },
          ...(isValidObjectId(lm._id) ? [{ _id: lm._id }] : [])
        ]
      });

      if (existingByKey) {
        if (existingByKey.ownerType === 'guest' && existingByKey.guestId === guestId) {
          existingByKey.ownerType = 'user';
          existingByKey.guestId = null;
          existingByKey.userId = targetUser._id;
          existingByKey.scorerId = targetUser._id;
          existingByKey.sourceGuestId = guestId;
          existingByKey.migratedAt = now;
          await existingByKey.save();
        }
        matchDoc = existingByKey;
      } else {
        const teamAObjId = await resolveTeamObjectId(lm.teamA && lm.teamA.teamId, lm.teamA && lm.teamA.name);
        const teamBObjId = await resolveTeamObjectId(lm.teamB && lm.teamB.teamId, lm.teamB && lm.teamB.name);

        // Preserve exact rulesSnapshot without recalculating against new user defaults
        const snapshot = lm.rulesSnapshot || engine.getDefaultRules();

        matchDoc = await Match.create({
          ownerType: 'user',
          guestId: null,
          userId: targetUser._id,
          scorerId: targetUser._id,
          authorizedScorers: [targetUser._id],
          sourceGuestId: guestId,
          migratedAt: now,
          title: lm.title || 'Migrated Match',
          matchCode: lm.matchCode || ('AS-' + uuidv4().slice(0, 6).toUpperCase()),
          clientMatchId: clientMatchKey,
          teamA: {
            teamId: teamAObjId,
            name: (lm.teamA && lm.teamA.name) || 'Team A',
            shortName: (lm.teamA && lm.teamA.shortName) || '',
            logoUrl: (lm.teamA && lm.teamA.logoUrl) || '',
            squad: resolveSquad(lm.teamA && lm.teamA.squad)
          },
          teamB: {
            teamId: teamBObjId,
            name: (lm.teamB && lm.teamB.name) || 'Team B',
            shortName: (lm.teamB && lm.teamB.shortName) || '',
            logoUrl: (lm.teamB && lm.teamB.logoUrl) || '',
            squad: resolveSquad(lm.teamB && lm.teamB.squad)
          },
          matchDate: lm.matchDate ? new Date(lm.matchDate) : (lm.createdAt ? new Date(lm.createdAt) : now),
          venue: lm.venue || 'Village Ground',
          matchType: lm.matchType || 'friendly',
          ballType: lm.ballType || (snapshot.format && snapshot.format.ballType) || 'tennis',
          oversPerInnings: lm.oversPerInnings || (snapshot.format && snapshot.format.oversPerInnings) || 6,
          playersPerTeam: lm.playersPerTeam || (snapshot.format && snapshot.format.playersPerTeam) || 11,
          toss: lm.toss || {},
          rulesSnapshot: snapshot,
          status: lm.status || 'live',
          currentInningsNumber: lm.currentInningsNumber || 1,
          result: lm.result || {},
          officials: lm.officials || {},
          isPublic: false
        });
        counts.matches += 1;
      }

      idMappings.matches[clientMatchKey] = String(matchDoc._id);
      if (lmBundle.localId) idMappings.matches[String(lmBundle.localId)] = String(matchDoc._id);

      // Migrate innings for this local match
      const bundleInnings = Array.isArray(lmBundle.innings) ? lmBundle.innings : [];
      for (const li of bundleInnings) {
        const innNum = Number(li.inningsNumber || 1);
        let innDoc = await Innings.findOne({ matchId: matchDoc._id, inningsNumber: innNum });
        if (!innDoc) {
          const batTeamId = String(li.battingTeamId) === String(lm.teamA && lm.teamA.teamId)
            ? matchDoc.teamA.teamId
            : matchDoc.teamB.teamId;
          const bowlTeamId = String(batTeamId) === String(matchDoc.teamA.teamId)
            ? matchDoc.teamB.teamId
            : matchDoc.teamA.teamId;

          innDoc = await Innings.create({
            matchId: matchDoc._id,
            inningsNumber: innNum,
            battingTeamId: batTeamId,
            battingTeamName: li.battingTeamName || 'Batting Team',
            bowlingTeamId: bowlTeamId,
            bowlingTeamName: li.bowlingTeamName || 'Bowling Team',
            target: li.target || null,
            openingStrikerId: li.openingStrikerId || null,
            openingStrikerName: li.openingStrikerName || '',
            openingNonStrikerId: li.openingNonStrikerId || null,
            openingNonStrikerName: li.openingNonStrikerName || '',
            openingBowlerId: li.openingBowlerId || null,
            openingBowlerName: li.openingBowlerName || '',
            status: li.status || 'live',
            totalRuns: li.totalRuns || 0,
            wickets: li.wickets || 0,
            legalBalls: li.legalBalls || 0,
            oversString: li.oversString || '0.0',
            extrasBreakdown: li.extrasBreakdown || undefined,
            computedState: li.computedState || null
          });
          counts.innings += 1;
        }
        idMappings.innings[`${clientMatchKey}_${innNum}`] = String(innDoc._id);

        // Migrate deliveries belonging to this match & innings
        const matchEvents = localDeliveries.filter(
          (ev) =>
            (String(ev.localMatchId) === String(lmBundle.localId) ||
              String(ev.localMatchId) === clientMatchKey) &&
            Number(ev.inningsNumber || 1) === innNum
        );

        for (const ev of matchEvents) {
          if (!ev.eventId) continue;
          const dup = await Delivery.findOne({ matchId: matchDoc._id, eventId: ev.eventId });
          if (dup) continue;
          await Delivery.create({
            matchId: matchDoc._id,
            inningsId: innDoc._id,
            inningsNumber: innNum,
            eventId: ev.eventId,
            sequence: Number(ev.sequence || 1),
            eventType: ev.eventType || 'delivery',
            extraType: ev.extraType || 'none',
            batRuns: Number(ev.batRuns || 0),
            additionalExtraRuns: Number(ev.additionalExtraRuns || 0),
            overthrowRuns: Number(ev.overthrowRuns || 0),
            deltaRuns: Number(ev.deltaRuns || 0),
            isFour: Boolean(ev.isFour),
            isSix: Boolean(ev.isSix),
            notBoundary: Boolean(ev.notBoundary),
            overthrowBoundary: Boolean(ev.overthrowBoundary),
            isWicket: Boolean(ev.isWicket),
            wicketType: ev.wicketType || null,
            oneTipCatch: Boolean(ev.oneTipCatch),
            dismissedSlot: ev.dismissedSlot || null,
            dismissedPlayerId: ev.dismissedPlayerId || null,
            dismissedPlayerName: ev.dismissedPlayerName || '',
            fielderId: ev.fielderId || null,
            fielderName: ev.fielderName || '',
            strikerId: ev.strikerId || null,
            strikerName: ev.strikerName || '',
            nonStrikerId: ev.nonStrikerId || null,
            nonStrikerName: ev.nonStrikerName || '',
            bowlerId: ev.bowlerId || null,
            bowlerName: ev.bowlerName || '',
            playerId: ev.playerId || null,
            playerName: ev.playerName || '',
            replacementPlayerId: ev.replacementPlayerId || null,
            replacementPlayerName: ev.replacementPlayerName || '',
            slot: ev.slot || null,
            reason: ev.reason || '',
            commentary: ev.commentary || '',
            isVoided: Boolean(ev.isVoided),
            editedAt: ev.editedAt ? new Date(ev.editedAt) : null,
            clientTimestamp: ev.clientTimestamp ? new Date(ev.clientTimestamp) : now,
            deviceId: ev.deviceId || deviceId || ''
          });
          counts.deliveries += 1;
        }

        // Recompute innings computedState using the match's ORIGINAL rulesSnapshot
        if (matchEvents.length > 0) {
          const allEvs = await Delivery.find({ matchId: matchDoc._id, inningsNumber: innNum, isVoided: { $ne: true } })
            .sort({ sequence: 1 })
            .lean();
          const st = engine.replayInnings(
            {
              inningsNumber: innNum,
              battingTeamId: innDoc.battingTeamId,
              battingTeamName: innDoc.battingTeamName,
              bowlingTeamId: innDoc.bowlingTeamId,
              bowlingTeamName: innDoc.bowlingTeamName,
              target: innDoc.target,
              openingStrikerId: innDoc.openingStrikerId,
              openingStrikerName: innDoc.openingStrikerName,
              openingNonStrikerId: innDoc.openingNonStrikerId,
              openingNonStrikerName: innDoc.openingNonStrikerName,
              openingBowlerId: innDoc.openingBowlerId,
              openingBowlerName: innDoc.openingBowlerName,
              battingSquad: matchDoc.teamA.squad,
              bowlingSquad: matchDoc.teamB.squad,
              rules: matchDoc.rulesSnapshot
            },
            allEvs
          );
          innDoc.totalRuns = st.totalRuns;
          innDoc.wickets = st.wickets;
          innDoc.legalBalls = st.legalBalls;
          innDoc.oversString = st.oversString;
          innDoc.extrasBreakdown = st.extrasBreakdown;
          innDoc.computedState = st;
          innDoc.lastSequence = allEvs.length ? allEvs[allEvs.length - 1].sequence : 0;
          await innDoc.save();
        }
      }

      await syncService.upsertScorecard(matchDoc);
      counts.scorecards += 1;
    }

    if (onAfterStep) await onAfterStep('matches', { job, idMappings, counts });

    // ------------------------------------------------------------------
    // STEP 5: Server-side Verification before Marking Completed
    // ------------------------------------------------------------------
    const verifiedMatchesCount = await Match.countDocuments({ userId: targetUser._id, sourceGuestId: guestId });
    if (localMatches.length > 0 && verifiedMatchesCount < Math.min(localMatches.length, 1)) {
      throw new Error('Migration verification failed: migrated matches missing from database.');
    }

    job.status = 'completed';
    job.verified = true;
    job.importedCounts = counts;
    job.idMappings = idMappings;
    job.completedAt = new Date();
    job.markModified('idMappings');
    await job.save();

    if (sessionDoc) {
      sessionDoc.status = 'migrated';
      sessionDoc.migrationStatus = 'completed';
      sessionDoc.linkedUserId = targetUser._id;
      await sessionDoc.save();
    }

    await AuditLog.create({
      actorId: targetUser._id,
      actorRole: targetUser.role,
      action: 'GUEST_MIGRATION_COMPLETED',
      entityType: 'GuestMigrationJob',
      entityId: String(job._id),
      details: { migrationId: migId, guestId, counts }
    });

    return {
      success: true,
      alreadyCompleted: false,
      verified: true,
      migrationId: migId,
      importedCounts: counts,
      job
    };
  } catch (err) {
    const anyMoved = counts.players + counts.teams + counts.matches + counts.customRules > 0;
    job.status = anyMoved ? 'partially_completed' : 'failed';
    job.verified = false;
    job.errorDetails = err.message;
    job.idMappings = idMappings;
    job.importedCounts = counts;
    job.markModified('idMappings');
    await job.save();

    if (sessionDoc) {
      sessionDoc.migrationStatus = job.status;
      await sessionDoc.save();
    }

    await AuditLog.create({
      actorId: targetUser._id,
      actorRole: targetUser.role,
      action: 'GUEST_MIGRATION_FAILED',
      entityType: 'GuestMigrationJob',
      entityId: String(job._id),
      details: { migrationId: migId, guestId, error: err.message, status: job.status }
    });

    const wrapped = new Error(`Guest migration failed safely: ${err.message}`);
    wrapped.migrationId = migId;
    wrapped.migrationStatus = job.status;
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

module.exports = {
  migrateGuestToUser
};
