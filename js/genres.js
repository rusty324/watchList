/* The genre catalog behind the Genres tab.
 *
 * This is a static table rather than something derived from the genre-list
 * endpoints, because TMDB's genre ids are not shared between movies and TV —
 * Action is 28
 * for film but 10759 ("Action & Adventure") for TV — and several genres exist
 * for only one of the two. A single merged id->name map, which is what
 * `genreMap()` in tmdb.js provides for labelling, can't express that.
 *
 * The ids are TMDB's documented, stable genre ids.
 */

export const GENRES = [
  { key: 'action', name: 'Action', movie: 28, tv: 10759, hue: 5 },
  { key: 'adventure', name: 'Adventure', movie: 12, tv: 10759, hue: 28 },
  // Anime comes from AniList, not TMDB — see js/anilist.js. TMDB has no anime
  // genre, only "Animation", which mixes Ghibli in with Pixar.
  { key: 'anime', name: 'Anime', source: 'anilist', hue: 320 },
  // ...so Animation here means "animated, but not anime".
  { key: 'animation', name: 'Animation', movie: 16, tv: 16, excludeJapanese: true, hue: 260 },
  { key: 'comedy', name: 'Comedy', movie: 35, tv: 35, hue: 45 },
  { key: 'crime', name: 'Crime', movie: 80, tv: 80, hue: 220 },
  { key: 'documentary', name: 'Documentary', movie: 99, tv: 99, hue: 190 },
  { key: 'drama', name: 'Drama', movie: 18, tv: 18, hue: 350 },
  { key: 'family', name: 'Family', movie: 10751, tv: 10751, hue: 95 },
  { key: 'fantasy', name: 'Fantasy', movie: 14, tv: 10765, hue: 280 },
  { key: 'history', name: 'History', movie: 36, tv: null, hue: 35 },
  { key: 'horror', name: 'Horror', movie: 27, tv: null, hue: 0 },
  { key: 'kids', name: 'Kids', movie: null, tv: 10762, hue: 145 },
  { key: 'music', name: 'Music', movie: 10402, tv: null, hue: 300 },
  { key: 'mystery', name: 'Mystery', movie: 9648, tv: 9648, hue: 240 },
  { key: 'news', name: 'News', movie: null, tv: 10763, hue: 210 },
  { key: 'reality', name: 'Reality', movie: null, tv: 10764, hue: 165 },
  { key: 'romance', name: 'Romance', movie: 10749, tv: null, hue: 335 },
  { key: 'scifi', name: 'Sci-Fi', movie: 878, tv: 10765, hue: 200 },
  { key: 'soap', name: 'Soap', movie: null, tv: 10766, hue: 310 },
  { key: 'talk', name: 'Talk', movie: null, tv: 10767, hue: 175 },
  { key: 'thriller', name: 'Thriller', movie: 53, tv: null, hue: 15 },
  { key: 'tvmovie', name: 'TV Movie', movie: 10770, tv: null, hue: 230 },
  { key: 'war', name: 'War', movie: 10752, tv: 10768, hue: 60 },
  { key: 'western', name: 'Western', movie: 37, tv: 37, hue: 20 },
];

/**
 * TMDB genre names that don't equal a catalog name.
 *
 * The two genre lists don't agree with each other: TV calls sci-fi "Sci-Fi &
 * Fantasy" and merges action with adventure, so a plain name lookup would leave
 * those chips dead.
 */
const NAME_ALIASES = {
  'science fiction': 'scifi',
  'sci-fi & fantasy': 'scifi',
  'sci-fi': 'scifi',
  'action & adventure': 'action',
  'war & politics': 'war',
  'kids': 'kids',
  'tv movie': 'tvmovie',
};

const BY_NAME = new Map(GENRES.map((g) => [g.name.toLowerCase(), g.key]));

/** Genre key for a TMDB genre name, or null if it isn't one we can browse. */
export function genreKeyFromName(name) {
  if (!name) return null;
  const needle = String(name).trim().toLowerCase();
  return NAME_ALIASES[needle] || BY_NAME.get(needle) || null;
}

export function findGenre(key) {
  return GENRES.find((g) => g.key === key) || null;
}

/** Which of Movies / TV a genre can actually offer. */
export function availableTypes(genre) {
  if (!genre) return [];
  if (genre.source === 'anilist') return ['movie', 'tv'];
  return [genre.movie ? 'movie' : null, genre.tv ? 'tv' : null].filter(Boolean);
}

export function genreIdFor(genre, type) {
  return type === 'tv' ? genre.tv : genre.movie;
}
