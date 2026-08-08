/* Where-to-watch availability, indexed across the whole library.
 *
 * A detail sheet gets availability for free: it rides along on the detail call
 * it was already making. Filtering a *list* by platform is a different problem
 * — it needs availability for every tracked title at once, and nothing but an
 * opened sheet has ever fetched any. This module is that index.
 *
 * It deliberately does not live on the item, and so never reaches `state`:
 *
 *   - Availability is scoped to a country. Two devices signed into the same
 *     Gist can sit in different regions, and syncing this would have one
 *     device's answer overwrite the other's for no reason.
 *   - It changes as licences move, weekly and without anyone touching the app.
 *     A synced per-item field would generate constant merge traffic for a value
 *     the user never typed.
 *
 * So it is device-local, keyed by region, in IndexedDB, and rebuilt rather than
 * merged. Losing it costs a refetch and nothing else.
 */

import { cacheGet, cacheSet } from './idb.js';
import { movieDetail, tvDetail, resolveRegion } from './tmdb.js';
import { itemKey } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
// The row outlives its entries on purpose: expiring the whole index at once
// would throw away a hundred good answers to refresh a handful of stale ones.
const ROW_TTL = 120 * DAY;
const STALE_AFTER = 7 * DAY;

let loaded = null; // { region, entries: Map }
let saveTimer = null;

const rowKey = (region) => `availability:${region}`;

function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/**
 * Strips a normalized provider payload down to what a filter chip needs, and
 * down to two buckets from the four the detail sheet shows.
 *
 * Subscription and free/ad-supported are one proposition to someone asking what
 * to put on tonight — both mean watching it without paying for this title — so
 * they collapse into `stream`. Rent and buy collapse into `buy` for the same
 * reason from the other side: both are a transaction.
 */
export function compact(providers, now = Date.now()) {
  const pick = (list) => (list || []).map((p) => ({ id: String(p.id), name: p.name }));
  return {
    at: now,
    stream: dedupe([...pick(providers?.stream), ...pick(providers?.free)]),
    buy: dedupe([...pick(providers?.rent), ...pick(providers?.buy)]),
  };
}

export async function loadIndex() {
  const region = resolveRegion();
  if (loaded && loaded.region === region) return loaded.entries;
  const raw = (await cacheGet(rowKey(region))) || {};
  loaded = { region, entries: new Map(Object.entries(raw)) };
  return loaded.entries;
}

/** Synchronous view for the render path, which can't await. Empty until loaded. */
export function indexNow() {
  return loaded?.entries || new Map();
}

export function indexRegion() {
  return loaded?.region || null;
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!loaded) return;
  await cacheSet(rowKey(loaded.region), Object.fromEntries(loaded.entries), ROW_TTL);
}

// A sweep writes dozens of entries; one save at the end is plenty.
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 400);
}

/**
 * Record what a detail sheet just fetched. Free — the request already happened.
 *
 * Loads the index first if nothing else has, because the Lists tab is the only
 * thing that reads it and most people open a dozen sheets before ever going
 * there. Dropping those would throw away answers already paid for.
 */
export function recordAvailability(type, id, providers) {
  if (!providers) return;
  if (!loaded) {
    loadIndex().then(() => write(type, id, providers));
    return;
  }
  write(type, id, providers);
}

function write(type, id, providers) {
  // Guards against a sheet rendered just before a region change landing its
  // answer in the new region's index.
  if (providers.region && providers.region !== loaded.region) return;
  loaded.entries.set(itemKey(type, id), compact(providers));
  scheduleSave();
}

/** Tracked titles with no availability answer, or one old enough to redo. */
export function needsCheck(items, entries = indexNow(), now = Date.now()) {
  return items.filter((item) => {
    if (item.type !== 'movie' && item.type !== 'tv') return false;
    const hit = entries.get(itemKey(item.type, item.id));
    return !hit || now - (hit.at || 0) > STALE_AFTER;
  });
}

export function checkedCount(items, entries = indexNow()) {
  return items.filter((i) => entries.has(itemKey(i.type, i.id))).length;
}

/** Runs `fn` over `list` with at most `size` in flight. */
async function pooled(list, size, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, list.length) }, async () => {
    while (cursor < list.length) await fn(list[cursor++]);
  });
  await Promise.all(workers);
}

/**
 * Fill in the missing entries.
 *
 * One TMDB request per unchecked title, which is the honest cost of the
 * feature: multi-title availability has no batch endpoint. The detail calls are
 * already cached for a day, so anything opened recently is free, and the sweep
 * is capped so a large library can't fire hundreds of requests off one tap.
 */
export async function backfillAvailability(items, { max = 40, onProgress = null } = {}) {
  await loadIndex();
  const todo = needsCheck(items).slice(0, max);
  let done = 0;

  await pooled(todo, 4, async (item) => {
    try {
      const meta = item.type === 'tv' ? await tvDetail(item.id) : await movieDetail(item.id);
      recordAvailability(item.type, item.id, meta.providers);
    } catch {
      // One unreachable title must not abort the sweep; it stays unchecked and
      // the next tap picks it up again.
    }
    onProgress?.(++done, todo.length);
  });

  await flush();
  return { done, remaining: needsCheck(items).length };
}

/**
 * Platforms worth offering as chips: the ones your library is actually on.
 *
 * Same reasoning as the genre chips — a service you own nothing on would only
 * ever return an empty list, and the region catalog runs to hundreds of them.
 */
export function platformOptions(items, bucket, entries = indexNow()) {
  const counts = new Map();
  for (const item of items) {
    const hit = entries.get(itemKey(item.type, item.id));
    for (const provider of hit?.[bucket] || []) {
      const row = counts.get(provider.id) || { id: provider.id, name: provider.name, count: 0 };
      row.count++;
      counts.set(provider.id, row);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Drops the index when the region changes, so chips can't outlive their country. */
export function resetIndex() {
  clearTimeout(saveTimer);
  saveTimer = null;
  loaded = null;
}
