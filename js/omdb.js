/* IMDb + Rotten Tomatoes scores via OMDb.
 *
 * The free tier allows 1000 requests/day, which is the binding constraint on
 * this whole feature. So: never call this for search results or grid tiles —
 * only when an item is opened in detail or added to a list — and cache the
 * answer on the item for 30 days. A local daily counter lets Settings warn
 * before the quota runs out.
 */

import { secrets, getItem, setScores } from './store.js';
import { isMock, mockOmdb } from './mock.js';

const BASE = 'https://www.omdbapi.com/';
const FRESH_FOR = 30 * 24 * 60 * 60 * 1000;
const QUOTA_KEY = 'wl.omdb.quota';
const DAILY_LIMIT = 1000;

const inflight = new Map();

export function hasOmdbKey() {
  return Boolean(secrets.omdbKey) || isMock();
}

/* ---------- quota tracking ---------- */

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function quota() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}');
    if (raw.date !== today()) return { date: today(), used: 0 };
    return { date: raw.date, used: raw.used || 0 };
  } catch {
    return { date: today(), used: 0 };
  }
}

function countRequest() {
  const q = quota();
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ date: q.date, used: q.used + 1 }));
  } catch {
    /* ignore */
  }
}

export function quotaRemaining() {
  return Math.max(0, DAILY_LIMIT - quota().used);
}

/* ---------- parsing ---------- */

/** "8.5" -> 8.5, "N/A" -> null */
export function parseImdb(value) {
  if (!value || value === 'N/A') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Pulls "96%" out of the Ratings array -> 96. Absent for most TV series. */
export function parseRotten(ratings) {
  if (!Array.isArray(ratings)) return null;
  const row = ratings.find((r) => r.Source === 'Rotten Tomatoes');
  if (!row || !row.Value) return null;
  const n = parseInt(String(row.Value).replace('%', ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseOmdb(payload) {
  if (!payload || payload.Response === 'False') return { imdb: null, rt: null };
  return {
    imdb: parseImdb(payload.imdbRating),
    rt: parseRotten(payload.Ratings),
  };
}

/* ---------- fetching ---------- */

export function isFresh(item) {
  const at = item?.scores?.fetchedAt;
  return Boolean(at) && Date.now() - at < FRESH_FOR;
}

/**
 * Fetch IMDb/RT for one title and write them onto the stored item.
 * Returns the scores, or null when it can't (no key, no IMDb id, quota gone).
 */
export async function fetchScores(type, id, imdbId, { force = false } = {}) {
  const item = getItem(type, id);
  if (!force && isFresh(item)) return item.scores;
  if (!imdbId) return null;
  if (!hasOmdbKey()) return null;
  if (quotaRemaining() <= 0) return null;

  if (inflight.has(imdbId)) return inflight.get(imdbId);

  const promise = (async () => {
    let payload;
    if (isMock()) {
      payload = mockOmdb(imdbId);
    } else {
      const url = new URL(BASE);
      url.searchParams.set('i', imdbId);
      url.searchParams.set('apikey', secrets.omdbKey);
      countRequest();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OMDb returned ${res.status}`);
      payload = await res.json();
    }
    const scores = parseOmdb(payload);
    setScores(type, id, scores);
    return scores;
  })()
    .catch((err) => {
      console.warn('[omdb] lookup failed', err);
      return null;
    })
    .finally(() => inflight.delete(imdbId));

  inflight.set(imdbId, promise);
  return promise;
}

/**
 * Backfill scores for list items that never got them (added before a key was
 * entered, or imported from a Gist). Sequential and capped so it can't burn
 * the daily quota in one sweep.
 */
export async function backfillScores(items, { max = 20 } = {}) {
  let done = 0;
  for (const item of items) {
    if (done >= max || quotaRemaining() <= 50) break;
    if (isFresh(item) || !item.imdbId) continue;
    await fetchScores(item.type, item.id, item.imdbId);
    done++;
  }
  return done;
}
