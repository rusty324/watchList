/* Application state: the single source of truth, persisted to localStorage.
 *
 * Two storage keys, deliberately separate:
 *   wl.data.v1     user data — safe to export and sync to a Gist
 *   wl.secrets.v1  API keys and tokens — device-only, NEVER exported or synced
 *
 * Keeping them apart is what guarantees an export file or Gist payload can't
 * leak credentials, since the export path only ever touches `data`.
 */

const DATA_KEY = 'wl.data.v1';
const SECRETS_KEY = 'wl.secrets.v1';
const SCHEMA_VERSION = 1;

const listeners = new Set();
let saveTimer = null;

/**
 * The personal ratings, in descending order of enthusiasm.
 *
 *   up    loved it, would watch again
 *   once  glad to have seen it, but never again — deliberately its own verdict
 *         rather than a weak thumbs up, so it doesn't teach the recommender to
 *         find more of the same
 *   down  not for me
 *
 * A missing/null rating means "no opinion recorded", which is distinct from all
 * three.
 */
export const RATINGS = ['up', 'once', 'down'];

function emptyData() {
  return {
    version: SCHEMA_VERSION,
    items: {},
    settings: { defaultTitleLang: 'en', theme: 'auto', hideDisliked: false },
  };
}

function emptySecrets() {
  return { tmdbKey: '', omdbKey: '', githubToken: '', gistId: '' };
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback();
  } catch {
    return fallback();
  }
}

/** Runs on load so older payloads (from a Gist or an export) stay usable. */
function migrate(data) {
  if (!data.items || typeof data.items !== 'object') data.items = {};
  // Merge over the defaults so settings added in a later version are present
  // even when the payload came from an older export or another device's Gist.
  data.settings = { ...emptyData().settings, ...(data.settings || {}) };
  data.version = SCHEMA_VERSION;
  return data;
}

export const state = migrate(read(DATA_KEY, emptyData));
export const secrets = Object.assign(emptySecrets(), read(SECRETS_KEY, emptySecrets));

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(reason) {
  for (const fn of listeners) {
    try {
      fn(reason);
    } catch (err) {
      console.error('[store] listener failed', err);
    }
  }
}

/** Debounced so rapid taps (checking off a season of episodes) write once. */
export function persist(reason = 'change') {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('[store] save failed', err);
      notify('storage-error');
    }
  }, 120);
  notify(reason);
}

export function persistNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('[store] save failed', err);
  }
}

export function saveSecrets() {
  try {
    localStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
  } catch (err) {
    console.error('[store] secrets save failed', err);
  }
  notify('secrets');
}

export function hasKeys() {
  return Boolean(secrets.tmdbKey);
}

/* ---------- items ---------- */

export const itemKey = (type, id) => `${type}:${id}`;

export function getItem(type, id) {
  return state.items[itemKey(type, id)] || null;
}

/** True once the item carries any user intent worth keeping around. */
export function isTracked(item) {
  if (!item) return false;
  return Boolean(
    item.watched || item.inWatchlist || item.rating || tvWatchedCount(item) > 0
  );
}

/**
 * Merge normalized metadata + user changes into an item, creating it if needed.
 * `updatedAt` is bumped on every write so Gist sync can merge per item rather
 * than clobbering a whole device's state.
 */
export function upsertItem(type, id, patch, { touch = true } = {}) {
  const key = itemKey(type, id);
  const existing = state.items[key];
  const next = existing
    ? { ...existing, ...patch }
    : {
        type,
        id,
        titlePref: state.settings.defaultTitleLang,
        rating: null,
        watched: false,
        inWatchlist: false,
        seasons: {},
        ...patch,
      };
  if (touch) next.updatedAt = Date.now();
  state.items[key] = next;
  return next;
}

/** Drops items the user has no relationship with, keeping storage lean. */
export function pruneUntracked() {
  let removed = 0;
  for (const [key, item] of Object.entries(state.items)) {
    if (!isTracked(item)) {
      delete state.items[key];
      removed++;
    }
  }
  return removed;
}

export function setRating(type, id, rating, meta) {
  const current = getItem(type, id);
  // Tapping the active thumb clears it — same gesture, no separate button needed.
  const next = current && current.rating === rating ? null : rating;
  upsertItem(type, id, { ...(meta || {}), rating: next });
  persist('rating');
  return next;
}

export function clearRating(type, id) {
  upsertItem(type, id, { rating: null });
  persist('rating');
}

export function setWatchlist(type, id, on, meta) {
  upsertItem(type, id, { ...(meta || {}), inWatchlist: on });
  persist('watchlist');
}

export function setTitlePref(type, id, pref) {
  upsertItem(type, id, { titlePref: pref });
  persist('title-pref');
}

/* ---------- movies ---------- */

export function setMovieWatched(id, on, meta) {
  upsertItem('movie', id, {
    ...(meta || {}),
    watched: on,
    // Watching something means it's no longer pending.
    inWatchlist: on ? false : (getItem('movie', id)?.inWatchlist ?? false),
  });
  persist('watched');
}

/* ---------- tv ---------- */

/** Seasons the app counts: specials (season 0) are excluded everywhere. */
export function realSeasons(item) {
  return (item?.seasonMeta || []).filter((s) => s.n > 0);
}

export function totalEpisodes(item) {
  return realSeasons(item).reduce((sum, s) => sum + (s.episodes || 0), 0);
}

export function seasonWatchedCount(item, seasonNumber) {
  const rec = item?.seasons?.[String(seasonNumber)];
  if (!rec || !rec.watched) return 0;
  return Object.values(rec.watched).filter(Boolean).length;
}

export function tvWatchedCount(item) {
  if (!item || item.type !== 'tv') return 0;
  return realSeasons(item).reduce(
    (sum, s) => sum + Math.min(seasonWatchedCount(item, s.n), s.episodes || 0),
    0
  );
}

/** 0..1. Returns 0 when episode counts aren't known yet. */
export function tvProgress(item) {
  const total = totalEpisodes(item);
  if (!total) return item?.watched ? 1 : 0;
  return Math.min(1, tvWatchedCount(item) / total);
}

function syncTvWatchedFlag(item) {
  const total = totalEpisodes(item);
  if (!total) return;
  item.watched = tvWatchedCount(item) >= total;
  if (item.watched) item.inWatchlist = false;
}

function ensureSeason(item, seasonNumber) {
  const key = String(seasonNumber);
  if (!item.seasons) item.seasons = {};
  if (!item.seasons[key]) item.seasons[key] = { watched: {} };
  if (!item.seasons[key].watched) item.seasons[key].watched = {};
  return item.seasons[key];
}

export function setEpisodeWatched(id, seasonNumber, episodeNumber, on, meta) {
  const item = upsertItem('tv', id, meta || {});
  const season = ensureSeason(item, seasonNumber);
  if (on) season.watched[String(episodeNumber)] = true;
  else delete season.watched[String(episodeNumber)];
  syncTvWatchedFlag(item);
  persist('episode');
  return item;
}

export function setSeasonWatched(id, seasonNumber, episodeNumbers, on, meta) {
  const item = upsertItem('tv', id, meta || {});
  const season = ensureSeason(item, seasonNumber);
  if (on) for (const n of episodeNumbers) season.watched[String(n)] = true;
  else season.watched = {};
  syncTvWatchedFlag(item);
  persist('season');
  return item;
}

/**
 * Mark/unmark the whole series. Fills every real season's map from the known
 * episode counts so the percentage and the per-episode checkboxes agree.
 */
export function setShowWatched(id, on, meta) {
  const item = upsertItem('tv', id, meta || {});
  for (const s of realSeasons(item)) {
    const season = ensureSeason(item, s.n);
    season.watched = {};
    if (on) {
      for (let n = 1; n <= (s.episodes || 0); n++) season.watched[String(n)] = true;
    }
  }
  item.watched = on;
  if (on) item.inWatchlist = false;
  persist('show-watched');
  return item;
}

/* ---------- scores ---------- */

export function setScores(type, id, scores) {
  const item = getItem(type, id);
  upsertItem(
    type,
    id,
    { scores: { ...(item?.scores || {}), ...scores, fetchedAt: Date.now() } },
    // Score fetches are background metadata, not a user edit — don't let them
    // win a sync merge against a real change made on another device.
    { touch: false }
  );
  persist('scores');
}

/* ---------- settings / import-export ---------- */

export function setSetting(name, value) {
  state.settings[name] = value;
  persist('settings');
}

export function exportData() {
  // Built from `state` alone, so secrets can never ride along.
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export function replaceData(next) {
  const clean = migrate({ ...emptyData(), ...next });
  delete clean.exportedAt;
  state.items = clean.items;
  state.settings = clean.settings;
  persistNow();
  notify('replace');
}

export function notifyAll(reason) {
  notify(reason);
}
