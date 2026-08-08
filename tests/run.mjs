/* Unit tests for the pure logic — percentage math, sort comparators,
 * recommendation scoring, title-toggle eligibility, and the sync merge rule.
 *
 * Run with:  node tests/run.mjs
 *
 * No framework and no dependencies: node's built-in test runner, plus a few
 * browser globals stubbed in before the app modules are imported.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------- browser stubs ---------- */

class MemoryStorage {
  #map = new Map();
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }
  setItem(k, v) {
    this.#map.set(k, String(v));
  }
  removeItem(k) {
    this.#map.delete(k);
  }
  clear() {
    this.#map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.location = { search: '', pathname: '/', hash: '', origin: 'http://localhost' };

// Node ships its own read-only `navigator`, so it has to be redefined rather
// than assigned.
function setLanguage(language) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language },
    configurable: true,
    writable: true,
  });
}
setLanguage('en-US');

// ui.js registers a popstate listener at module scope, and importing the
// press-and-hold helpers pulls it in. No-ops are enough: nothing under test
// dispatches events.
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const store = await import('../js/store.js');
const tmdb = await import('../js/tmdb.js');
const sortMod = await import('../js/sort.js');
const rec = await import('../js/recommend.js');
const sync = await import('../js/sync.js');
const omdb = await import('../js/omdb.js');
const genres = await import('../js/genres.js');
const anilist = await import('../js/anilist.js');
const diag = await import('../js/diagnostics.js');
const lp = await import('../js/longpress.js');

function resetStore() {
  for (const key of Object.keys(store.state.items)) delete store.state.items[key];
  store.state.settings.defaultTitleLang = 'en';
}

/* ---------- foreign titles ---------- */

test('title toggle is offered only for genuinely foreign titles', () => {
  assert.equal(tmdb.hasForeignTitle('Parasite', '기생충', 'ko'), true);
  assert.equal(tmdb.hasForeignTitle('Spirited Away', '千と千尋の神隠し', 'ja'), true);

  // The case the user called out: an English film must never sprout a toggle,
  // no matter how many international releases exist.
  assert.equal(
    tmdb.hasForeignTitle('The Princess Bride', 'The Princess Bride', 'en'),
    false
  );
  // Foreign-language but identically titled (proper nouns) — nothing to toggle.
  assert.equal(tmdb.hasForeignTitle('Roma', 'Roma', 'es'), false);
  assert.equal(tmdb.hasForeignTitle('Parasite', '', 'ko'), false);
});

/* ---------- watch providers ---------- */

const WATCH_PAYLOAD = {
  results: {
    US: {
      link: 'https://www.themoviedb.org/movie/1/watch?locale=US',
      flatrate: [
        { provider_id: 15, provider_name: 'Hulu', display_priority: 4 },
        { provider_id: 8, provider_name: 'Netflix', display_priority: 0 },
        { provider_id: 1899, provider_name: 'Max', display_priority: 1 },
      ],
      free: [{ provider_id: 73, provider_name: 'Tubi TV', display_priority: 12 }],
      ads: [
        { provider_id: 73, provider_name: 'Tubi TV', display_priority: 12 },
        { provider_id: 300, provider_name: 'Pluto TV', display_priority: 10 },
      ],
      rent: [{ provider_id: 2, provider_name: 'Apple TV', display_priority: 3 }],
      buy: [{ provider_id: 3, provider_name: 'Google Play Movies', display_priority: 8 }],
    },
  },
};

const names = (list) => list.map((p) => p.name);

test('providers are bucketed into the four rows the sheet shows', () => {
  const p = tmdb.normalizeProviders(WATCH_PAYLOAD, 'US');
  assert.deepEqual(names(p.stream), ['Netflix', 'Max', 'Hulu']); // by display_priority
  assert.deepEqual(names(p.rent), ['Apple TV']);
  assert.deepEqual(names(p.buy), ['Google Play Movies']);
  assert.equal(p.link, WATCH_PAYLOAD.results.US.link);
  assert.equal(p.region, 'US');
});

test('free and ad-supported merge without listing a provider twice', () => {
  // Tubi is in both `free` and `ads` on the real API.
  const p = tmdb.normalizeProviders(WATCH_PAYLOAD, 'US');
  assert.deepEqual(names(p.free), ['Pluto TV', 'Tubi TV']);
  assert.equal(p.free.filter((x) => x.id === 73).length, 1);
});

test('a title unavailable in your region is empty, not an error', () => {
  // Absent regions are routine — most titles are listed in only a few markets.
  for (const payload of [WATCH_PAYLOAD, { results: {} }, {}, null, undefined]) {
    const p = tmdb.normalizeProviders(payload, 'ZZ');
    assert.equal(tmdb.hasAnyProvider(p), false);
    assert.deepEqual([p.stream, p.free, p.rent, p.buy], [[], [], [], []]);
    assert.equal(p.link, null);
    assert.equal(p.region, 'ZZ');
  }
  assert.equal(tmdb.hasAnyProvider(tmdb.normalizeProviders(WATCH_PAYLOAD, 'US')), true);
});

test('region falls back from setting to locale to US', () => {
  resetStore();
  setLanguage('en-GB');
  assert.equal(tmdb.resolveRegion(), 'GB');

  store.state.settings.region = 'DE';
  assert.equal(tmdb.resolveRegion(), 'DE');

  store.state.settings.region = '';
  setLanguage('en'); // no region subtag
  assert.equal(tmdb.resolveRegion(), 'US');

  setLanguage('not a locale');
  assert.equal(tmdb.resolveRegion(), 'US');

  setLanguage('en-US');
});

/* ---------- tv normalization ---------- */

const RAW_TV = {
  id: 1396,
  name: 'Breaking Bad',
  original_name: 'Breaking Bad',
  original_language: 'en',
  first_air_date: '2008-01-20',
  number_of_seasons: 5,
  number_of_episodes: 62,
  seasons: [
    { season_number: 0, episode_count: 9, name: 'Specials', air_date: '2009-02-17' },
    { season_number: 1, episode_count: 7, name: 'Season 1', air_date: '2008-01-20' },
    { season_number: 2, episode_count: 13, name: 'Season 2', air_date: '2009-03-08' },
    { season_number: 3, episode_count: 13, name: 'Season 3', air_date: '2010-03-21' },
    { season_number: 4, episode_count: 13, name: 'Season 4', air_date: '2011-07-17' },
    { season_number: 5, episode_count: 16, name: 'Season 5', air_date: '2012-07-15' },
  ],
};

test('specials are excluded from season and episode counts', () => {
  const show = tmdb.normalizeTv(RAW_TV, {});
  assert.equal(show.year, 2008);
  assert.equal(show.seasonCount, 5);
  assert.equal(show.episodeCount, 62);
  assert.ok(!show.seasonMeta.some((s) => s.n === 0));
});

/* ---------- tv progress ---------- */

test('progress reflects episodes watched, ignoring specials', () => {
  resetStore();
  const show = tmdb.normalizeTv(RAW_TV, {});
  store.upsertItem('tv', 1396, show);

  const item = () => store.getItem('tv', 1396);
  assert.equal(store.totalEpisodes(item()), 62);
  assert.equal(store.tvProgress(item()), 0);

  // All of season 1 = 7 of 62.
  store.setSeasonWatched(1396, 1, [1, 2, 3, 4, 5, 6, 7], true);
  assert.equal(store.tvWatchedCount(item()), 7);
  assert.equal(Math.round(store.tvProgress(item()) * 100), 11);
  assert.equal(item().watched, false);

  // A single extra episode.
  store.setEpisodeWatched(1396, 2, 1, true);
  assert.equal(store.tvWatchedCount(item()), 8);

  // Un-checking it goes back.
  store.setEpisodeWatched(1396, 2, 1, false);
  assert.equal(store.tvWatchedCount(item()), 7);

  // Clearing the season resets to zero.
  store.setSeasonWatched(1396, 1, [], false);
  assert.equal(store.tvWatchedCount(item()), 0);
});

test('marking the whole show watched fills every real season', () => {
  resetStore();
  store.upsertItem('tv', 1396, tmdb.normalizeTv(RAW_TV, {}));
  store.setShowWatched(1396, true);

  const item = store.getItem('tv', 1396);
  assert.equal(item.watched, true);
  assert.equal(store.tvProgress(item), 1);
  assert.equal(store.tvWatchedCount(item), 62);
  assert.equal(store.seasonWatchedCount(item, 5), 16);
  // Specials never get a watched map, so 100% means the actual show.
  assert.equal(item.seasons['0'], undefined);

  store.setShowWatched(1396, false);
  assert.equal(store.getItem('tv', 1396).watched, false);
  assert.equal(store.tvProgress(store.getItem('tv', 1396)), 0);
});

test('watching every episode flips the show to fully watched', () => {
  resetStore();
  store.upsertItem('tv', 1396, tmdb.normalizeTv(RAW_TV, {}));
  for (const s of store.realSeasons(store.getItem('tv', 1396))) {
    const numbers = Array.from({ length: s.episodes }, (_, i) => i + 1);
    store.setSeasonWatched(1396, s.n, numbers, true);
  }
  assert.equal(store.getItem('tv', 1396).watched, true);
});

test('watching something clears it from the watchlist', () => {
  resetStore();
  store.setWatchlist('movie', 550, true, { title: 'Fight Club', type: 'movie', id: 550 });
  assert.equal(store.getItem('movie', 550).inWatchlist, true);
  store.setMovieWatched(550, true);
  assert.equal(store.getItem('movie', 550).inWatchlist, false);
});

test('tapping the active thumb clears the rating', () => {
  resetStore();
  assert.equal(store.setRating('movie', 550, 'up'), 'up');
  assert.equal(store.setRating('movie', 550, 'up'), null);
  assert.equal(store.setRating('movie', 550, 'down'), 'down');
  assert.equal(store.setRating('movie', 550, 'up'), 'up');
});

/* ---------- sorting ---------- */

const LIST = {
  'movie:1': { type: 'movie', id: 1, title: 'The Princess Bride', year: 1987, watched: true, rating: 'up', genres: ['Adventure'], scores: { imdb: 8.0, rt: 97 }, updatedAt: 30 },
  'movie:2': { type: 'movie', id: 2, title: 'Parasite', originalTitle: '기생충', foreign: true, year: 2019, watched: false, inWatchlist: true, genres: ['Thriller'], scores: { imdb: 8.5, rt: 99 }, updatedAt: 20 },
  'movie:3': { type: 'movie', id: 3, title: 'Alien', year: 1979, watched: true, rating: 'down', genres: ['Horror'], scores: {}, updatedAt: 10 },
  'tv:4': { type: 'tv', id: 4, title: 'Breaking Bad', year: 2008, watched: true, genres: ['Drama'], scores: { imdb: 9.5 }, updatedAt: 40, seasons: {} },
  'movie:5': { type: 'movie', id: 5, title: 'Untracked Film', year: 2001, watched: false, inWatchlist: false, rating: null, genres: [], scores: {} },
};

const titlesOf = (items) => items.map((i) => i.title);

test('lists only show titles you have engaged with', () => {
  const out = sortMod.applyList(LIST, { sort: 'title' });
  assert.ok(!titlesOf(out).includes('Untracked Film'));
  assert.equal(out.length, 4);
});

test('title sort files leading articles under the real word', () => {
  const out = sortMod.applyList(LIST, { sort: 'title' });
  assert.deepEqual(titlesOf(out), ['Alien', 'Breaking Bad', 'Parasite', 'The Princess Bride']);
});

test('title sort follows the per-title language preference', () => {
  const withPref = {
    ...LIST,
    'movie:2': { ...LIST['movie:2'], titlePref: 'original' },
  };
  // "기생충" sorts after the Latin-alphabet titles.
  const out = sortMod.applyList(withPref, { sort: 'title' });
  assert.equal(titlesOf(out).at(-1), 'Parasite');
});

test('rating sorts put missing scores last, not first', () => {
  const imdb = sortMod.applyList(LIST, { sort: 'imdb' });
  assert.deepEqual(titlesOf(imdb), ['Breaking Bad', 'Parasite', 'The Princess Bride', 'Alien']);

  // Alien and Breaking Bad have no RT score and must sink to the bottom.
  const rt = sortMod.applyList(LIST, { sort: 'rt' });
  assert.deepEqual(titlesOf(rt).slice(0, 2), ['Parasite', 'The Princess Bride']);
  assert.deepEqual(titlesOf(rt).slice(2).sort(), ['Alien', 'Breaking Bad']);
});

test('personal rating sorts liked, then unrated, then disliked', () => {
  const out = sortMod.applyList(LIST, { sort: 'personal' });
  assert.equal(titlesOf(out)[0], 'The Princess Bride');
  assert.equal(titlesOf(out).at(-1), 'Alien');
});

test('other sorts cover the remaining requested orders', () => {
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { sort: 'seen' })).at(-1), 'Parasite');
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { sort: 'unseen' }))[0], 'Parasite');
  assert.equal(sortMod.applyList(LIST, { sort: 'type' }).at(-1).type, 'tv');
  assert.deepEqual(
    sortMod.applyList(LIST, { sort: 'genre' }).map((i) => i.genres[0]),
    ['Adventure', 'Drama', 'Horror', 'Thriller']
  );
  assert.equal(titlesOf(sortMod.applyList(LIST, { sort: 'year' }))[0], 'Parasite');
});

/** Filters as the UI builds them: one Set per group. */
const filters = (groups) => ({ ...sortMod.emptyFilters(), ...Object.fromEntries(
  Object.entries(groups).map(([k, v]) => [k, new Set(v)])
) });

test('filters narrow the list as labelled', () => {
  const pick = (groups) => titlesOf(sortMod.applyList(LIST, { filters: filters(groups) }));
  assert.deepEqual(pick({ status: ['watchlist'] }), ['Parasite']);
  assert.deepEqual(pick({ type: ['tv'] }), ['Breaking Bad']);
  assert.equal(pick({ status: ['watched'] }).length, 3);
  assert.deepEqual(pick({ rating: ['liked'] }), ['The Princess Bride']);
  // No filters at all is not the same as filtering everything out.
  assert.equal(sortMod.applyList(LIST, {}).length, 4);
});

test('picks inside a group widen, picks across groups narrow', () => {
  const pick = (groups) => titlesOf(sortMod.applyList(LIST, { filters: filters(groups) }));

  // Within Type: both media, not neither.
  assert.equal(pick({ type: ['movie', 'tv'] }).length, 4);
  // Across groups: liked AND a film, which is the whole point of grouping.
  assert.deepEqual(pick({ type: ['movie'], rating: ['liked'] }), ['The Princess Bride']);
  // A combination with no overlap is legitimately empty.
  assert.deepEqual(pick({ type: ['tv'], rating: ['liked'] }), []);
});

test('genre options come from the library, most common first', () => {
  const options = sortMod.genreOptions(LIST).map((g) => g.name);
  // Untracked Film has no genres and contributes nothing.
  assert.deepEqual(options.sort(), ['Adventure', 'Drama', 'Horror', 'Thriller']);
  assert.deepEqual(sortMod.genreOptions({}), []);
});

test('the genre group filters on any of the selected genres', () => {
  const pick = (names) => titlesOf(sortMod.applyList(LIST, { filters: filters({ genre: names }) }));
  assert.deepEqual(pick(['Adventure']), ['The Princess Bride']);
  assert.deepEqual(pick(['Adventure', 'Drama']).sort(), ['Breaking Bad', 'The Princess Bride']);
  assert.deepEqual(pick(['Nonexistent']), []);
});

test('the list filter box matches original titles too', () => {
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { query: '기생충' })), ['Parasite']);
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { query: 'bread' })), []);
});

/* ---------- the "one and done" rating ---------- */

// One title at each of the four rating states.
const RATED = {
  'movie:1': { type: 'movie', id: 1, title: 'Loved', watched: true, rating: 'up', genres: ['Drama'] },
  'movie:2': { type: 'movie', id: 2, title: 'Once', watched: true, rating: 'once', genres: ['Drama'] },
  'movie:3': { type: 'movie', id: 3, title: 'Unrated', watched: true, rating: null, genres: ['Drama'] },
  'movie:4': { type: 'movie', id: 4, title: 'Disliked', watched: true, rating: 'down', genres: ['Horror'] },
};

test('“one and done” sorts between liked and unrated', () => {
  const out = sortMod.applyList(RATED, { sort: 'personal' });
  assert.deepEqual(titlesOf(out), ['Loved', 'Once', 'Unrated', 'Disliked']);
});

test('the one-and-done and not-for-me filters select their own titles', () => {
  const pick = (names) => titlesOf(sortMod.applyList(RATED, { filters: filters({ rating: names }) }));
  assert.deepEqual(pick(['once']), ['Once']);
  assert.deepEqual(pick(['disliked']), ['Disliked']);
  // "Liked" must not have widened to include the middle rating.
  assert.deepEqual(pick(['liked']), ['Loved']);
  // Two ratings at once widen, since a title can only carry one.
  assert.deepEqual(pick(['liked', 'once']).sort(), ['Loved', 'Once']);
});

test('tapping “one and done” twice clears it', () => {
  resetStore();
  assert.equal(store.setRating('movie', 550, 'once'), 'once');
  assert.equal(store.setRating('movie', 550, 'once'), null);
  // Switching between ratings replaces rather than clears.
  assert.equal(store.setRating('movie', 550, 'once'), 'once');
  assert.equal(store.setRating('movie', 550, 'down'), 'down');
});

/* ---------- hiding disliked titles ---------- */

test('the hide setting removes “not for me” titles from lists', () => {
  const shown = sortMod.applyList(RATED, { settings: { hideDisliked: true } });
  assert.ok(!titlesOf(shown).includes('Disliked'));
  assert.equal(shown.length, 3);

  // Off by default, and an absent setting must not hide anything.
  assert.equal(sortMod.applyList(RATED, {}).length, 4);
  assert.equal(sortMod.applyList(RATED, { settings: { hideDisliked: false } }).length, 4);
});

test('the “not for me” filter always reveals hidden titles', () => {
  // The escape hatch: without this, hiding a rating would strand it with no way
  // back to the sheet that could change it.
  const out = sortMod.applyList(RATED, {
    filters: filters({ rating: ['disliked'] }),
    settings: { hideDisliked: true },
  });
  assert.deepEqual(titlesOf(out), ['Disliked']);
});

test('hiding only ever touches disliked titles', () => {
  const settings = { hideDisliked: true };
  assert.equal(sortMod.hiddenByPreference({ rating: 'down' }, settings), true);
  for (const rating of ['up', 'once', null, undefined]) {
    assert.equal(sortMod.hiddenByPreference({ rating }, settings), false);
  }
  assert.equal(sortMod.hiddenByPreference({ rating: 'down' }, { hideDisliked: false }), false);
  assert.equal(sortMod.hiddenByPreference({ rating: 'down' }, null), false);
});

/* ---------- recommendations ---------- */

test('genre affinity weighs thumbs down as well as thumbs up', () => {
  const affinity = rec.genreAffinity([
    { rating: 'up', genres: ['Thriller', 'Drama'] },
    { rating: 'up', genres: ['Thriller'] },
    { rating: 'down', genres: ['Horror'] },
    { rating: 'down', genres: ['Drama'] },
    { rating: null, genres: ['Comedy'] },
  ]);
  assert.equal(affinity.Thriller, 1);
  assert.equal(affinity.Horror, -1);
  assert.equal(affinity.Drama, 0); // one up, one down
  assert.equal(affinity.Comedy, undefined); // unrated titles contribute nothing
});

test('“one and done” counts as a half-strength positive for genre', () => {
  const affinity = rec.genreAffinity([
    { rating: 'once', genres: ['Documentary'] },
    { rating: 'once', genres: ['Western'] },
    { rating: 'up', genres: ['Western'] },
  ]);
  // Enjoyed the watch, just not the rewatch — a real but softer signal.
  assert.equal(affinity.Documentary, 0.5);
  assert.equal(affinity.Western, 0.75);
});

test('“one and done” titles never seed a rail, but are never recommended back', () => {
  const items = {
    'movie:1': { type: 'movie', id: 1, rating: 'up', updatedAt: 2 },
    'movie:2': { type: 'movie', id: 2, rating: 'once', updatedAt: 3 },
  };
  // Rails read "Because you liked X" — seeding from a no-rewatch verdict would
  // surface more of exactly what the user said they're done with.
  assert.deepEqual(rec.seedsFrom(items).map((s) => s.id), [1]);
  // But it is still something they've dealt with, so it stays out of the picks.
  assert.ok(rec.excludeSet(items).has('movie:2'));
});

test('candidates recommended by several liked titles outrank one-offs', () => {
  const seedA = { type: 'movie', id: 1, title: 'A' };
  const seedB = { type: 'movie', id: 2, title: 'B' };
  const shared = { type: 'movie', id: 10, title: 'Shared', genres: [] };
  const single = { type: 'movie', id: 11, title: 'Single', genres: [] };

  const ranked = rec.scoreCandidates(
    [
      { seed: seedA, results: [shared, single] },
      { seed: seedB, results: [shared] },
    ],
    {}
  );

  assert.equal(ranked[0].item.title, 'Shared');
  assert.equal(ranked[0].because.length, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('already-handled titles never come back as recommendations', () => {
  const items = {
    'movie:10': { type: 'movie', id: 10, watched: true },
    'movie:11': { type: 'movie', id: 11, rating: 'down' },
    'movie:12': { type: 'movie', id: 12, inWatchlist: true },
  };
  const exclude = rec.excludeSet(items);
  const ranked = rec.scoreCandidates(
    [
      {
        seed: { type: 'movie', id: 1, title: 'A' },
        results: [
          { type: 'movie', id: 10, title: 'Watched', genres: [] },
          { type: 'movie', id: 11, title: 'Disliked', genres: [] },
          { type: 'movie', id: 12, title: 'Listed', genres: [] },
          { type: 'movie', id: 13, title: 'Fresh', genres: [] },
        ],
      },
    ],
    {},
    exclude
  );
  assert.deepEqual(ranked.map((r) => r.item.title), ['Fresh']);
});

test('a genre you consistently dislike is filtered out of picks', () => {
  const affinity = { Horror: -1, Drama: 1 };
  const ranked = rec.scoreCandidates(
    [
      {
        seed: { type: 'movie', id: 1, title: 'A' },
        results: [
          { type: 'movie', id: 20, title: 'Slasher', genres: ['Horror'] },
          { type: 'movie', id: 21, title: 'Weepie', genres: ['Drama'] },
        ],
      },
    ],
    affinity
  );
  assert.deepEqual(ranked.map((r) => r.item.title), ['Weepie']);
});

test('seeds are the most recently liked titles', () => {
  const seeds = rec.seedsFrom({
    a: { rating: 'up', updatedAt: 1 },
    b: { rating: 'up', updatedAt: 3 },
    c: { rating: 'down', updatedAt: 5 },
    d: { rating: 'up', updatedAt: 2 },
  });
  assert.deepEqual(seeds.map((s) => s.updatedAt), [3, 2, 1]);
});

/* ---------- genre catalog ---------- */

test('every genre is queryable somehow, and keys are unique', () => {
  const keys = genres.GENRES.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate genre keys');

  for (const g of genres.GENRES) {
    assert.ok(g.name, `${g.key} has no name`);
    assert.ok(
      g.source || g.movie || g.tv,
      `${g.key} has neither a TMDB id nor an alternative source`
    );
    for (const id of [g.movie, g.tv]) {
      if (id != null) assert.ok(Number.isInteger(id), `${g.key} has a non-integer id`);
    }
  }
});

test('a genre only offers the types TMDB actually has ids for', () => {
  // Horror exists for film but not as a TMDB TV genre.
  assert.deepEqual(genres.availableTypes(genres.findGenre('horror')), ['movie']);
  assert.deepEqual(genres.availableTypes(genres.findGenre('reality')), ['tv']);
  assert.deepEqual(genres.availableTypes(genres.findGenre('drama')), ['movie', 'tv']);
  assert.deepEqual(genres.availableTypes(genres.findGenre('anime')), ['movie', 'tv']);
  assert.deepEqual(genres.availableTypes(null), []);
});

test('movie and TV genre ids differ where TMDB says they do', () => {
  const action = genres.findGenre('action');
  assert.equal(genres.genreIdFor(action, 'movie'), 28);
  assert.equal(genres.genreIdFor(action, 'tv'), 10759); // "Action & Adventure"
});

test('anime is its own tile, and Animation is marked to exclude it', () => {
  assert.equal(genres.findGenre('anime').source, 'anilist');
  assert.equal(genres.findGenre('animation').excludeJapanese, true);
});

/* ---------- genre chips ---------- */

// TMDB's full published genre lists. If a name here doesn't resolve, a chip in
// a detail sheet is a dead one.
const TMDB_MOVIE_GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance',
  'Science Fiction', 'TV Movie', 'Thriller', 'War', 'Western',
];
const TMDB_TV_GENRES = [
  'Action & Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Kids', 'Mystery', 'News', 'Reality', 'Sci-Fi & Fantasy', 'Soap',
  'Talk', 'War & Politics', 'Western',
];

test('every TMDB genre name maps to a browsable genre', () => {
  for (const name of [...TMDB_MOVIE_GENRES, ...TMDB_TV_GENRES]) {
    const key = genres.genreKeyFromName(name);
    assert.ok(key, `"${name}" does not resolve — its chip would be dead`);
    assert.ok(genres.findGenre(key), `"${name}" resolves to missing genre "${key}"`);
  }
});

test('the per-medium genre names both land on the same tile', () => {
  // TMDB names these differently for film and TV; the chip should go to one place.
  assert.equal(genres.genreKeyFromName('Science Fiction'), 'scifi');
  assert.equal(genres.genreKeyFromName('Sci-Fi & Fantasy'), 'scifi');
  assert.equal(genres.genreKeyFromName('Action & Adventure'), 'action');
  assert.equal(genres.genreKeyFromName('War & Politics'), 'war');
});

test('an unrecognised chip resolves to null rather than throwing', () => {
  // AniList tags arrive in the same chip row and must not pretend to be genres.
  for (const name of ['Iyashikei', '', null, undefined, 'Not A Genre']) {
    assert.equal(genres.genreKeyFromName(name), null);
  }
});

/* ---------- affinity ranking ---------- */

test('within a genre, ranking leans on a candidate’s other genres', () => {
  const affinity = { Comedy: -1, Crime: 1 };
  // Both are thrillers; what separates them is the second genre.
  const ranked = rec.rankByAffinity(
    [
      { title: 'Funny thriller', genres: ['Thriller', 'Comedy'] },
      { title: 'Crime thriller', genres: ['Thriller', 'Crime'] },
    ],
    affinity
  );
  assert.deepEqual(ranked.map((r) => r.title), ['Crime thriller', 'Funny thriller']);
});

test('ranking preserves source order when nothing is known about you', () => {
  const items = [{ title: 'A', genres: [] }, { title: 'B', genres: [] }, { title: 'C', genres: [] }];
  assert.deepEqual(rec.rankByAffinity(items, {}).map((i) => i.title), ['A', 'B', 'C']);
  assert.deepEqual(rec.rankByAffinity([], {}), []);
});

/* ---------- anilist ---------- */

const ANILIST_MEDIA = {
  id: 129,
  title: { romaji: 'Sen to Chihiro no Kamikakushi', english: 'Spirited Away', native: '千と千尋の神隠し' },
  format: 'MOVIE',
  episodes: 1,
  seasonYear: 2001,
  averageScore: 87,
  genres: ['Adventure', 'Fantasy'],
  description: 'A young girl <br>wanders into a world of <i>spirits</i>.',
  coverImage: { large: 'https://img.anili.st/129.jpg' },
  studios: { nodes: [{ name: 'Studio Ghibli' }] },
  tags: [
    { name: 'Iyashikei', rank: 78, isGeneralSpoiler: false },
    { name: 'Low rank', rank: 20, isGeneralSpoiler: false },
    { name: 'Spoilery', rank: 95, isGeneralSpoiler: true },
  ],
};

test('an AniList entry becomes an ordinary app item', () => {
  const item = anilist.normalizeAnime(ANILIST_MEDIA);
  assert.equal(item.type, 'movie'); // MOVIE format
  assert.equal(item.title, 'Spirited Away'); // English preferred
  assert.equal(item.originalTitle, 'Sen to Chihiro no Kamikakushi');
  assert.equal(item.foreign, true);
  assert.equal(item.year, 2001);
  assert.equal(item.studio, 'Studio Ghibli');
  assert.equal(item.source, 'anilist');
  // AniList scores out of 100; the app's cells are out of 10.
  assert.equal(item.anilistScore, 8.7);
  // Description markup is stripped, not rendered.
  assert.ok(!/[<>]/.test(item.overview));
  assert.equal(item.overview, 'A young girl wanders into a world of spirits.');
  assert.equal(anilist.normalizeAnime(null), null);
});

test('AniList tags drop spoilers and weakly-voted noise', () => {
  const item = anilist.normalizeAnime(ANILIST_MEDIA);
  assert.deepEqual(item.tags, ['Iyashikei']);
});

test('TV-shaped AniList formats map to the TV type', () => {
  for (const format of ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL']) {
    assert.equal(anilist.normalizeAnime({ ...ANILIST_MEDIA, format }).type, 'tv');
  }
  assert.equal(anilist.normalizeAnime({ ...ANILIST_MEDIA, format: 'MOVIE' }).type, 'movie');
});

test('later cours are collapsed away, but sequel films are not', () => {
  const root = { id: 16498, format: 'TV', relations: { edges: [] } };
  const season2 = {
    id: 20958,
    format: 'TV',
    relations: { edges: [{ relationType: 'PREQUEL', node: { id: 16498, type: 'ANIME', format: 'TV' } }] },
  };
  // A film following a series has a TV prequel too, but is its own TMDB entry.
  const sequelFilm = {
    id: 112151,
    format: 'MOVIE',
    relations: { edges: [{ relationType: 'PREQUEL', node: { id: 101922, type: 'ANIME', format: 'TV' } }] },
  };
  // A sequel edge is not a prequel edge — the root points forward, not back.
  const rootWithSequel = {
    id: 1,
    format: 'TV',
    relations: { edges: [{ relationType: 'SEQUEL', node: { id: 2, type: 'ANIME', format: 'TV' } }] },
  };

  assert.equal(anilist.isContinuation(season2), true);
  assert.equal(anilist.isContinuation(root), false);
  assert.equal(anilist.isContinuation(sequelFilm), false);
  assert.equal(anilist.isContinuation(rootWithSequel), false);

  assert.deepEqual(
    anilist.collapseSeasons([root, season2, sequelFilm]).map((m) => m.id),
    [16498, 112151]
  );
  assert.deepEqual(anilist.collapseSeasons([]), []);
  assert.deepEqual(anilist.collapseSeasons(null), []);
});

test('an adaptation or side story is not treated as a later cour', () => {
  // Only PREQUEL counts; a manga source or spin-off must not collapse the entry.
  for (const relationType of ['ADAPTATION', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'PARENT']) {
    const media = {
      format: 'TV',
      relations: { edges: [{ relationType, node: { id: 9, type: 'ANIME', format: 'TV' } }] },
    };
    assert.equal(anilist.isContinuation(media), false, `${relationType} collapsed the entry`);
  }
});

test('season markers are stripped, but numbers that are part of a title are not', () => {
  const cases = [
    ['Attack on Titan Season 2', 'Attack on Titan'],
    ['Shingeki no Kyojin: The Final Season', 'Shingeki no Kyojin'],
    ['Vinland Saga Season 2', 'Vinland Saga'],
    ['Kaguya-sama: Love is War 2nd Season', 'Kaguya-sama: Love is War'],
    ['Mob Psycho 100 II', 'Mob Psycho 100'],
    ['Some Show Part 2', 'Some Show'],
    ['Some Show Cour 2', 'Some Show'],
    ['Attack on Titan Final Season Part 2', 'Attack on Titan'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(anilist.stripSeasonMarkers(input), expected, `stripping "${input}"`);
  }

  // These digits are the title, not a season number.
  for (const title of ['Steins;Gate 0', 'Mobile Suit Gundam 00', 'Haikyuu!!', 'K-On!']) {
    assert.equal(anilist.stripSeasonMarkers(title), title, `mangled "${title}"`);
  }
  assert.equal(anilist.stripSeasonMarkers(''), '');
  assert.equal(anilist.stripSeasonMarkers(null), '');
});

test('already-seen anime is matched by title, since it has no TMDB id yet', () => {
  const entries = [
    { title: 'Spirited Away', originalTitle: 'Sen to Chihiro no Kamikakushi', year: 2001 },
    { title: 'Your Name.', originalTitle: 'Kimi no Na wa.', year: 2016 },
    { title: 'Demon Slayer', originalTitle: 'Kimetsu no Yaiba', year: 2019 },
  ];
  const stored = {
    // Stored under its TMDB id, which no AniList entry carries.
    'movie:129': { title: 'Spirited Away', year: 2001, rating: 'once' },
    // Punctuation differs between the two sources, and the year drifts by one.
    'movie:372058': { title: 'Your Name', year: 2017, watched: true },
    // Untracked: seen it in the API but never engaged with, so not "seen".
    'tv:85937': { title: 'Demon Slayer', year: 2019 },
  };

  const left = anilist.rejectSeen(entries, stored).map((e) => e.title);
  assert.deepEqual(left, ['Demon Slayer']);
});

test('title matching does not reject on year alone', () => {
  const entries = [{ title: 'Trigun', originalTitle: '', year: 1998 }];
  // Same year, different show — must survive.
  const stored = { 'tv:1': { title: 'Cowboy Bebop', year: 1998, watched: true } };
  assert.equal(anilist.rejectSeen(entries, stored).length, 1);
  // Nothing tracked at all: everything survives.
  assert.equal(anilist.rejectSeen(entries, {}).length, 1);
});

test('anime detection is narrow enough not to fire on lookalikes', () => {
  const anime = { originalLanguage: 'ja', genres: ['Animation', 'Fantasy'] };
  assert.equal(anilist.looksLikeAnime(anime), true);

  // Japanese, but live action.
  assert.equal(anilist.looksLikeAnime({ originalLanguage: 'ja', genres: ['Drama'] }), false);
  // Animated, but not Japanese.
  assert.equal(anilist.looksLikeAnime({ originalLanguage: 'en', genres: ['Animation'] }), false);
  assert.equal(anilist.looksLikeAnime({ originalLanguage: 'ja', genres: [] }), false);
  assert.equal(anilist.looksLikeAnime(null), false);
});

/* ---------- sync merge ---------- */

test('sync keeps the newest edit per title, not per device', () => {
  const local = {
    items: {
      'movie:1': { type: 'movie', id: 1, rating: 'up', updatedAt: 200 },
      'movie:2': { type: 'movie', id: 2, watched: false, updatedAt: 50 },
      'movie:3': { type: 'movie', id: 3, watched: true, updatedAt: 10 },
    },
    settings: { defaultTitleLang: 'original' },
  };
  const remote = {
    items: {
      'movie:1': { type: 'movie', id: 1, rating: 'down', updatedAt: 100 },
      'movie:2': { type: 'movie', id: 2, watched: true, updatedAt: 150 },
      'tv:9': { type: 'tv', id: 9, watched: true, updatedAt: 120 },
    },
    settings: { defaultTitleLang: 'en' },
  };

  const merged = sync.mergeData(local, remote);
  assert.equal(merged.items['movie:1'].rating, 'up'); // local is newer
  assert.equal(merged.items['movie:2'].watched, true); // remote is newer
  assert.equal(merged.items['movie:3'].watched, true); // local only
  assert.equal(merged.items['tv:9'].watched, true); // remote only
  assert.equal(merged.settings.defaultTitleLang, 'original'); // local edited last
});

test('background score fetches survive losing an edit race', () => {
  // Scores are written with touch:false, so they must merge on their own
  // freshness rather than being dropped with the losing item.
  const merged = sync.mergeData(
    {
      items: {
        'movie:1': { id: 1, rating: 'up', updatedAt: 100, scores: { imdb: 8.5, fetchedAt: 999 } },
      },
    },
    {
      items: {
        'movie:1': { id: 1, rating: 'down', updatedAt: 500, scores: { imdb: null, fetchedAt: 1 } },
      },
    }
  );
  assert.equal(merged.items['movie:1'].rating, 'down');
  assert.equal(merged.items['movie:1'].scores.imdb, 8.5);
});

/* ---------- omdb parsing ---------- */

test('IMDb and Rotten Tomatoes are pulled out of an OMDb payload', () => {
  const parsed = omdb.parseOmdb({
    imdbRating: '8.5',
    Ratings: [
      { Source: 'Internet Movie Database', Value: '8.5/10' },
      { Source: 'Rotten Tomatoes', Value: '99%' },
      { Source: 'Metacritic', Value: '96/100' },
    ],
  });
  assert.equal(parsed.imdb, 8.5);
  assert.equal(parsed.rt, 99);
});

test('missing scores parse to null rather than a fake number', () => {
  // The common shape for TV series: an IMDb rating but no RT entry.
  assert.deepEqual(omdb.parseOmdb({ imdbRating: '9.5', Ratings: [] }), { imdb: 9.5, rt: null });
  assert.deepEqual(omdb.parseOmdb({ imdbRating: 'N/A', Ratings: [] }), { imdb: null, rt: null });
  assert.deepEqual(omdb.parseOmdb({ Response: 'False' }), { imdb: null, rt: null });
  assert.equal(omdb.parseRotten(undefined), null);
});

/* ---------- press-and-hold rating ---------- */

const VIEWPORT = { width: 390, height: 844 };
const POP = { width: 240, height: 68 };

test('the rating options sit above the poster when there is room', () => {
  const tile = { top: 400, bottom: 640, left: 100, right: 280, width: 180 };
  const spot = lp.placePopover(tile, POP, VIEWPORT);
  assert.equal(spot.placement, 'above');
  assert.equal(spot.y, 400 - 10 - POP.height);
  // Centred on the tile.
  assert.equal(spot.x, 100 + 90 - POP.width / 2);
});

test('they flip below a poster too near the top to fit above', () => {
  const tile = { top: 20, bottom: 260, left: 100, right: 280, width: 180 };
  const spot = lp.placePopover(tile, POP, VIEWPORT);
  assert.equal(spot.placement, 'below');
  assert.equal(spot.y, 270);
});

test('they stay on screen for tiles in the edge columns', () => {
  // Left column: centring would put x negative.
  const left = lp.placePopover(
    { top: 400, bottom: 640, left: 0, right: 180, width: 180 }, POP, VIEWPORT
  );
  assert.equal(left.x, 8);

  // Right column: centring would run off the right edge.
  const right = lp.placePopover(
    { top: 400, bottom: 640, left: 210, right: 390, width: 180 }, POP, VIEWPORT
  );
  assert.equal(right.x, VIEWPORT.width - POP.width - 8);
});

test('a very tall popover is still pinned inside the viewport', () => {
  const spot = lp.placePopover(
    { top: 10, bottom: 800, left: 100, right: 280, width: 180 },
    { width: 240, height: 200 },
    VIEWPORT
  );
  assert.ok(spot.y + 200 <= VIEWPORT.height, `bottom ${spot.y + 200} exceeds viewport`);
});

test('the option under the finger is the one that gets picked', () => {
  const rects = [
    { kind: 'up', rect: { left: 0, right: 70, top: 0, bottom: 56 } },
    { kind: 'once', rect: { left: 80, right: 150, top: 0, bottom: 56 } },
    { kind: 'down', rect: { left: 160, right: 230, top: 0, bottom: 56 } },
  ];
  assert.equal(lp.pickOption({ x: 35, y: 28 }, rects), 'up');
  assert.equal(lp.pickOption({ x: 115, y: 28 }, rects), 'once');
  assert.equal(lp.pickOption({ x: 200, y: 28 }, rects), 'down');
  // In the gap between two options, and far away: no selection, so releasing
  // there cancels rather than picking something at random.
  assert.equal(lp.pickOption({ x: 75, y: 28 }, rects), null);
  assert.equal(lp.pickOption({ x: 35, y: 300 }, rects), null);
  assert.equal(lp.pickOption({ x: 35, y: 28 }, []), null);
});

test('a small wobble is a hold, a real drag is a scroll', () => {
  const start = { x: 100, y: 100 };
  assert.equal(lp.movedTooFar(start, { x: 103, y: 104 }), false);
  assert.equal(lp.movedTooFar(start, { x: 100, y: 130 }), true);
  // Diagonal movement counts too — it's a distance, not per-axis.
  assert.equal(lp.movedTooFar(start, { x: 109, y: 109 }), true);
});

/* ---------- diagnostics ---------- */

test('a rejected TMDB key and an unreachable TMDB are different problems', () => {
  assert.equal(diag.classifyTmdb({ valid: true }).status, 'ok');

  const rejected = diag.classifyTmdb({ error: { status: 401, message: 'nope' } });
  assert.equal(rejected.status, 'error');
  assert.match(rejected.detail, /key/i);

  // A network failure must not read as "your key is wrong" — different fix.
  const offline = diag.classifyTmdb({ error: { status: 0, message: 'Network error reaching TMDB.' } });
  assert.equal(offline.status, 'error');
  assert.doesNotMatch(offline.detail, /key/i);

  assert.equal(diag.classifyTmdb({ valid: false }).status, 'error');
});

test('OMDb distinguishes a bad key from any other refusal', () => {
  const badKey = diag.classifyOmdb({ payload: { Response: 'False', Error: 'Invalid API key!' } });
  assert.equal(badKey.status, 'error');
  assert.match(badKey.detail, /key/i);

  const other = diag.classifyOmdb({ payload: { Response: 'False', Error: 'Movie not found!' } });
  assert.equal(other.status, 'error');
  assert.equal(other.detail, 'Movie not found!');

  const ok = diag.classifyOmdb({ payload: { Response: 'True', imdbRating: '9.3' } });
  assert.equal(ok.status, 'ok');
  // Exhausted quota looks like an outage from outside, so surface the count.
  assert.match(ok.detail, /lookups left today/);
});

test('an AniList error carried inside a 200 response still counts as failure', () => {
  // GraphQL reports failures in-band, so HTTP status alone would say "fine".
  const inBand = diag.classifyAnilist({ data: { errors: [{ message: 'Too Many Requests' }] } });
  assert.equal(inBand.status, 'error');
  assert.equal(inBand.detail, 'Too Many Requests');

  assert.equal(diag.classifyAnilist({ data: { Media: { id: 1 } } }).status, 'ok');
  assert.equal(diag.classifyAnilist({ data: {} }).status, 'error');
  assert.equal(diag.classifyAnilist({ error: new Error('offline') }).status, 'error');
});

test('a missing optional key is skipped, not reported as broken', async () => {
  resetStore();
  store.secrets.tmdbKey = '';
  store.secrets.omdbKey = '';

  const results = new Map();
  await diag.runChecks((id, result) => results.set(id, result));

  // No key means "not configured", which is not the same as "failing".
  assert.equal(results.get('omdb').status, 'skipped');
  assert.match(results.get('omdb').detail, /optional/i);
  assert.equal(results.get('tmdb').status, 'skipped');
  // AniList needs no key, so it is never skipped for want of one.
  assert.notEqual(results.get('anilist').status, 'skipped');
});

test('every service is described well enough to act on', () => {
  const ids = diag.CHECKS.map((c) => c.id);
  assert.deepEqual(ids, ['tmdb', 'omdb', 'anilist']);
  for (const check of diag.CHECKS) {
    assert.ok(check.label && check.purpose, `${check.id} is missing a label or purpose`);
    assert.equal(typeof check.run, 'function');
  }
});

/* ---------- export safety ---------- */

test('exports and sync payloads never contain API keys', () => {
  resetStore();
  store.secrets.tmdbKey = 'SECRET-TMDB';
  store.secrets.omdbKey = 'SECRET-OMDB';
  store.secrets.githubToken = 'SECRET-TOKEN';
  store.setRating('movie', 550, 'up');

  const dump = store.exportData();
  assert.ok(dump.includes('movie:550'));
  for (const secret of ['SECRET-TMDB', 'SECRET-OMDB', 'SECRET-TOKEN']) {
    assert.ok(!dump.includes(secret), `export leaked ${secret}`);
  }
});
