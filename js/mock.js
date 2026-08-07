/* Fixture mode: append ?mock=1 to the URL.
 *
 * Returns canned TMDB/OMDb payloads so the whole app can be exercised without
 * API keys or network — used for automated screenshots and for poking at the UI
 * before you've signed up for keys. Shapes mirror the real APIs exactly, so the
 * normalization layer is what's actually under test.
 *
 * The fixture set is chosen to cover the tricky cases:
 *   Parasite    — foreign film, gets the EN/original title toggle
 *   Princess Bride — English film, must NOT get a toggle
 *   Breaking Bad   — 5 real seasons plus a specials season that must stay hidden
 *   Squid Game     — foreign series, toggle + seasons together
 */

let mockFlag = null;

export function isMock() {
  if (mockFlag === null) {
    try {
      mockFlag =
        new URLSearchParams(location.search).get('mock') === '1' ||
        localStorage.getItem('wl.mock') === '1';
    } catch {
      mockFlag = false;
    }
  }
  return mockFlag;
}

const GENRES = {
  18: 'Drama', 53: 'Thriller', 35: 'Comedy', 80: 'Crime', 12: 'Adventure',
  14: 'Fantasy', 10749: 'Romance', 9648: 'Mystery', 878: 'Science Fiction',
  28: 'Action', 10759: 'Action & Adventure', 10765: 'Sci-Fi & Fantasy',
};

const genreList = Object.entries(GENRES).map(([id, name]) => ({ id: Number(id), name }));

const MOVIES = {
  496243: {
    id: 496243,
    title: 'Parasite',
    original_title: '기생충',
    original_language: 'ko',
    release_date: '2019-05-30',
    poster_path: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
    overview:
      'All unemployed, Ki-taek and his family take peculiar interest in the wealthy Parks, until they get entangled in an unexpected incident.',
    vote_average: 8.5,
    popularity: 92.4,
    imdb_id: 'tt6751668',
    genres: [{ id: 35, name: 'Comedy' }, { id: 53, name: 'Thriller' }, { id: 18, name: 'Drama' }],
  },
  2493: {
    id: 2493,
    title: 'The Princess Bride',
    original_title: 'The Princess Bride',
    original_language: 'en',
    release_date: '1987-09-25',
    poster_path: '/dvjqlp2sAhUeFjUOfQDgqwpphHj.jpg',
    overview:
      'A kindly grandfather reads a bedtime story of a farmhand turned pirate rescuing his true love from a scheming prince.',
    vote_average: 7.7,
    popularity: 41.2,
    imdb_id: 'tt0093779',
    genres: [{ id: 12, name: 'Adventure' }, { id: 14, name: 'Fantasy' }, { id: 10749, name: 'Romance' }],
  },
  120467: {
    id: 120467,
    title: 'The Grand Budapest Hotel',
    original_title: 'The Grand Budapest Hotel',
    original_language: 'en',
    release_date: '2014-02-26',
    poster_path: '/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg',
    overview:
      'The adventures of a legendary concierge and the lobby boy who becomes his most trusted friend.',
    vote_average: 8.0,
    popularity: 55.1,
    imdb_id: 'tt2278388',
    genres: [{ id: 35, name: 'Comedy' }, { id: 18, name: 'Drama' }],
  },
  129: {
    id: 129,
    title: 'Spirited Away',
    original_title: '千と千尋の神隠し',
    original_language: 'ja',
    release_date: '2001-07-20',
    poster_path: '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg',
    overview:
      'A young girl wanders into a world of spirits and must work to free her parents and find her way home.',
    vote_average: 8.5,
    popularity: 78.9,
    imdb_id: 'tt0245429',
    // Animated AND Japanese, so the Animation tile must exclude it and the
    // Anime tile must be where it shows up.
    genres: [{ id: 16, name: 'Animation' }, { id: 14, name: 'Fantasy' }, { id: 12, name: 'Adventure' }],
  },
  862: {
    id: 862,
    title: 'Toy Story',
    original_title: 'Toy Story',
    original_language: 'en',
    release_date: '1995-11-22',
    poster_path: '/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg',
    overview:
      'A cowboy doll is profoundly threatened when a new spaceman action figure supplants him as top toy.',
    vote_average: 8.0,
    popularity: 60.4,
    imdb_id: 'tt0114709',
    // Animated but not Japanese — the control case for the Animation tile.
    genres: [{ id: 16, name: 'Animation' }, { id: 10751, name: 'Family' }, { id: 35, name: 'Comedy' }],
  },
  680: {
    id: 680,
    title: 'Pulp Fiction',
    original_title: 'Pulp Fiction',
    original_language: 'en',
    release_date: '1994-09-10',
    poster_path: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
    overview:
      'The lives of two mob hitmen, a boxer and a pair of diner bandits intertwine in four tales of violence.',
    vote_average: 8.5,
    popularity: 88.3,
    imdb_id: 'tt0110912',
    genres: [{ id: 53, name: 'Thriller' }, { id: 80, name: 'Crime' }],
  },
};

const TV = {
  1396: {
    id: 1396,
    name: 'Breaking Bad',
    original_name: 'Breaking Bad',
    original_language: 'en',
    first_air_date: '2008-01-20',
    poster_path: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
    overview:
      'A high school chemistry teacher diagnosed with terminal cancer turns to manufacturing methamphetamine to secure his family’s future.',
    vote_average: 8.9,
    popularity: 210.5,
    number_of_seasons: 5,
    number_of_episodes: 62,
    genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
    external_ids: { imdb_id: 'tt0903747' },
    seasons: [
      // Season 0 exists on the real record and must stay out of the UI.
      { season_number: 0, episode_count: 9, name: 'Specials', air_date: '2009-02-17' },
      { season_number: 1, episode_count: 7, name: 'Season 1', air_date: '2008-01-20' },
      { season_number: 2, episode_count: 13, name: 'Season 2', air_date: '2009-03-08' },
      { season_number: 3, episode_count: 13, name: 'Season 3', air_date: '2010-03-21' },
      { season_number: 4, episode_count: 13, name: 'Season 4', air_date: '2011-07-17' },
      { season_number: 5, episode_count: 16, name: 'Season 5', air_date: '2012-07-15' },
    ],
  },
  93405: {
    id: 93405,
    name: 'Squid Game',
    original_name: '오징어 게임',
    original_language: 'ko',
    first_air_date: '2021-09-17',
    poster_path: '/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg',
    overview:
      'Hundreds of cash-strapped players accept a strange invitation to compete in children’s games for a tempting prize — with deadly stakes.',
    vote_average: 7.8,
    popularity: 180.2,
    number_of_seasons: 2,
    number_of_episodes: 16,
    genres: [{ id: 18, name: 'Drama' }, { id: 9648, name: 'Mystery' }, { id: 10759, name: 'Action & Adventure' }],
    external_ids: { imdb_id: 'tt10919420' },
    seasons: [
      { season_number: 1, episode_count: 9, name: 'Season 1', air_date: '2021-09-17' },
      { season_number: 2, episode_count: 7, name: 'Season 2', air_date: '2024-12-26' },
    ],
  },
  66732: {
    id: 66732,
    name: 'Stranger Things',
    original_name: 'Stranger Things',
    original_language: 'en',
    first_air_date: '2016-07-15',
    poster_path: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    overview:
      'When a young boy vanishes, a small town uncovers a mystery involving secret experiments and one strange little girl.',
    vote_average: 8.6,
    popularity: 195.0,
    number_of_seasons: 4,
    number_of_episodes: 34,
    genres: [{ id: 18, name: 'Drama' }, { id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 9648, name: 'Mystery' }],
    external_ids: { imdb_id: 'tt4574334' },
    seasons: [
      { season_number: 1, episode_count: 8, name: 'Season 1', air_date: '2016-07-15' },
      { season_number: 2, episode_count: 9, name: 'Season 2', air_date: '2017-10-27' },
      { season_number: 3, episode_count: 8, name: 'Season 3', air_date: '2019-07-04' },
      { season_number: 4, episode_count: 9, name: 'Season 4', air_date: '2022-05-27' },
    ],
  },
};

const EPISODE_TITLES = {
  '1396:1': ['Pilot', "Cat's in the Bag...", "...And the Bag's in the River", 'Cancer Man', 'Gray Matter', 'Crazy Handful of Nothin\'', 'A No-Rough-Stuff-Type Deal'],
  '93405:1': ['Red Light, Green Light', 'Hell', 'The Man with the Umbrella', 'Stick to the Team', 'A Fair World', 'Gganbu', 'VIPS', 'Front Man', 'One Lucky Day'],
};

const CAST = {
  496243: [
    { id: 20738, name: 'Song Kang-ho', character: 'Kim Ki-taek', profile_path: '/susAKtLW6manaBoQOoiRZ2z6Vs4.jpg' },
    { id: 1338965, name: 'Choi Woo-shik', character: 'Kim Ki-woo', profile_path: '/z7Fnb0hHnCg6QqPmqzZq9Nqjxrf.jpg' },
    { id: 1451644, name: 'Park So-dam', character: 'Kim Ki-jung', profile_path: null },
    { id: 20736, name: 'Lee Sun-kyun', character: 'Park Dong-ik', profile_path: null },
  ],
  2493: [
    { id: 3061, name: 'Cary Elwes', character: 'Westley', profile_path: null },
    { id: 6486, name: 'Robin Wright', character: 'Buttercup', profile_path: null },
    { id: 4517, name: 'Mandy Patinkin', character: 'Inigo Montoya', profile_path: null },
    { id: 5563, name: 'André the Giant', character: 'Fezzik', profile_path: null },
  ],
  1396: [
    { id: 17419, name: 'Bryan Cranston', character: 'Walter White', profile_path: '/7Jahy5LZX2Fo8fGJltMreAI49hC.jpg' },
    { id: 84497, name: 'Aaron Paul', character: 'Jesse Pinkman', profile_path: null },
    { id: 134531, name: 'Anna Gunn', character: 'Skyler White', profile_path: null },
  ],
};

const PEOPLE = {
  20738: {
    id: 20738,
    name: 'Song Kang-ho',
    profile_path: '/susAKtLW6manaBoQOoiRZ2z6Vs4.jpg',
    known_for_department: 'Acting',
    biography: 'South Korean actor known for his collaborations with Bong Joon-ho and Park Chan-wook.',
    credits: [
      { media_type: 'movie', id: 496243, title: 'Parasite', original_title: '기생충', original_language: 'ko', release_date: '2019-05-30', vote_average: 8.5, popularity: 92.4, poster_path: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', character: 'Kim Ki-taek', genre_ids: [35, 53, 18] },
      { media_type: 'movie', id: 11423, title: 'Memories of Murder', original_title: '살인의 추억', original_language: 'ko', release_date: '2003-04-25', vote_average: 8.1, popularity: 30.2, poster_path: null, character: 'Park Doo-man', genre_ids: [80, 18] },
      { media_type: 'movie', id: 8967, title: 'The Host', original_title: '괴물', original_language: 'ko', release_date: '2006-07-27', vote_average: 7.0, popularity: 25.8, poster_path: null, character: 'Park Gang-du', genre_ids: [878, 18] },
      { media_type: 'movie', id: 110416, title: 'Snowpiercer', original_title: '설국열차', original_language: 'en', release_date: '2013-08-01', vote_average: 6.8, popularity: 48.0, poster_path: null, character: 'Namgoong Minsoo', genre_ids: [878, 28] },
      { media_type: 'movie', id: 4550, title: 'Thirst', original_title: '박쥐', original_language: 'ko', release_date: '2009-04-30', vote_average: 6.9, popularity: 14.1, poster_path: null, character: 'Sang-hyun', genre_ids: [18, 53] },
    ],
  },
  17419: {
    id: 17419,
    name: 'Bryan Cranston',
    profile_path: '/7Jahy5LZX2Fo8fGJltMreAI49hC.jpg',
    known_for_department: 'Acting',
    biography: 'American actor, best known as Walter White in Breaking Bad.',
    credits: [
      { media_type: 'tv', id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', original_language: 'en', first_air_date: '2008-01-20', vote_average: 8.9, popularity: 210.5, poster_path: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', character: 'Walter White', episode_count: 62, genre_ids: [18, 80] },
      { media_type: 'movie', id: 49018, title: 'Drive', original_title: 'Drive', original_language: 'en', release_date: '2011-09-15', vote_average: 7.6, popularity: 52.3, poster_path: null, character: 'Shannon', genre_ids: [80, 18] },
      { media_type: 'movie', id: 205596, title: 'Trumbo', original_title: 'Trumbo', original_language: 'en', release_date: '2015-11-06', vote_average: 7.2, popularity: 18.4, poster_path: null, character: 'Dalton Trumbo', genre_ids: [18] },
    ],
  },
};

const OMDB = {
  tt6751668: { imdbRating: '8.5', Ratings: [{ Source: 'Rotten Tomatoes', Value: '99%' }] },
  tt0093779: { imdbRating: '8.0', Ratings: [{ Source: 'Rotten Tomatoes', Value: '97%' }] },
  tt2278388: { imdbRating: '8.1', Ratings: [{ Source: 'Rotten Tomatoes', Value: '92%' }] },
  tt0245429: { imdbRating: '8.6', Ratings: [{ Source: 'Rotten Tomatoes', Value: '97%' }] },
  tt0114709: { imdbRating: '8.3', Ratings: [{ Source: 'Rotten Tomatoes', Value: '100%' }] },
  tt0110912: { imdbRating: '8.9', Ratings: [{ Source: 'Rotten Tomatoes', Value: '92%' }] },
  // No Rotten Tomatoes entry — the realistic case for series, renders as "—".
  tt0903747: { imdbRating: '9.5', Ratings: [] },
  tt10919420: { imdbRating: '8.0', Ratings: [] },
  tt4574334: { imdbRating: '8.7', Ratings: [] },
};

/* Availability fixtures, chosen to exercise every rendering branch:
 *   Parasite       all four rows, and a provider in both `free` and `ads`
 *   Princess Bride rent/buy only — no way to stream it
 *   Breaking Bad   subscription streaming only
 *   Spirited Away  nothing at all, i.e. the empty state
 */
const PROVIDERS = {
  netflix: { provider_id: 8, provider_name: 'Netflix', logo_path: '/net.jpg', display_priority: 0 },
  prime: { provider_id: 9, provider_name: 'Amazon Prime Video', logo_path: '/prime.jpg', display_priority: 2 },
  hulu: { provider_id: 15, provider_name: 'Hulu', logo_path: '/hulu.jpg', display_priority: 4 },
  max: { provider_id: 1899, provider_name: 'Max', logo_path: '/max.jpg', display_priority: 1 },
  appletv: { provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple.jpg', display_priority: 3 },
  amazon: { provider_id: 10, provider_name: 'Amazon Video', logo_path: '/amz.jpg', display_priority: 5 },
  google: { provider_id: 3, provider_name: 'Google Play Movies', logo_path: '/gp.jpg', display_priority: 8 },
  tubi: { provider_id: 73, provider_name: 'Tubi TV', logo_path: '/tubi.jpg', display_priority: 12 },
  pluto: { provider_id: 300, provider_name: 'Pluto TV', logo_path: '/pluto.jpg', display_priority: 10 },
};

const WATCH = {
  'movie:496243': {
    link: 'https://www.themoviedb.org/movie/496243/watch?locale=US',
    // Deliberately out of display_priority order, so the sort is exercised.
    flatrate: [PROVIDERS.hulu, PROVIDERS.max, PROVIDERS.netflix],
    free: [PROVIDERS.tubi],
    // Tubi appears in both lists on the real API; it must not render twice.
    ads: [PROVIDERS.tubi, PROVIDERS.pluto],
    rent: [PROVIDERS.appletv, PROVIDERS.amazon],
    buy: [PROVIDERS.appletv, PROVIDERS.amazon, PROVIDERS.google],
  },
  'movie:2493': {
    link: 'https://www.themoviedb.org/movie/2493/watch?locale=US',
    rent: [PROVIDERS.appletv, PROVIDERS.amazon],
    buy: [PROVIDERS.appletv, PROVIDERS.google],
  },
  'tv:1396': {
    link: 'https://www.themoviedb.org/tv/1396/watch?locale=US',
    flatrate: [PROVIDERS.netflix],
  },
  'tv:93405': {
    link: 'https://www.themoviedb.org/tv/93405/watch?locale=US',
    flatrate: [PROVIDERS.netflix],
    buy: [PROVIDERS.google],
  },
};

/* AniList fixtures for the Anime tile and detail-sheet enrichment. Spirited
 * Away is deliberately present in both TMDB and AniList so the enrichment path
 * (TMDB sheet + AniList score/studio/tags) can be exercised end to end. */
const ANILIST = [
  {
    id: 129,
    title: { romaji: 'Sen to Chihiro no Kamikakushi', english: 'Spirited Away', native: '千と千尋の神隠し' },
    format: 'MOVIE',
    episodes: 1,
    seasonYear: 2001,
    averageScore: 87,
    genres: ['Adventure', 'Fantasy'],
    description: 'A young girl wanders into a world of spirits and must work to free her parents.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'Studio Ghibli' }] },
    tags: [
      { name: 'Iyashikei', rank: 78, isGeneralSpoiler: false },
      { name: 'Coming of Age', rank: 71, isGeneralSpoiler: false },
      { name: 'Shapeshifting', rank: 40, isGeneralSpoiler: false },
      { name: 'Secret Identity', rank: 90, isGeneralSpoiler: true },
    ],
  },
  {
    id: 16498,
    title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
    format: 'TV',
    episodes: 25,
    seasonYear: 2013,
    averageScore: 85,
    genres: ['Action', 'Drama', 'Fantasy'],
    description: 'Humanity fights for survival against man-eating giants.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'Wit Studio' }] },
    tags: [{ name: 'Survival', rank: 88, isGeneralSpoiler: false }],
  },
  {
    id: 21519,
    title: { romaji: 'Kimi no Na wa.', english: 'Your Name.', native: '君の名は。' },
    format: 'MOVIE',
    episodes: 1,
    seasonYear: 2016,
    averageScore: 85,
    genres: ['Romance', 'Drama'],
    description: 'Two teenagers discover they are swapping bodies across time.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'CoMix Wave Films' }] },
    tags: [{ name: 'Time Skip', rank: 80, isGeneralSpoiler: false }],
  },
  {
    id: 101922,
    title: { romaji: 'Kimetsu no Yaiba', english: 'Demon Slayer', native: '鬼滅の刃' },
    format: 'TV',
    episodes: 26,
    seasonYear: 2019,
    averageScore: 83,
    genres: ['Action', 'Fantasy'],
    description: 'A boy becomes a demon slayer to avenge his family and cure his sister.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'ufotable' }] },
    tags: [{ name: 'Swordplay', rank: 85, isGeneralSpoiler: false }],
  },
  // A later cour: AniList lists it separately, TMDB folds it into the one show.
  // Must not appear in the Anime tile.
  {
    id: 20958,
    title: { romaji: 'Shingeki no Kyojin Season 2', english: 'Attack on Titan Season 2', native: '進撃の巨人 Season2' },
    format: 'TV',
    episodes: 12,
    seasonYear: 2017,
    averageScore: 84,
    genres: ['Action', 'Drama'],
    description: 'The fight against the titans continues.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'Wit Studio' }] },
    tags: [{ name: 'Survival', rank: 88, isGeneralSpoiler: false }],
    relations: { edges: [{ relationType: 'PREQUEL', node: { id: 16498, type: 'ANIME', format: 'TV' } }] },
  },
  // A film following a series: also has a TV prequel, but has its own TMDB
  // entry, so collapsing must NOT drop it.
  {
    id: 112151,
    title: { romaji: 'Kimetsu no Yaiba: Mugen Ressha-hen', english: 'Demon Slayer: Mugen Train', native: '劇場版 鬼滅の刃 無限列車編' },
    format: 'MOVIE',
    episodes: 1,
    seasonYear: 2020,
    averageScore: 83,
    genres: ['Action', 'Fantasy'],
    description: 'Tanjiro and the Flame Hashira board a train haunted by a demon.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'ufotable' }] },
    tags: [{ name: 'Swordplay', rank: 82, isGeneralSpoiler: false }],
    relations: { edges: [{ relationType: 'PREQUEL', node: { id: 101922, type: 'ANIME', format: 'TV' } }] },
  },
  // Nothing on TMDB matches this: exercises the AniList-only sheet.
  {
    id: 999001,
    title: { romaji: 'Yofukashi no Nazonazo', english: '', native: '夜更かしのなぞなぞ' },
    format: 'ONA',
    episodes: 12,
    seasonYear: 2024,
    averageScore: 68,
    genres: ['Comedy'],
    description: 'A short-form riddle series with no TMDB entry.',
    coverImage: { large: '' },
    studios: { nodes: [{ name: 'Studio Nowhere' }] },
    tags: [{ name: 'Episodic', rank: 75, isGeneralSpoiler: false }],
  },
];

const REGIONS = [
  { iso_3166_1: 'US', english_name: 'United States of America' },
  { iso_3166_1: 'GB', english_name: 'United Kingdom' },
  { iso_3166_1: 'CA', english_name: 'Canada' },
  { iso_3166_1: 'AU', english_name: 'Australia' },
  { iso_3166_1: 'DE', english_name: 'Germany' },
];

function watchFor(type, id) {
  const entry = WATCH[`${type}:${id}`];
  // A title with no availability still returns a well-formed payload with an
  // empty results map — that is what TMDB does, and what the empty state reads.
  return { id: Number(id), results: entry ? { US: entry } : {} };
}

const RECS = {
  'movie:496243': [129, 120467, 680],
  'movie:2493': [120467, 680],
  'movie:129': [496243, 120467],
  'movie:120467': [680, 496243],
  'movie:680': [496243, 120467],
  'tv:1396': [66732, 93405],
  'tv:93405': [1396, 66732],
  'tv:66732': [1396, 93405],
};

/* ---------- routing ---------- */

function episodesFor(tvId, seasonNumber) {
  const show = TV[tvId];
  const meta = (show?.seasons || []).find((s) => s.season_number === seasonNumber);
  const count = meta?.episode_count || 0;
  const titles = EPISODE_TITLES[`${tvId}:${seasonNumber}`] || [];
  return Array.from({ length: count }, (_, i) => ({
    episode_number: i + 1,
    name: titles[i] || `Episode ${i + 1}`,
    overview: `Season ${seasonNumber}, episode ${i + 1} of ${show?.name || 'the series'}. A short synopsis stands in for the real one in fixture mode.`,
    air_date: `20${String(10 + seasonNumber).slice(-2)}-0${((i % 9) + 1)}-01`,
    runtime: 47,
  }));
}

function asResult(raw, type) {
  return { ...raw, media_type: type };
}

function allResults() {
  return [
    ...Object.values(MOVIES).map((m) => asResult(m, 'movie')),
    ...Object.values(TV).map((t) => asResult(t, 'tv')),
  ];
}

function byId(id) {
  return MOVIES[id] ? asResult(MOVIES[id], 'movie') : TV[id] ? asResult(TV[id], 'tv') : null;
}

export function mockFetch(path, params = {}) {
  const delay = (value) => new Promise((r) => setTimeout(() => r(value), 60));

  if (path === '/genre/movie/list' || path === '/genre/tv/list') {
    return delay({ genres: genreList });
  }

  if (path === '/watch/providers/regions') {
    return delay({ results: REGIONS });
  }

  if (path === '/watch/providers/movie' || path === '/watch/providers/tv') {
    return delay({ results: Object.values(PROVIDERS) });
  }

  let m = path.match(/^\/discover\/(movie|tv)$/);
  if (m) {
    const type = m[1];
    const wanted = Number(params.with_genres);
    const results = allResults()
      .filter((r) => r.media_type === type)
      .filter((r) => (r.genres || []).some((g) => g.id === wanted));
    return delay({ results, total_results: results.length });
  }

  if (path === '/search/multi') {
    const q = String(params.query || '').toLowerCase();
    const results = allResults().filter((r) =>
      [r.title, r.name, r.original_title, r.original_name]
        .filter(Boolean)
        .some((t) => t.toLowerCase().includes(q))
    );
    return delay({ results, total_results: results.length });
  }

  if (path === '/trending/all/week') {
    return delay({ results: allResults() });
  }

  m = path.match(/^\/(movie|tv)\/(\d+)\/recommendations$/);
  if (m) {
    const ids = RECS[`${m[1]}:${m[2]}`] || [];
    return delay({ results: ids.map(byId).filter(Boolean) });
  }

  m = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/);
  if (m) {
    const [, tvId, sn] = m;
    return delay({
      name: `Season ${sn}`,
      overview: '',
      episodes: episodesFor(Number(tvId), Number(sn)),
    });
  }

  m = path.match(/^\/movie\/(\d+)$/);
  if (m) {
    const raw = MOVIES[m[1]];
    if (!raw) return Promise.reject(new Error('not found'));
    const recIds = RECS[`movie:${m[1]}`] || [];
    return delay({
      ...raw,
      credits: { cast: CAST[m[1]] || [] },
      external_ids: { imdb_id: raw.imdb_id },
      'watch/providers': watchFor('movie', m[1]),
      recommendations: { results: recIds.map(byId).filter(Boolean) },
    });
  }

  m = path.match(/^\/tv\/(\d+)$/);
  if (m) {
    const raw = TV[m[1]];
    if (!raw) return Promise.reject(new Error('not found'));
    const recIds = RECS[`tv:${m[1]}`] || [];
    return delay({
      ...raw,
      credits: { cast: CAST[m[1]] || [] },
      'watch/providers': watchFor('tv', m[1]),
      recommendations: { results: recIds.map(byId).filter(Boolean) },
    });
  }

  m = path.match(/^\/person\/(\d+)$/);
  if (m) {
    const p = PEOPLE[m[1]];
    if (!p) return Promise.reject(new Error('not found'));
    return delay({ ...p, combined_credits: { cast: p.credits } });
  }

  if (path === '/configuration') return delay({ images: {} });

  return Promise.reject(new Error(`mock: unhandled path ${path}`));
}

export function mockOmdb(imdbId) {
  return OMDB[imdbId] || { Response: 'False', Error: 'Movie not found!' };
}

/** AniList is POSTed as GraphQL rather than going through mockFetch's routing. */
export function mockAnilist(query, variables = {}) {
  const delay = (value) => new Promise((r) => setTimeout(() => r(value), 60));

  if (/Page\s*\(/.test(query)) {
    const formats = variables.format_in || [];
    let media = ANILIST.filter((m) => !formats.length || formats.includes(m.format));
    if (variables.tag) {
      media = media.filter((m) => (m.tags || []).some((t) => t.name === variables.tag));
    }
    return delay({ Page: { media } });
  }

  const term = String(variables.search || '').toLowerCase();
  const hit = ANILIST.find((m) =>
    [m.title.romaji, m.title.english, m.title.native]
      .filter(Boolean)
      .some((t) => t.toLowerCase().includes(term) || term.includes(t.toLowerCase()))
  );
  return delay({ Media: hit || null });
}
