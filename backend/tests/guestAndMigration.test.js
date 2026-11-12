const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { createApp } = require('../server');
const { seedSystemPresets } = require('../utils/seedPresets');
const GuestSession = require('../models/GuestSession');
const GuestMigrationJob = require('../models/GuestMigrationJob');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Innings = require('../models/Innings');
const Delivery = require('../models/Delivery');
const ScoringRule = require('../models/ScoringRule');
const User = require('../models/User');
const migrationService = require('../services/migrationService');
const engine = require('../../js/scoring-engine');

describe('Guest Access & Guest-to-Account Migration (MongoDB + HTTP E2E)', () => {
  let mongod;
  let server;
  let baseUrl;

  before(async () => {
    const localTestUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apnascore_e2e_test';
    try {
      await mongoose.connect(localTestUri, { serverSelectionTimeoutMS: 2500 });
      await mongoose.connection.dropDatabase();
    } catch (_) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    }
    await seedSystemPresets();

    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongod) await mongod.stop();
  });

  async function api(method, path, body = null, headers = {}) {
    const opts = {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    };
    if (body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, opts);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/pdf') ? Buffer.from(await res.arrayBuffer()) : await res.json();
    return { status: res.status, data };
  }

  it('1-5. Guest creates session, teams, players, rules, scores matches, and is isolated from other guests & restricted features', async () => {
    // Guest A starts without email/password
    const g1Res = await api('POST', '/api/guest/session', { deviceId: 'dev_A' });
    assert.equal(g1Res.status, 201);
    assert.ok(g1Res.data.guestId.startsWith('gst_'));
    assert.ok(g1Res.data.guestToken);

    const g1Headers = { 'X-Guest-Id': g1Res.data.guestId, 'X-Guest-Token': g1Res.data.guestToken };

    // Token validation: guestId alone without guestToken must fail!
    const badTokenRes = await api('GET', '/api/guest/session', null, { 'X-Guest-Id': g1Res.data.guestId, 'X-Guest-Token': 'forged_token' });
    assert.equal(badTokenRes.status, 401);

    // Guest A tries to create a public tournament -> friendly 403 restriction
    const tourDenied = await api('POST', '/api/tournaments', { name: 'Public Cup', village: 'Rampur', startDate: new Date(), endDate: new Date() }, g1Headers);
    assert.equal(tourDenied.status, 401);
    assert.equal(tourDenied.data.requiresAccount, true);

    // Guest A creates two teams, players, and a custom rule preset
    const tA = await api('POST', '/api/teams', { name: 'Gaon Strikers', village: 'Rampur' }, g1Headers);
    const tB = await api('POST', '/api/teams', { name: 'River XI', village: 'Rampur' }, g1Headers);
    assert.equal(tA.status, 201);
    assert.equal(tB.status, 201);

    const p1 = await api('POST', '/api/players', { name: 'Raju', village: 'Rampur', teamId: tA.data.team._id }, g1Headers);
    const p2 = await api('POST', '/api/players', { name: 'Vikram', village: 'Rampur', teamId: tA.data.team._id }, g1Headers);
    const b1 = await api('POST', '/api/players', { name: 'Suresh', village: 'Rampur', teamId: tB.data.team._id }, g1Headers);
    assert.equal(p1.status, 201);
    assert.equal(p2.status, 201);
    assert.equal(b1.status, 201);

    const gullyRules = engine.getPresetById('gully_cricket');
    gullyRules.format.oversPerInnings = 2;
    gullyRules.localRules.oneTipOneHandCatch = true;
    const presetRes = await api('POST', '/api/settings/presets', { name: 'My Gully Rules', rules: gullyRules }, g1Headers);
    assert.equal(presetRes.status, 201);

    // Guest A tries to publish a public match -> blocked with requiresAccount: true
    const pubBlocked = await api('POST', '/api/matches', {
      title: 'Public Attempt',
      teamAId: tA.data.team._id,
      teamBId: tB.data.team._id,
      isPublic: true,
      rules: gullyRules
    }, g1Headers);
    assert.equal(pubBlocked.status, 403);
    assert.equal(pubBlocked.data.requiresAccount, true);

    // Guest A starts a private local match with custom gully rules
    const matchRes = await api('POST', '/api/matches', {
      title: 'Rampur Evening Match',
      teamAId: tA.data.team._id,
      teamBId: tB.data.team._id,
      oversPerInnings: 2,
      tossWinnerTeamId: tA.data.team._id,
      tossDecision: 'bat',
      rules: gullyRules
    }, g1Headers);
    assert.equal(matchRes.status, 201);
    const matchId = matchRes.data.match._id;
    assert.equal(matchRes.data.match.ownerType, 'guest');
    assert.equal(matchRes.data.match.isPublic, false);

    // Guest A sets openers and scores deliveries
    await api('POST', `/api/scoring/${matchId}/event`, {
      eventType: 'set_openers',
      strikerId: p1.data.player._id,
      strikerName: 'Raju',
      nonStrikerId: p2.data.player._id,
      nonStrikerName: 'Vikram',
      bowlerId: b1.data.player._id,
      bowlerName: 'Suresh'
    }, g1Headers);

    const ball1 = await api('POST', `/api/scoring/${matchId}/event`, { eventType: 'delivery', batRuns: 6 }, g1Headers);
    assert.equal(ball1.status, 201);
    assert.equal(ball1.data.state.totalRuns, 6);

    // Guest B cannot access or score Guest A's private match!
    const g2Res = await api('POST', '/api/guest/session', { deviceId: 'dev_B' });
    const g2Headers = { 'X-Guest-Id': g2Res.data.guestId, 'X-Guest-Token': g2Res.data.guestToken };

    const g2ReadMatch = await api('GET', `/api/matches/${matchId}`, null, g2Headers);
    assert.equal(g2ReadMatch.status, 403);
    const g2Score = await api('POST', `/api/scoring/${matchId}/event`, { eventType: 'delivery', batRuns: 4 }, g2Headers);
    assert.equal(g2Score.status, 403);

    // Guest A can download their own match scorecard PDF
    const pdfRes = await api('GET', `/api/scorecards/${matchId}/pdf`, null, g1Headers);
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.data.subarray(0, 5).toString('utf8'), '%PDF-');

    // Also create a second in-progress offline-synced match for Guest A via /api/sync/match
    const offlineSyncRes = await api('POST', '/api/sync/match', {
      clientMatchId: 'cm_guest_offline_1',
      deviceId: 'dev_A',
      inningsNumber: 1,
      matchData: {
        title: 'Offline Morning Gully',
        teamA: { teamId: tA.data.team._id, name: 'Gaon Strikers', squad: [{ playerId: p1.data.player._id, name: 'Raju' }] },
        teamB: { teamId: tB.data.team._id, name: 'River XI', squad: [{ playerId: b1.data.player._id, name: 'Suresh' }] },
        oversPerInnings: 4,
        rules: gullyRules,
        inningsSetup: {
          inningsNumber: 1,
          battingTeamId: tA.data.team._id,
          battingTeamName: 'Gaon Strikers',
          bowlingTeamId: tB.data.team._id,
          bowlingTeamName: 'River XI',
          openingStrikerId: p1.data.player._id,
          openingStrikerName: 'Raju',
          openingNonStrikerId: p2.data.player._id,
          openingNonStrikerName: 'Vikram',
          openingBowlerId: b1.data.player._id,
          openingBowlerName: 'Suresh'
        }
      },
      events: [
        { eventId: 'off_ev_1', sequence: 1, eventType: 'delivery', batRuns: 4 },
        { eventId: 'off_ev_2', sequence: 2, eventType: 'delivery', batRuns: 2 }
      ]
    }, g1Headers);
    assert.equal(offlineSyncRes.status, 200);
    assert.equal(offlineSyncRes.data.state.totalRuns, 6);

    // Register a new user and migrate Guest A's data (including idempotency check!)
    const regRes = await api('POST', '/api/auth/register', {
      name: 'Arjun Scorer',
      email: 'arjun@apnascore.in',
      village: 'Rampur',
      role: 'organizer',
      password: 'password123'
    });
    assert.equal(regRes.status, 201);
    const userHeaders = { Authorization: `Bearer ${regRes.data.token}` };

    const migId = 'mig_test_1';
    const migRes = await api('POST', '/api/guest/migrate', {
      guestId: g1Res.data.guestId,
      guestToken: g1Res.data.guestToken,
      deviceId: 'dev_A',
      migrationId: migId,
      localData: {}
    }, userHeaders);
    assert.equal(migRes.status, 200);
    assert.equal(migRes.data.verified, true);
    assert.equal(migRes.data.importedCounts.matches, 2);
    assert.equal(migRes.data.importedCounts.teams, 2);
    assert.equal(migRes.data.importedCounts.players, 3);
    assert.equal(migRes.data.importedCounts.customRules, 1);

    // Repeat same migrationId -> must NOT duplicate records!
    const repeatMig = await api('POST', '/api/guest/migrate', {
      guestId: g1Res.data.guestId,
      guestToken: g1Res.data.guestToken,
      deviceId: 'dev_A',
      migrationId: migId,
      localData: {}
    }, userHeaders);
    assert.equal(repeatMig.status, 200);
    assert.equal(repeatMig.data.alreadyCompleted, true);
    const matchCountAfterRepeat = await Match.countDocuments({ userId: regRes.data.user._id });
    assert.equal(matchCountAfterRepeat, 2);

    // Verify original gully rulesSnapshot preserved on migrated match
    const migratedMatch = await Match.findById(matchId);
    assert.equal(migratedMatch.ownerType, 'user');
    assert.equal(migratedMatch.rulesSnapshot.localRules.oneTipOneHandCatch, true);
    assert.equal(migratedMatch.rulesSnapshot.format.oversPerInnings, 2);
  });

  it('6-10. Mid-migration failure recovery, retry without duplicates, multi-device guest merge & existing account safety', async () => {
    // Create an existing account with its own team & player named "Gaon Strikers" & "Raju"
    const existingReg = await api('POST', '/api/auth/register', {
      name: 'Existing Organizer',
      email: 'existing@apnascore.in',
      village: 'Rampur',
      role: 'organizer',
      password: 'password123'
    });
    const exHeaders = { Authorization: `Bearer ${existingReg.data.token}` };
    const exTeam = await api('POST', '/api/teams', { name: 'Gaon Strikers', village: 'Rampur', ownerName: 'Original Owner' }, exHeaders);
    const exPlayer = await api('POST', '/api/players', { name: 'Raju', village: 'Rampur', role: 'Bowler', allowDuplicate: true }, exHeaders);
    assert.equal(exTeam.status, 201);
    assert.equal(exPlayer.status, 201);

    const targetUser = await User.findById(existingReg.data.user._id);

    // Guest Device 1 has offline IndexedDB-only data (same team/player names!)
    const localBundleDev1 = {
      players: [
        { localId: 'lp_1', name: 'Raju', village: 'Rampur', role: 'Batsman' },
        { localId: 'lp_2', name: 'Mohan', village: 'Rampur', role: 'Bowler' }
      ],
      teams: [
        { localId: 'lt_1', name: 'Gaon Strikers', village: 'Rampur', playerIds: ['lp_1'] },
        { localId: 'lt_2', name: 'Bazaar XI', village: 'Rampur', playerIds: ['lp_2'] }
      ],
      customRules: [
        { localId: 'lr_1', name: 'Dev1 5-Over', rules: engine.getPresetById('village_6_over') }
      ],
      matches: [
        {
          localId: 'cm_dev1_match',
          clientMatchId: 'cm_dev1_match',
          title: 'Dev1 Completed Match',
          teamA: { teamId: 'lt_1', name: 'Gaon Strikers', squad: [{ playerId: 'lp_1', name: 'Raju' }] },
          teamB: { teamId: 'lt_2', name: 'Bazaar XI', squad: [{ playerId: 'lp_2', name: 'Mohan' }] },
          oversPerInnings: 5,
          status: 'completed',
          result: { marginText: 'Gaon Strikers won by 10 runs' },
          rulesSnapshot: engine.getPresetById('village_6_over'),
          innings: [
            {
              inningsNumber: 1,
              battingTeamId: 'lt_1',
              battingTeamName: 'Gaon Strikers',
              bowlingTeamId: 'lt_2',
              bowlingTeamName: 'Bazaar XI',
              openingStrikerId: 'lp_1',
              openingStrikerName: 'Raju',
              openingBowlerId: 'lp_2',
              openingBowlerName: 'Mohan',
              status: 'completed'
            }
          ]
        }
      ],
      deliveries: [
        { localMatchId: 'cm_dev1_match', inningsNumber: 1, eventId: 'd1_e1', sequence: 1, eventType: 'delivery', batRuns: 6 },
        { localMatchId: 'cm_dev1_match', inningsNumber: 1, eventId: 'd1_e2', sequence: 2, eventType: 'delivery', batRuns: 4 }
      ]
    };

    const failMigId = 'mig_retry_safe_1';
    let shouldFail = true;
    await assert.rejects(
      () =>
        migrationService.migrateGuestToUser({
          targetUser,
          guestId: 'gst_dev1_offline',
          deviceId: 'dev_1',
          migrationId: failMigId,
          localData: localBundleDev1,
          onAfterStep: async (step) => {
            if (step === 'teams' && shouldFail) throw new Error('Simulated network drop mid-migration');
          }
        }),
      /Simulated network drop/
    );

    const partialJob = await GuestMigrationJob.findOne({ migrationId: failMigId });
    assert.equal(partialJob.status, 'partially_completed');
    assert.equal(partialJob.verified, false);

    // Retry the SAME migrationId cleanly -> completes without duplicating players/teams!
    shouldFail = false;
    const retryRes = await migrationService.migrateGuestToUser({
      targetUser,
      guestId: 'gst_dev1_offline',
      deviceId: 'dev_1',
      migrationId: failMigId,
      localData: localBundleDev1
    });
    assert.equal(retryRes.verified, true);
    assert.equal(retryRes.job.status, 'completed');

    // Verify existing account team "Gaon Strikers" was NEVER overwritten!
    const origTeamReloaded = await Team.findById(exTeam.data.team._id);
    assert.equal(origTeamReloaded.ownerName, 'Original Owner');

    // Verify total teams for user = 1 original + 2 migrated = 3 (zero duplicates from retry!)
    const userTeamsCount = await Team.countDocuments({ userId: targetUser._id });
    assert.equal(userTeamsCount, 3);

    // Verify Guest Device 2 (different guestId) can ALSO migrate into the same account safely
    const dev2Res = await migrationService.migrateGuestToUser({
      targetUser,
      guestId: 'gst_dev2_offline',
      deviceId: 'dev_2',
      migrationId: 'mig_dev2_1',
      localData: {
        teams: [{ localId: 'lt_dev2', name: 'Dev2 Challengers', village: 'Kishanpur' }],
        players: [],
        matches: [],
        deliveries: []
      }
    });
    assert.equal(dev2Res.verified, true);
    const userTeamsAfterDev2 = await Team.countDocuments({ userId: targetUser._id });
    assert.equal(userTeamsAfterDev2, 4);
  });

  it('11-12. Empty dashboard shows zero counts, guest creates 6-over simple match without teams/tournament, and simple matches stay isolated from tournaments', async () => {
    // 1. Unauthenticated dashboard shows 0 counts and empty arrays
    const anonDash = await api('GET', '/api/dashboard/summary');
    assert.equal(anonDash.status, 200);
    assert.equal(anonDash.data.counts.totalMatches, 0);
    assert.equal(anonDash.data.counts.liveMatches, 0);
    assert.equal(anonDash.data.counts.activeTournaments, 0);
    assert.equal(anonDash.data.liveMatches.length, 0);
    assert.equal(anonDash.data.recentMatches.length, 0);

    // 2. Fresh registered user sees empty dashboard & empty mine=1 lists (not other users' matches)
    const freshUser = await api('POST', '/api/auth/register', {
      name: 'Fresh Player',
      email: 'fresh@apnascore.in',
      village: 'Naya Gaon',
      role: 'organizer',
      password: 'password123'
    });
    assert.equal(freshUser.status, 201);
    const freshHeaders = { Authorization: `Bearer ${freshUser.data.token}` };

    const freshDash = await api('GET', '/api/dashboard/summary', null, freshHeaders);
    assert.equal(freshDash.status, 200);
    assert.equal(freshDash.data.counts.totalMatches, 0);
    assert.equal(freshDash.data.counts.totalTeams, 0);
    assert.equal(freshDash.data.recentMatches.length, 0);

    // 3. Guest starts a 6-over Simple Match with only team names (no pre-created teams/players or tournament)
    const gRes = await api('POST', '/api/guest/session', { deviceId: 'dev_simple_ux' });
    assert.equal(gRes.status, 201);
    const gHeaders = { 'X-Guest-Id': gRes.data.guestId, 'X-Guest-Token': gRes.data.guestToken };

    const simpleCreate = await api('POST', '/api/matches', {
      teamAName: 'Gully Heroes',
      teamBName: 'Mohalla Eleven',
      oversPerInnings: 6,
      playersPerTeam: 8,
      tossWinnerSide: 'A',
      tossDecision: 'bat',
      startImmediately: true
    }, gHeaders);
    assert.equal(simpleCreate.status, 201);
    const simpleMatch = simpleCreate.data.match;
    assert.equal(simpleMatch.teamA.name, 'Gully Heroes');
    assert.equal(simpleMatch.teamB.name, 'Mohalla Eleven');
    assert.equal(simpleMatch.oversPerInnings, 6);
    assert.equal(simpleMatch.tournamentId || null, null);

    // Score a delivery on the Simple Match (first set openers cleanly, matching scoring UI fallback IDs)
    const sOpeners = await api('POST', `/api/scoring/${simpleMatch._id}/event`, {
      eventType: 'set_openers',
      strikerId: 'qp_bat_1',
      strikerName: 'Aman',
      nonStrikerId: 'qp_bat_2',
      nonStrikerName: 'Bilal',
      bowlerId: 'qp_bowl_1',
      bowlerName: 'Danish'
    }, gHeaders);
    assert.equal(sOpeners.status, 201);

    const sBall = await api('POST', `/api/scoring/${simpleMatch._id}/event`, {
      eventType: 'delivery',
      batRuns: 4
    }, gHeaders);
    assert.equal(sBall.status, 201);
    assert.equal(sBall.data.state.totalRuns, 4);

    // Simple Match appears in mine=1&simpleOnly=1 and NEVER in tournamentOnly=1
    const simpleList = await api('GET', '/api/matches?mine=1&simpleOnly=1', null, gHeaders);
    assert.equal(simpleList.status, 200);
    assert.equal(simpleList.data.matches.length, 1);
    assert.equal(String(simpleList.data.matches[0]._id), String(simpleMatch._id));

    const tourOnlyForGuest = await api('GET', '/api/matches?mine=1&tournamentOnly=1', null, gHeaders);
    assert.equal(tourOnlyForGuest.status, 200);
    assert.equal(tourOnlyForGuest.data.matches.length, 0);

    // 4. Separate Tournament created by freshUser does not mix with Simple Matches
    const tourRes = await api('POST', '/api/tournaments', {
      name: 'Gramin Cup 2026',
      village: 'Naya Gaon',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      oversPerMatch: 8,
      maxTeams: 4,
      format: 'knockout'
    }, freshHeaders);
    assert.equal(tourRes.status, 201);
    const tourId = tourRes.data.tournament._id;

    const tourMatchRes = await api('POST', '/api/matches', {
      tournamentId: tourId,
      teamAName: 'Naya Gaon A',
      teamBName: 'Naya Gaon B',
      oversPerInnings: 8,
      tossWinnerSide: 'A',
      tossDecision: 'bat',
      startImmediately: true
    }, freshHeaders);
    assert.equal(tourMatchRes.status, 201);
    assert.equal(String(tourMatchRes.data.match.tournamentId), String(tourId));

    const freshSimpleList = await api('GET', '/api/matches?mine=1&simpleOnly=1', null, freshHeaders);
    assert.equal(freshSimpleList.status, 200);
    assert.equal(freshSimpleList.data.matches.length, 0);

    const freshTourMatches = await api('GET', '/api/matches?mine=1&tournamentOnly=1', null, freshHeaders);
    assert.equal(freshTourMatches.status, 200);
    assert.equal(freshTourMatches.data.matches.length, 1);

    const tourDetails = await api('GET', `/api/tournaments/${tourId}`, null, freshHeaders);
    assert.equal(tourDetails.status, 200);
    assert.equal(tourDetails.data.fixtures.length, 0); // only created match, not simple match
  });
});
