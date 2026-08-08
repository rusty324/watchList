/* List filtering and sorting.
 *
 * Pure functions over stored items so they can be unit-tested directly. Every
 * comparator falls back to title order, which keeps sorting stable and makes
 * coarse keys (type, seen/unseen) produce a readable list rather than an
 * arbitrary shuffle within each bucket.
 */

import { tvProgress } from './store.js';

/**
 * Filters, grouped.
 *
 * Selections inside a group widen the results; selections across groups narrow
 * them. So Movies + TV + Liked means "liked films and shows", while
 * Movies + Liked means "liked films".
 *
 * Grouping is what makes multi-select work at all here: several of these are
 * mutually exclusive by construction — a title can't be both Watched and Not
 * watched, and it carries at most one rating — so a flat AND across everything
 * would make half the combinations return nothing.
 */
export const FILTER_GROUPS = {
  status: {
    label: 'Status',
    options: {
      watchlist: { label: 'Watchlist', test: (i) => i.inWatchlist },
      watched: { label: 'Watched', test: (i) => i.watched },
      unwatched: { label: 'Not watched', test: (i) => !i.watched },
    },
  },
  type: {
    label: 'Type',
    options: {
      movie: { label: 'Movies', test: (i) => i.type === 'movie' },
      tv: { label: 'TV', test: (i) => i.type === 'tv' },
    },
  },
  rating: {
    label: 'Rating',
    options: {
      liked: { label: 'Liked', test: (i) => i.rating === 'up' },
      once: { label: 'One and done', test: (i) => i.rating === 'once' },
      disliked: { label: 'Not for me', test: (i) => i.rating === 'down' },
    },
  },
  // Options are built from the library at render time — see genreOptions().
  genre: { label: 'Genre', dynamic: true },
};

/** An empty selection per group: the "no filters" state. */
export function emptyFilters() {
  return { status: new Set(), type: new Set(), rating: new Set(), genre: new Set() };
}

export function anyFilterActive(filters) {
  return Object.values(filters || {}).some((set) => set?.size > 0);
}

/**
 * Genres worth offering as filters: the ones the library actually contains.
 *
 * The full catalog is 21 genres, which no phone can show usefully as chips, and
 * a genre you own nothing in would only ever return an empty list.
 */
export function genreOptions(items) {
  const counts = new Map();
  for (const item of trackedItems(items)) {
    for (const genre of item.genres || []) {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

function matchesGroup(item, groupKey, selected) {
  if (!selected?.size) return true; // an unset group doesn't constrain anything
  if (groupKey === 'genre') {
    return (item.genres || []).some((g) => selected.has(g));
  }
  const options = FILTER_GROUPS[groupKey]?.options || {};
  for (const key of selected) {
    if (options[key]?.test(item)) return true;
  }
  return false;
}

export function matchesFilters(item, filters) {
  return Object.keys(FILTER_GROUPS).every((groupKey) =>
    matchesGroup(item, groupKey, filters?.[groupKey])
  );
}

/**
 * Whether the "hide Not for me" setting should suppress this item.
 *
 * Shared by the Lists tab and the Browse rows so there is one definition of the
 * rule. Search deliberately does not consult it — a title you typed the name of
 * should never look like it doesn't exist.
 */
export function hiddenByPreference(item, settings) {
  return Boolean(settings?.hideDisliked) && item?.rating === 'down';
}

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

// "One and done" outranks unrated: it is a positive verdict, just not one that
// invites a rewatch.
const RATING_ORDER = { up: 0, once: 1, null: 2, down: 3 };
const ratingRank = (item) => RATING_ORDER[item.rating ?? 'null'] ?? RATING_ORDER.null;

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

export function applyList(
  items,
  { filters = null, sort = 'title', query = '', settings = null } = {}
) {
  const active = filters || emptyFilters();
  const cmp = SORTS[sort]?.cmp || SORTS.title.cmp;
  const q = query.trim().toLowerCase();

  // Selecting "Not for me" is the escape hatch: it always reveals disliked
  // titles, so hiding them can never strand a rating you want to undo.
  const hide = active.rating?.has('disliked') ? null : settings;

  return trackedItems(items)
    .filter((i) => !hiddenByPreference(i, hide))
    .filter((i) => matchesFilters(i, active))
    .filter((i) =>
      !q ||
      [i.title, i.originalTitle].filter(Boolean).some((t) => t.toLowerCase().includes(q))
    )
    .sort(cmp);
}

/* ---------- search results ---------- */

/**
 * Filters and sorts Browse search results.
 *
 * Applied to what TMDB returned, not to the query: multi-search accepts no
 * genre, year or type parameter, so this can only narrow the page of results in
 * hand. Building the genre chips from those results (see searchGenres) keeps
 * that honest — genre-wide browsing is what the Genres tab is for.
 */
export const SEARCH_SORTS = {
  relevance: { label: 'Relevance', cmp: null }, // keep TMDB's own ordering
  newest: { label: 'Newest', cmp: descNullsLast((i) => i.year) },
  rating: { label: 'Highest rated', cmp: descNullsLast((i) => i.tmdbScore) },
  title: { label: 'Title A–Z', cmp: byTitle },
};

export function searchGenres(results) {
  const names = new Set();
  for (const item of results) for (const g of item.genres || []) names.add(g);
  return [...names].sort();
}

export function applySearch(
  results,
  { type = 'all', genres = null, sort = 'relevance', hideTracked = false, items = {} } = {}
) {
  const wanted = genres && genres.size ? genres : null;

  const filtered = results.filter((item) => {
    if (type !== 'all' && item.type !== type) return false;
    // People carry no genres, so any genre filter necessarily excludes them.
    if (wanted && !(item.genres || []).some((g) => wanted.has(g))) return false;
    if (hideTracked && item.type !== 'person') {
      const stored = items[`${item.type}:${item.id}`];
      if (stored && (stored.watched || stored.inWatchlist || stored.rating)) return false;
    }
    return true;
  });

  const cmp = SEARCH_SORTS[sort]?.cmp;
  return cmp ? filtered.slice().sort(cmp) : filtered;
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
