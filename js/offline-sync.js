/**
 * ApnaScore Offline Scoring, Guest Data Persistence & IndexedDB Sync Engine (v2)
 * Stores guest profile, deviceId, teams, players, matches, deliveries, custom rules,
 * scorecards, and pending sync/migration operations locally in IndexedDB.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'apnascore_offline_db';
  const DB_VERSION = 2;

  const STORE_GUEST = 'guest_profile';
  const STORE_TEAMS = 'local_teams';
  const STORE_PLAYERS = 'local_players';
  const STORE_RULES = 'local_rules';
  const STORE_SCORECARDS = 'local_scorecards';
  const STORE_MATCHES = 'offline_matches';
  const STORE_EVENTS = 'offline_events';
  const DEVICE_KEY = 'apnascore_device_id';

  let dbPromise = null;
  let isSyncing = false;
  let lastSyncError = '';
  let lastSyncedAt = null;

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_GUEST)) {
          db.createObjectStore(STORE_GUEST, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TEAMS)) {
          db.createObjectStore(STORE_TEAMS, { keyPath: 'localId' });
        }
        if (!db.objectStoreNames.contains(STORE_PLAYERS)) {
          db.createObjectStore(STORE_PLAYERS, { keyPath: 'localId' });
        }
        if (!db.objectStoreNames.contains(STORE_RULES)) {
          db.createObjectStore(STORE_RULES, { keyPath: 'localId' });
        }
        if (!db.objectStoreNames.contains(STORE_SCORECARDS)) {
          db.createObjectStore(STORE_SCORECARDS, { keyPath: 'localId' });
        }
        if (!db.objectStoreNames.contains(STORE_MATCHES)) {
          const mStore = db.createObjectStore(STORE_MATCHES, { keyPath: 'localId' });
          mStore.createIndex('serverMatchId', 'serverMatchId', { unique: false });
          mStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const eStore = db.createObjectStore(STORE_EVENTS, { keyPath: 'eventId' });
          eStore.createIndex('localMatchId', 'localMatchId', { unique: false });
          eStore.createIndex('synced', 'synced', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function txPromise(storeName, mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          const res = fn(store);
          tx.oncomplete = () => resolve(res && res.result !== undefined ? res.result : res);
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function getAllFromStore(storeName) {
    return openDB().then(
      (db) =>
        new Promise((resolve) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        })
    );
  }

  // ---- Guest Profile Persistence ----
  async function saveGuestProfile(profile) {
    const record = Object.assign({ id: 'current', deviceId: getDeviceId(), updatedAt: new Date().toISOString() }, profile);
    await txPromise(STORE_GUEST, 'readwrite', (store) => store.put(record));
    if (record.guestId && record.guestToken) {
      root.ApnaAPI.setGuestSession({
        guestId: record.guestId,
        guestToken: record.guestToken,
        deviceId: record.deviceId,
        expiresAt: record.expiresAt,
        migrationStatus: record.migrationStatus || 'pending'
      });
    }
    notifyListeners();
    return record;
  }

  async function getGuestProfile() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_GUEST, 'readonly');
      const req = tx.objectStore(STORE_GUEST).get('current');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  // ---- Local Entities (Teams, Players, Rules, Scorecards) ----
  async function saveTeamLocally(team) {
    const localId = String(team.localId || team._id || team.clientId || ('lteam_' + Date.now()));
    const rec = Object.assign({}, team, { localId, updatedAt: new Date().toISOString() });
    await txPromise(STORE_TEAMS, 'readwrite', (store) => store.put(rec));
    return rec;
  }
  const getLocalTeams = () => getAllFromStore(STORE_TEAMS);

  async function savePlayerLocally(player) {
    const localId = String(player.localId || player._id || player.clientId || ('lplayer_' + Date.now()));
    const rec = Object.assign({}, player, { localId, updatedAt: new Date().toISOString() });
    await txPromise(STORE_PLAYERS, 'readwrite', (store) => store.put(rec));
    return rec;
  }
  const getLocalPlayers = () => getAllFromStore(STORE_PLAYERS);

  async function saveRuleLocally(rule) {
    const localId = String(rule.localId || rule._id || rule.clientId || ('lrule_' + Date.now()));
    const rec = Object.assign({}, rule, { localId, updatedAt: new Date().toISOString() });
    await txPromise(STORE_RULES, 'readwrite', (store) => store.put(rec));
    return rec;
  }
  const getLocalRules = () => getAllFromStore(STORE_RULES);

  async function saveScorecardLocally(scorecard) {
    const localId = String(scorecard.localId || scorecard.matchId || ('lsc_' + Date.now()));
    const rec = Object.assign({}, scorecard, { localId, updatedAt: new Date().toISOString() });
    await txPromise(STORE_SCORECARDS, 'readwrite', (store) => store.put(rec));
    return rec;
  }
  const getLocalScorecards = () => getAllFromStore(STORE_SCORECARDS);

  // ---- Matches & Events ----
  async function saveMatchLocally(matchBundle) {
    const localId = matchBundle.localId || matchBundle.match._id || matchBundle.match.clientMatchId;
    const record = {
      localId: String(localId),
      serverMatchId: matchBundle.match._id && !String(matchBundle.match._id).startsWith('local_') && !String(matchBundle.match._id).startsWith('cm_')
        ? String(matchBundle.match._id)
        : null,
      clientMatchId: matchBundle.match.clientMatchId || String(localId),
      ownerType: matchBundle.match.ownerType || (root.ApnaAPI.getToken() ? 'user' : 'guest'),
      guestId: matchBundle.match.guestId || (root.ApnaAPI.getGuestSession() && root.ApnaAPI.getGuestSession().guestId) || null,
      match: matchBundle.match,
      innings: matchBundle.innings || [],
      syncStatus: matchBundle.syncStatus || 'synced',
      updatedAt: new Date().toISOString()
    };
    await txPromise(STORE_MATCHES, 'readwrite', (store) => store.put(record));
    notifyListeners();
    return record;
  }

  async function getLocalMatch(localOrServerId) {
    const id = String(localOrServerId);
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_MATCHES, 'readonly');
      const store = tx.objectStore(STORE_MATCHES);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) return resolve(req.result);
        const idx = store.index('serverMatchId');
        const idxReq = idx.get(id);
        idxReq.onsuccess = () => resolve(idxReq.result || null);
        idxReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }

  const getAllLocalMatches = () => getAllFromStore(STORE_MATCHES);

  async function saveEventLocally(localMatchId, inningsNumber, eventObj) {
    const ev = Object.assign({}, eventObj, {
      eventId: eventObj.eventId || ('ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      localMatchId: String(localMatchId),
      inningsNumber: Number(inningsNumber || 1),
      synced: Boolean(eventObj.synced),
      deviceId: getDeviceId(),
      clientTimestamp: eventObj.clientTimestamp || new Date().toISOString()
    });
    await txPromise(STORE_EVENTS, 'readwrite', (store) => store.put(ev));
    notifyListeners();
    return ev;
  }

  async function getEventsForMatch(localMatchId, inningsNumber) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_EVENTS, 'readonly');
      const idx = tx.objectStore(STORE_EVENTS).index('localMatchId');
      const req = idx.getAll(String(localMatchId));
      req.onsuccess = () => {
        const list = (req.result || []).filter((e) =>
          inningsNumber ? Number(e.inningsNumber) === Number(inningsNumber) : true
        );
        list.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  async function getPendingEventsCount() {
    const list = await getAllFromStore(STORE_EVENTS);
    return list.filter((e) => !e.synced).length;
  }

  // ---- Guest Migration Bundle & Cleanup ----
  async function getGuestMigrationBundle() {
    const [guestProfile, teams, players, matches, deliveries, customRules, scorecards] = await Promise.all([
      getGuestProfile(),
      getLocalTeams(),
      getLocalPlayers(),
      getAllLocalMatches(),
      getAllFromStore(STORE_EVENTS),
      getLocalRules(),
      getLocalScorecards()
    ]);

    const guestMatches = matches.filter((m) => !m.migrated);
    const guestTeams = teams.filter((t) => !t.migrated);
    const guestPlayers = players.filter((p) => !p.migrated);
    const guestRules = customRules.filter((r) => !r.migrated);

    return {
      guestProfile,
      counts: {
        matches: guestMatches.length,
        teams: guestTeams.length,
        players: guestPlayers.length,
        customRules: guestRules.length
      },
      localData: {
        teams: guestTeams,
        players: guestPlayers,
        matches: guestMatches,
        deliveries,
        customRules: guestRules,
        scorecards
      }
    };
  }

  /**
   * Called ONLY after server-side migration verification succeeds.
   * Marks guest profile migrated and clears local guest-only pending records safely.
   */
  async function markGuestMigrated(migrationResult) {
    const gp = await getGuestProfile();
    if (gp) {
      gp.migrationStatus = 'completed';
      gp.pendingMigration = false;
      gp.lastMigrationId = migrationResult.migrationId;
      gp.migratedAt = new Date().toISOString();
      await txPromise(STORE_GUEST, 'readwrite', (s) => s.put(gp));
    }
    root.ApnaAPI.clearGuestSession();

    // Archive/mark migrated entities instead of leaving stale un-migrated flags
    for (const storeName of [STORE_TEAMS, STORE_PLAYERS, STORE_RULES, STORE_MATCHES]) {
      const items = await getAllFromStore(storeName);
      for (const item of items) {
        item.migrated = true;
        if (storeName === STORE_MATCHES) item.syncStatus = 'synced';
        await txPromise(storeName, 'readwrite', (s) => s.put(item));
      }
    }
    const events = await getAllFromStore(STORE_EVENTS);
    for (const ev of events) {
      ev.synced = true;
      await txPromise(STORE_EVENTS, 'readwrite', (s) => s.put(ev));
    }
    notifyListeners();
  }

  // ---- Offline Sync (Supports Registered Users & Verified Guests) ----
  async function syncAllPending() {
    const hasAuth = Boolean(root.ApnaAPI.getToken() || (root.ApnaAPI.getGuestSession() && root.ApnaAPI.getGuestSession().guestToken));
    if (isSyncing || !navigator.onLine || !hasAuth) {
      notifyListeners();
      return { synced: 0, skipped: true };
    }

    isSyncing = true;
    lastSyncError = '';
    notifyListeners();

    let totalSynced = 0;
    try {
      // Ensure offline-created guest profile gets registered on backend when internet returns
      const gp = await getGuestProfile();
      if (gp && gp.needsServerSession && !root.ApnaAPI.getToken()) {
        try {
          const sRes = await root.ApnaAPI.post('/api/guest/session', { deviceId: gp.deviceId, guestId: gp.guestId });
          await saveGuestProfile({
            ...gp,
            guestId: sRes.guestId,
            guestToken: sRes.guestToken,
            expiresAt: sRes.expiresAt,
            needsServerSession: false
          });
        } catch (_) {}
      }

      // If user registered offline and queued migration, trigger migration automatically if callback attached
      if (gp && gp.pendingMigration && gp.migrationStatus !== 'completed' && root.ApnaAPI.getToken() && root.ApnaMigrate) {
        await root.ApnaMigrate.runQueuedOfflineMigration();
      }

      const allMatches = await getAllLocalMatches();
      const allEvents = await getAllFromStore(STORE_EVENTS);

      const pendingEvents = allEvents.filter((e) => !e.synced);
      const pendingMatchIds = new Set(pendingEvents.map((e) => e.localMatchId));
      for (const m of allMatches) {
        if (m.syncStatus === 'pending' || m.syncStatus === 'failed') {
          pendingMatchIds.add(m.localId);
        }
      }

      for (const localId of pendingMatchIds) {
        const matchRec = allMatches.find((m) => m.localId === localId);
        if (!matchRec) continue;

        const matchEvents = pendingEvents.filter((e) => e.localMatchId === localId);
        const inningsNums = Array.from(new Set(matchEvents.map((e) => Number(e.inningsNumber || 1))));
        if (inningsNums.length === 0) inningsNums.push(matchRec.match.currentInningsNumber || 1);

        for (const innNum of inningsNums) {
          const innEvents = matchEvents.filter((e) => Number(e.inningsNumber || 1) === innNum);
          const innObj = (matchRec.innings || []).find((i) => Number(i.inningsNumber) === innNum);
          try {
            const payload = {
              matchId: matchRec.serverMatchId,
              clientMatchId: matchRec.clientMatchId,
              inningsNumber: innNum,
              events: innEvents,
              deviceId: getDeviceId(),
              matchData: !matchRec.serverMatchId
                ? {
                    ...matchRec.match,
                    inningsSetup: innObj || null
                  }
                : undefined
            };

            const res = await root.ApnaAPI.post('/api/sync/match', payload);
            if (res && res.success) {
              for (const ev of innEvents) {
                ev.synced = true;
                await txPromise(STORE_EVENTS, 'readwrite', (store) => store.put(ev));
              }
              matchRec.serverMatchId = String(res.matchId);
              matchRec.match = res.match;
              matchRec.syncStatus = 'synced';
              await txPromise(STORE_MATCHES, 'readwrite', (store) => store.put(matchRec));
              totalSynced += res.syncedCount || innEvents.length;
            }
          } catch (err) {
            lastSyncError = err.message || 'Sync error';
            matchRec.syncStatus = err.status === 409 ? 'conflict' : 'failed';
            await txPromise(STORE_MATCHES, 'readwrite', (store) => store.put(matchRec));
          }
        }
      }
      lastSyncedAt = new Date().toISOString();
    } finally {
      isSyncing = false;
      notifyListeners();
    }

    return { synced: totalSynced, error: lastSyncError };
  }

  async function getStatus() {
    const pendingCount = await getPendingEventsCount();
    const online = navigator.onLine;
    let state = 'online';
    if (!online) state = 'offline';
    else if (isSyncing) state = 'syncing';
    else if (lastSyncError) state = 'failed';
    else if (pendingCount === 0 && lastSyncedAt) state = 'synced';
    return { online, isSyncing, pendingCount, lastSyncError, lastSyncedAt, state };
  }

  const listeners = new Set();
  function onStatusChange(fn) {
    listeners.add(fn);
    getStatus().then(fn);
    return () => listeners.delete(fn);
  }

  function notifyListeners() {
    getStatus().then((st) => {
      for (const fn of listeners) {
        try { fn(st); } catch (_) {}
      }
    });
  }

  window.addEventListener('online', () => {
    notifyListeners();
    syncAllPending();
  });
  window.addEventListener('offline', notifyListeners);

  root.ApnaOffline = {
    getDeviceId,
    saveGuestProfile,
    getGuestProfile,
    saveTeamLocally,
    getLocalTeams,
    savePlayerLocally,
    getLocalPlayers,
    saveRuleLocally,
    getLocalRules,
    saveScorecardLocally,
    getLocalScorecards,
    saveMatchLocally,
    getLocalMatch,
    getAllLocalMatches,
    saveEventLocally,
    getEventsForMatch,
    getPendingEventsCount,
    getGuestMigrationBundle,
    markGuestMigrated,
    syncAllPending,
    getStatus,
    onStatusChange
  };
}(window));
