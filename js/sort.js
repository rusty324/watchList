/* List filtering and sorting.
 *
 * Pure functions over stored items so they can be unit-tested directly. Every
 * comparator falls back to title order, which keeps sorting stable and makes
 * coarse keys (type, seen/unseen) produce a readable list rather than an
 * arbitrary shuffle within each bucket.
 */

import { tvProgress } from './store.js';

export const FILTERS = {
  all: { label: 'All', test: () => true },
  watchlist: { label: 'Watchlist', test: (i) => i.inWatchlist },
  watched: { label: 'Watched', test: (i) => i.watched },
  unwatched: { label: 'Not watched', test: (i) => !i.watched },
  movie: { label: 'Movies', test: (i) => i.type === 'movie' },
  tv: { label: 'TV', test: (i) => i.type === 'tv' },
  liked: { label: 'Liked', test: (i) => i.rating === 'up' },
};

/** Title used for display and for the alphabetical sort. */
export function sortTitle(item) {
  const base =
    item.foreign && item.titlePref === 'original' && item.originalTitle
      ? item.originalTitle
      : item.title || '';
  // "The Princess Bride" belongs under P, the way a shelf would file it.
  return base.replace(/^(the|a|an)\s+/i, '').toLowerCase();
}

const byTitle = (a, b) => sortTitle(a).localeCompare(sortTitle(b));

/** Sorts a nullable numeric descending with missing values pinned to the end. */
function descNullsLast(get) {
  return (a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return byTitle(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || byTitle(a, b);
  };
}

const RATING_ORDER = { up: 0, null: 1, down: 2 };
const ratingRank = (item) => RATING_ORDER[item.rating ?? 'null'] ?? 1;

export const SORTS = {
  title: { label: 'Title A–Z', cmp: byTitle },
  seen: {
    label: 'Watched first',
    cmp: (a, b) => Number(Boolean(b.watched)) - Number(Boolean(a.watched)) || byTitle(a, b),
  },
  unseen: {
    label: 'Not watched first',
    cmp: (a, b) => Number(Boolean(a.watched)) - Number(Boolean(b.watched)) || byTitle(a, b),
  },
  type: {
    label: 'Movies, then TV',
    cmp: (a, b) => a.type.localeCompare(b.type) || byTitle(a, b),
  },
  genre: {
    label: 'Genre',
    cmp: (a, b) => {
      const ag = (a.genres || [])[0] || '￿';
      const bg = (b.genres || [])[0] || '￿';
      return ag.localeCompare(bg) || byTitle(a, b);
    },
  },
  imdb: { label: 'IMDb rating', cmp: descNullsLast((i) => i.scores?.imdb) },
  rt: { label: 'Rotten Tomatoes', cmp: descNullsLast((i) => i.scores?.rt) },
  personal: {
    label: 'My rating',
    cmp: (a, b) => ratingRank(a) - ratingRank(b) || byTitle(a, b),
  },
  year: { label: 'Release year', cmp: descNullsLast((i) => i.year) },
  progress: {
    label: 'Progress',
    cmp: (a, b) => {
      const pa = a.type === 'tv' ? tvProgress(a) : a.watched ? 1 : 0;
      const pb = b.type === 'tv' ? tvProgress(b) : b.watched ? 1 : 0;
      return pb - pa || byTitle(a, b);
    },
  },
  added: {
    label: 'Recently updated',
    cmp: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || byTitle(a, b),
  },
};

/** Items the Lists tab shows: anything the user has actually engaged with. */
export function trackedItems(items) {
  return Object.values(items).filter(
    (i) => i.watched || i.inWatchlist || i.rating || hasEpisodeProgress(i)
  );
}

function hasEpisodeProgress(item) {
  if (item.type !== 'tv') return false;
  return Object.values(item.seasons || {}).some(
    (s) => Object.keys(s.watched || {}).length > 0
  );
}

export function applyList(items, { filter = 'all', sort = 'title', query = '' } = {}) {
  const test = FILTERS[filter]?.test || FILTERS.all.test;
  const cmp = SORTS[sort]?.cmp || SORTS.title.cmp;
  const q = query.trim().toLowerCase();

  return trackedItems(items)
    .filter(test)
    .filter((i) =>
      !q ||
      [i.title, i.originalTitle].filter(Boolean).some((t) => t.toLowerCase().includes(q))
    )
    .sort(cmp);
}

/** Groups a genre-sorted list so the Lists tab can print genre headers. */
export function groupByGenre(items) {
  const groups = new Map();
  for (const item of items) {
    const key = (item.genres || [])[0] || 'Uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
