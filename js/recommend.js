/* Recommendation scoring.
 *
 * Seeds are the titles you gave a thumbs up. TMDB's own /recommendations does
 * the collaborative-filtering heavy lifting per seed; this module merges those
 * lists, weights them by how strongly you liked each seed, and bends the result
 * with a genre affinity built from BOTH thumbs — so a thumbs down actively
 * steers results away rather than just being ignored.
 *
 * The scoring functions are pure so they can be unit-tested without network.
 */

import { state, itemKey } from './store.js';
import { recommendationsFor } from './tmdb.js';

const MAX_SEEDS = 20;
const RANK_WINDOW = 20;
const AFFINITY_WEIGHT = 0.3;

/**
 * How much each rating moves genre affinity.
 *
 * "One and done" counts as a mild positive: you enjoyed the watch, you just
 * won't revisit that particular title — and genre affinity is about finding new
 * things, not rewatches.
 */
const RATING_WEIGHT = { up: 1, once: 0.5, down: -1 };

/**
 * Genre -> -1..1 preference. A genre you've liked 3 times and disliked once
 * lands positive; one you've only ever disliked lands at -1.
 */
export function genreAffinity(items) {
  const tally = new Map();
  for (const item of items) {
    const delta = RATING_WEIGHT[item.rating];
    if (delta === undefined) continue;
    for (const genre of item.genres || []) {
      const cur = tally.get(genre) || { score: 0, count: 0 };
      cur.score += delta;
      cur.count += 1;
      tally.set(genre, cur);
    }
  }
  const affinity = {};
  for (const [genre, { score, count }] of tally) affinity[genre] = score / count;
  return affinity;
}

/** Mean affinity across a candidate's genres; 0 when nothing is known. */
export function candidateAffinity(candidate, affinity) {
  const genres = (candidate.genres || []).filter((g) => g in affinity);
  if (!genres.length) return 0;
  return genres.reduce((sum, g) => sum + affinity[g], 0) / genres.length;
}

/**
 * Merge per-seed recommendation lists into one ranked set.
 *
 * @param {Array<{seed: object, results: object[]}>} seedLists
 * @param {object} affinity   genre -> -1..1
 * @param {Set<string>} exclude  item keys to drop (watched, disliked, listed)
 */
export function scoreCandidates(seedLists, affinity, exclude = new Set()) {
  const byKey = new Map();

  for (const { seed, results } of seedLists) {
    results.forEach((candidate, index) => {
      if (index >= RANK_WINDOW) return;
      const key = itemKey(candidate.type, candidate.id);
      if (exclude.has(key)) return;

      const positional = 1 - index / RANK_WINDOW;
      const entry = byKey.get(key) || { item: candidate, base: 0, because: [] };
      entry.base += positional;
      entry.because.push({ id: seed.id, type: seed.type, title: seed.title });
      byKey.set(key, entry);
    });
  }

  return [...byKey.values()]
    .map((entry) => {
      const aff = candidateAffinity(entry.item, affinity);
      return {
        item: entry.item,
        because: entry.because,
        affinity: aff,
        score: entry.base * (1 + AFFINITY_WEIGHT * aff),
      };
    })
    // A candidate whose genres you've consistently disliked shouldn't surface
    // just because one liked title recommended it.
    .filter((c) => c.affinity > -0.9)
    .sort((a, b) => b.score - a.score);
}

/**
 * Re-rank an already-ordered list (e.g. TMDB's popularity sort) by taste.
 *
 * Used by the Genres tab. Within a single genre the shared genre cancels out,
 * so what this actually leans on is a candidate's *other* genres — a thriller
 * that's also a comedy you dislike sinks below one that isn't. Same ±30%
 * multiplier as scoreCandidates, so both surfaces rank consistently.
 */
export function rankByAffinity(items, affinity) {
  return items
    .map((item, index) => ({
      item,
      // Hyperbolic decay on the source position, so the baseline is independent
      // of how many results came back. A linear `1 - index/items.length` would
      // scale with list length and let position swamp taste on short lists.
      score:
        (1 / (1 + index / RANK_WINDOW)) *
        (1 + AFFINITY_WEIGHT * candidateAffinity(item, affinity)),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

/** Titles the user has already dealt with, in one lookup set. */
export function excludeSet(items) {
  const set = new Set();
  for (const [key, item] of Object.entries(items)) {
    if (item.watched || item.inWatchlist || item.rating) set.add(key);
  }
  return set;
}

/**
 * Seeds are thumbs-up only. "One and done" still steers genre affinity, but
 * seeding a rail from it would surface more of exactly what you said you don't
 * want to revisit — and the rails are captioned "Because you liked X".
 */
export function seedsFrom(items) {
  return Object.values(items)
    .filter((i) => i.rating === 'up')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_SEEDS);
}

/**
 * Fetch and rank. Returns { top, rails } where rails are the per-seed
 * "Because you liked X" strips.
 */
export async function buildRecommendations() {
  const seeds = seedsFrom(state.items);
  if (!seeds.length) return { top: [], rails: [], seeds: [] };

  const settled = await Promise.allSettled(
    seeds.map(async (seed) => ({
      seed,
      results: await recommendationsFor(seed.type, seed.id),
    }))
  );

  const seedLists = settled
    .filter((r) => r.status === 'fulfilled' && r.value.results?.length)
    .map((r) => r.value);

  const affinity = genreAffinity(Object.values(state.items));
  const exclude = excludeSet(state.items);
  const top = scoreCandidates(seedLists, affinity, exclude);

  const rails = seedLists
    .map(({ seed, results }) => ({
      seed,
      items: results.filter((r) => !exclude.has(itemKey(r.type, r.id))).slice(0, 12),
    }))
    .filter((rail) => rail.items.length >= 3)
    .slice(0, 5);

  return { top: top.slice(0, 24), rails, seeds };
}
