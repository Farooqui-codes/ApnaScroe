/**
 * ApnaScore Offline Scoring & IndexedDB Sync Engine
 * Persists matches & ball-by-ball events locally in IndexedDB immediately,
 * recovers active matches after app restart, and syncs idempotently when online.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'apnascore_offline_db';
  const DB_VERSION = 1;
  const STORE_MATCHES = 'offline_matches';
  const STORE_EVENTS = 'offline_events';
  const DEVICE_KEY = 'apnascore_device_id';

  let dbPromise = null;
  let isSyncing = false;
  let lastSyncError = '';

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

  async function saveMatchLocally(matchBundle) {
    const localId = matchBundle.localId || matchBundle.match._id || matchBundle.match.clientMatchId;
    const record = {
      localId: String(localId),
      serverMatchId: matchBundle.match._id && !String(matchBundle.match._id).startsWith('local_') ? String(matchBundle.match._id) : null,
      clientMatchId: matchBundle.match.clientMatchId || String(localId),
      match: matchBundle.match,
      innings: matchBundle.innings || [],
      syncStatus: matchBundle.syncStatus || 'synced', // synced | pending | failed | conflict
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

  async function getAllLocalMatches() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_MATCHES, 'readonly');
      const req = tx.objectStore(STORE_MATCHES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

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
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_EVENTS, 'readonly');
      const req = tx.objectStore(STORE_EVENTS).getAll();
      req.onsuccess = () => {
        const count = (req.result || []).filter((e) => !e.synced).length;
        resolve(count);
      };
      req.onerror = () => resolve(0);
    });
  }

  async function syncAllPending() {
    if (isSyncing || !navigator.onLine || !root.ApnaAPI.getToken()) {
      notifyListeners();
      return { synced: 0, skipped: true };
    }
    isSyncing = true;
    lastSyncError = '';
    notifyListeners();

    let totalSynced = 0;
    try {
      const allMatches = await getAllLocalMatches();
      const db = await openDB();
      const allEvents = await new Promise((resolve) => {
        const tx = db.transaction(STORE_EVENTS, 'readonly');
        const req = tx.objectStore(STORE_EVENTS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

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
        // Group events by inningsNumber
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
                    inningsSetup: innObj
                      ? {
                          inningsNumber: innObj.inningsNumber,
                          battingTeamId: innObj.battingTeamId,
                          battingTeamName: innObj.battingTeamName,
                          bowlingTeamId: innObj.bowlingTeamId,
                          bowlingTeamName: innObj.bowlingTeamName,
                          target: innObj.target,
                          openingStrikerId: innObj.openingStrikerId,
                          openingStrikerName: innObj.openingStrikerName,
                          openingNonStrikerId: innObj.openingNonStrikerId,
                          openingNonStrikerName: innObj.openingNonStrikerName,
                          openingBowlerId: innObj.openingBowlerId,
                          openingBowlerName: innObj.openingBowlerName
                        }
                      : null
                  }
                : undefined
            };

            const res = await root.ApnaAPI.post('/api/sync/match', payload);
            if (res && res.success) {
              // Mark events as synced — never delete local unsynced history prematurely
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
    return { online, isSyncing, pendingCount, lastSyncError, state };
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
    saveMatchLocally,
    getLocalMatch,
    getAllLocalMatches,
    saveEventLocally,
    getEventsForMatch,
    getPendingEventsCount,
    syncAllPending,
    getStatus,
    onStatusChange
  };
}(window));
