/* Tiny TTL cache on IndexedDB.
 *
 * Bulky API payloads (season/episode lists, person filmographies, per-seed
 * recommendation lists) live here rather than in localStorage, so cache growth
 * can never push the user's watch history over Safari's ~5 MB localStorage cap.
 * Falls back to an in-memory Map when IndexedDB is unavailable (private mode,
 * file:// origins), which degrades to session-lifetime caching.
 */

const DB_NAME = 'watchlist-cache';
const STORE = 'kv';
const memory = new Map();
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Some engines never fire either callback in private mode; don't hang boot.
    setTimeout(() => resolve(null), 2000);
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet(key) {
  const hit = memory.get(key);
  if (hit) {
    if (hit.expires > Date.now()) return hit.value;
    memory.delete(key);
  }
  const db = await openDb();
  if (!db) return undefined;
  try {
    const row = await tx(db, 'readonly', (s) => s.get(key));
    if (!row) return undefined;
    if (row.expires <= Date.now()) {
      cacheDelete(key);
      return undefined;
    }
    memory.set(key, row);
    return row.value;
  } catch {
    return undefined;
  }
}

export async function cacheSet(key, value, ttlMs) {
  const row = { value, expires: Date.now() + ttlMs };
  memory.set(key, row);
  const db = await openDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.put(row, key));
  } catch {
    /* quota or transient failure — the memory copy still serves this session */
  }
}

export async function cacheDelete(key) {
  memory.delete(key);
  const db = await openDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}

export async function cacheClear() {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}

/** Read-through helper: returns the cached value or fills it via `loader`. */
export async function cached(key, ttlMs, loader) {
  const hit = await cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  if (value !== undefined && value !== null) await cacheSet(key, value, ttlMs);
  return value;
}
