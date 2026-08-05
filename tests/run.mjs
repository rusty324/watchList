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

const store = await import('../js/store.js');
const tmdb = await import('../js/tmdb.js');
const sortMod = await import('../js/sort.js');
const rec = await import('../js/recommend.js');
const sync = await import('../js/sync.js');
const omdb = await import('../js/omdb.js');

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

test('filters narrow the list as labelled', () => {
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { filter: 'watchlist' })), ['Parasite']);
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { filter: 'tv' })), ['Breaking Bad']);
  assert.equal(sortMod.applyList(LIST, { filter: 'watched' }).length, 3);
  assert.deepEqual(titlesOf(sortMod.applyList(LIST, { filter: 'liked' })), ['The Princess Bride']);
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
  assert.deepEqual(titlesOf(sortMod.applyList(RATED, { filter: 'once' })), ['Once']);
  assert.deepEqual(titlesOf(sortMod.applyList(RATED, { filter: 'disliked' })), ['Disliked']);
  // "Liked" must not have widened to include the middle rating.
  assert.deepEqual(titlesOf(sortMod.applyList(RATED, { filter: 'liked' })), ['Loved']);
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
    filter: 'disliked',
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
