/* TMDB client + normalization.
 *
 * Everything the UI renders goes through the `normalize*` functions below, so
 * views never touch raw API shapes and the mock fixtures only have to match the
 * API, not the app.
 */

import { secrets, state } from './store.js';
import { cached, cacheGet, cacheSet } from './idb.js';
import { isMock, mockFetch } from './mock.js';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const MIN = 60 * 1000;
const TTL = {
  search: 10 * MIN,
  detail: 24 * 60 * MIN,
  season: 7 * 24 * 60 * MIN,
  person: 7 * 24 * 60 * MIN,
  recs: 7 * 24 * 60 * MIN,
  trending: 6 * 60 * MIN,
  genres: 30 * 24 * 60 * MIN,
};

const inflight = new Map();

export class TmdbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

export function hasTmdbKey() {
  return Boolean(secrets.tmdbKey) || isMock();
}

async function request(path, params = {}) {
  if (isMock()) return mockFetch(path, params);
  if (!secrets.tmdbKey) throw new TmdbError('No TMDB API key set.', 0);

  const url = new URL(BASE + path);
  url.searchParams.set('api_key', secrets.tmdbKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  const dedupKey = url.toString();
  if (inflight.has(dedupKey)) return inflight.get(dedupKey);

  const promise = (async () => {
    let res;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (err) {
      throw new TmdbError('Network error reaching TMDB.', 0);
    }
    if (res.status === 401) throw new TmdbError('TMDB rejected your API key.', 401);
    if (res.status === 404) throw new TmdbError('Not found on TMDB.', 404);
    if (res.status === 429) throw new TmdbError('TMDB rate limit hit — try again shortly.', 429);
    if (!res.ok) throw new TmdbError(`TMDB error ${res.status}.`, res.status);
    return res.json();
  })().finally(() => inflight.delete(dedupKey));

  inflight.set(dedupKey, promise);
  return promise;
}

/* ---------- images ---------- */

export function posterUrl(path, size = 'w185') {
  if (!path) return null;
  // AniList hands back absolute cover URLs; TMDB hands back bare paths.
  if (/^https?:\/\//.test(path)) return path;
  if (isMock()) return null; // fixtures render placeholders, no network
  return `${IMG}/${size}${path}`;
}

export function profileUrl(path, size = 'w185') {
  return posterUrl(path, size);
}

/* ---------- genres ---------- */

let genreMapPromise = null;

/** id -> name, merged across movie and tv lists. */
export async function genreMap() {
  if (genreMapPromise) return genreMapPromise;
  genreMapPromise = (async () => {
    const hit = await cacheGet('genres');
    if (hit) return hit;
    const [movie, tv] = await Promise.all([
      request('/genre/movie/list'),
      request('/genre/tv/list'),
    ]);
    const map = {};
    for (const g of [...(movie.genres || []), ...(tv.genres || [])]) map[g.id] = g.name;
    await cacheSet('genres', map, TTL.genres);
    return map;
  })().catch((err) => {
    genreMapPromise = null;
    throw err;
  });
  return genreMapPromise;
}

/* ---------- normalization ---------- */

const yearOf = (date) => {
  const y = parseInt(String(date || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

/**
 * A title toggle only makes sense for films that weren't made in English AND
 * whose original title actually differs. This is what keeps English-language
 * releases (The Princess Bride and friends) from sprouting a pointless toggle.
 */
export function hasForeignTitle(englishTitle, originalTitle, originalLanguage) {
  return Boolean(
    originalLanguage &&
      originalLanguage !== 'en' &&
      originalTitle &&
      englishTitle &&
      originalTitle.trim() !== englishTitle.trim()
  );
}

export function normalizeMovie(raw, genres) {
  return {
    type: 'movie',
    id: raw.id,
    title: raw.title || raw.original_title || 'Untitled',
    originalTitle: raw.original_title || '',
    originalLanguage: raw.original_language || '',
    foreign: hasForeignTitle(raw.title, raw.original_title, raw.original_language),
    year: yearOf(raw.release_date),
    poster: raw.poster_path || null,
    genres: genreNames(raw, genres),
    overview: raw.overview || '',
    imdbId: raw.imdb_id || raw.external_ids?.imdb_id || null,
    tmdbScore: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null,
    popularity: raw.popularity || 0,
  };
}

export function normalizeTv(raw, genres) {
  const seasonMeta = (raw.seasons || [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      n: s.season_number,
      episodes: s.episode_count || 0,
      name: s.name || `Season ${s.season_number}`,
      year: yearOf(s.air_date),
    }))
    .sort((a, b) => a.n - b.n);

  return {
    type: 'tv',
    id: raw.id,
    title: raw.name || raw.original_name || 'Untitled',
    originalTitle: raw.original_name || '',
    originalLanguage: raw.original_language || '',
    foreign: hasForeignTitle(raw.name, raw.original_name, raw.original_language),
    year: yearOf(raw.first_air_date),
    poster: raw.poster_path || null,
    genres: genreNames(raw, genres),
    overview: raw.overview || '',
    imdbId: raw.external_ids?.imdb_id || null,
    tmdbScore: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null,
    popularity: raw.popularity || 0,
    seasonMeta,
    // Derived from the season list rather than `number_of_seasons` so it always
    // agrees with what the dropdown shows once specials are dropped.
    seasonCount: seasonMeta.length || raw.number_of_seasons || 0,
    episodeCount:
      seasonMeta.reduce((n, s) => n + s.episodes, 0) || raw.number_of_episodes || 0,
  };
}

function genreNames(raw, genres) {
  if (Array.isArray(raw.genres) && raw.genres.length) return raw.genres.map((g) => g.name);
  if (Array.isArray(raw.genre_ids) && genres) {
    return raw.genre_ids.map((id) => genres[id]).filter(Boolean);
  }
  return [];
}

/** search/multi and recommendation rows are lighter; same shape, fewer fields. */
export function normalizeResult(raw, genres) {
  if (raw.media_type === 'person' || (!raw.media_type && raw.known_for_department)) {
    return {
      type: 'person',
      id: raw.id,
      title: raw.name,
      poster: raw.profile_path || null,
      popularity: raw.popularity || 0,
      knownFor: (raw.known_for || []).map((k) => k.title || k.name).filter(Boolean),
    };
  }
  const isTv = raw.media_type === 'tv' || (!raw.media_type && (raw.name || raw.first_air_date));
  return isTv ? normalizeTv(raw, genres) : normalizeMovie(raw, genres);
}

/* ---------- endpoints ---------- */

export async function search(query, page = 1) {
  const q = query.trim();
  if (!q) return [];
  const [data, genres] = await Promise.all([
    cached(`search:${q}:${page}`, TTL.search, () =>
      request('/search/multi', { query: q, page, include_adult: 'true' })
    ),
    genreMap().catch(() => ({})),
  ]);
  return (data.results || [])
    .filter((r) => r.media_type !== 'person' || (r.known_for || []).length)
    .map((r) => normalizeResult(r, genres));
}

export async function trending() {
  const [data, genres] = await Promise.all([
    cached('trending', TTL.trending, () => request('/trending/all/week')),
    genreMap().catch(() => ({})),
  ]);
  return (data.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => normalizeResult(r, genres));
}

// Watch providers ride along on the detail call — no extra request. The cache
// key carries a version because entries stored before providers were requested
// would otherwise serve a sheet with no availability box for a full TTL.detail.
const DETAIL_APPEND = 'credits,external_ids,recommendations,watch/providers';

export async function movieDetail(id) {
  const raw = await cached(`movie:v2:${id}`, TTL.detail, () =>
    request(`/movie/${id}`, { append_to_response: DETAIL_APPEND })
  );
  const genres = await genreMap().catch(() => ({}));
  return {
    ...normalizeMovie(raw, genres),
    cast: (raw.credits?.cast || []).slice(0, 10).map(normalizeCastMember),
    providers: normalizeProviders(raw['watch/providers'], resolveRegion()),
    recommendations: (raw.recommendations?.results || [])
      .slice(0, 20)
      .map((r) => normalizeResult({ ...r, media_type: r.media_type || 'movie' }, genres)),
  };
}

export async function tvDetail(id) {
  const raw = await cached(`tv:v2:${id}`, TTL.detail, () =>
    request(`/tv/${id}`, { append_to_response: DETAIL_APPEND })
  );
  const genres = await genreMap().catch(() => ({}));
  return {
    ...normalizeTv(raw, genres),
    cast: (raw.credits?.cast || []).slice(0, 10).map(normalizeCastMember),
    providers: normalizeProviders(raw['watch/providers'], resolveRegion()),
    recommendations: (raw.recommendations?.results || [])
      .slice(0, 20)
      .map((r) => normalizeResult({ ...r, media_type: r.media_type || 'tv' }, genres)),
  };
}

/* ---------- watch providers ---------- */

/** The country whose availability to show: saved setting, else locale, else US. */
export function resolveRegion() {
  const saved = state.settings.region;
  if (saved) return saved;
  try {
    const region = new Intl.Locale(navigator.language).region;
    if (region) return region.toUpperCase();
  } catch {
    /* Intl.Locale is unavailable or the tag is malformed */
  }
  return 'US';
}

function mapProviders(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
    .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path || null }));
}

function dedupeById(list) {
  const seen = new Set();
  return (list || []).filter((p) => !seen.has(p.provider_id) && seen.add(p.provider_id));
}

/**
 * Flatten TMDB's per-country availability into the four rows the sheet shows.
 *
 * Availability is region-scoped, and a title missing from a region is the
 * ordinary case rather than an error — obscure and unreleased titles are simply
 * absent — so this returns empty lists instead of throwing.
 */
export function normalizeProviders(payload, region) {
  const forRegion = payload?.results?.[region];
  if (!forRegion) return { region, link: null, stream: [], free: [], rent: [], buy: [] };
  return {
    region,
    link: forRegion.link || null,
    stream: mapProviders(forRegion.flatrate),
    // Ad-supported and genuinely free are one proposition to a viewer, and a
    // provider can legitimately appear in both lists. Merge before sorting, so
    // the combined row still comes out in display_priority order.
    free: mapProviders(dedupeById([...(forRegion.free || []), ...(forRegion.ads || [])])),
    rent: mapProviders(forRegion.rent),
    buy: mapProviders(forRegion.buy),
  };
}

export function hasAnyProvider(providers) {
  return Boolean(
    providers &&
      (providers.stream.length || providers.free.length || providers.rent.length || providers.buy.length)
  );
}

/** Countries TMDB has availability data for, for the Settings picker. */
export async function watchRegions() {
  const data = await cached('watch-regions', TTL.genres, () =>
    request('/watch/providers/regions')
  );
  return (data.results || [])
    .map((r) => ({ code: r.iso_3166_1, name: r.english_name || r.native_name || r.iso_3166_1 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Providers available in a region, most prominent first, for "My services". */
export async function providersForRegion(region) {
  const data = await cached(`watch-providers:${region}`, TTL.genres, () =>
    request('/watch/providers/movie', { watch_region: region })
  );
  return mapProviders(data.results);
}

function normalizeCastMember(c) {
  return {
    id: c.id,
    name: c.name,
    character: c.character || '',
    profile: c.profile_path || null,
  };
}

export async function seasonDetail(tvId, seasonNumber) {
  const raw = await cached(`season:${tvId}:${seasonNumber}`, TTL.season, () =>
    request(`/tv/${tvId}/season/${seasonNumber}`)
  );
  return {
    seasonNumber,
    name: raw.name || `Season ${seasonNumber}`,
    overview: raw.overview || '',
    episodes: (raw.episodes || []).map((e) => ({
      number: e.episode_number,
      title: e.name || `Episode ${e.episode_number}`,
      overview: e.overview || '',
      airDate: e.air_date || null,
      runtime: e.runtime || null,
    })),
  };
}

export async function personCredits(personId) {
  const [raw, genres] = await Promise.all([
    cached(`person:${personId}`, TTL.person, () =>
      request(`/person/${personId}`, { append_to_response: 'combined_credits' })
    ),
    genreMap().catch(() => ({})),
  ]);

  // A performer can appear twice for the same title (dual roles, or a credit
  // listed per season); collapse to one row per title.
  const seen = new Map();
  for (const c of raw.combined_credits?.cast || []) {
    const key = `${c.media_type}:${c.id}`;
    if (seen.has(key)) continue;
    const item = normalizeResult(c, genres);
    item.character = c.character || '';
    item.episodeCount = c.episode_count || null;
    seen.set(key, item);
  }

  return {
    id: raw.id,
    name: raw.name,
    profile: raw.profile_path || null,
    biography: raw.biography || '',
    knownForDepartment: raw.known_for_department || '',
    credits: [...seen.values()],
  };
}

/**
 * Popular titles in a genre.
 *
 * `vote_count.gte` keeps the long tail of near-unrated entries out; TMDB's
 * popularity sort otherwise surfaces a lot of noise in the smaller genres.
 */
export async function discoverByGenre(type, genreId, { page = 1 } = {}) {
  const [data, genres] = await Promise.all([
    cached(`discover:${type}:${genreId}:${page}`, TTL.trending, () =>
      request(`/discover/${type}`, {
        with_genres: genreId,
        sort_by: 'popularity.desc',
        include_adult: 'true',
        'vote_count.gte': type === 'movie' ? 200 : 50,
        page,
      })
    ),
    genreMap().catch(() => ({})),
  ]);
  return (data.results || []).map((r) => normalizeResult({ ...r, media_type: type }, genres));
}

export async function recommendationsFor(type, id) {
  const [data, genres] = await Promise.all([
    cached(`recs:${type}:${id}`, TTL.recs, () => request(`/${type}/${id}/recommendations`)),
    genreMap().catch(() => ({})),
  ]);
  return (data.results || []).map((r) =>
    normalizeResult({ ...r, media_type: r.media_type || type }, genres)
  );
}

/** Used by Settings to validate a pasted key before saving it. */
export async function validateKey(key) {
  if (isMock()) return true;
  const url = new URL(`${BASE}/configuration`);
  url.searchParams.set('api_key', key);
  const res = await fetch(url);
  if (res.ok) return true;
  if (res.status === 401) return false;
  throw new TmdbError(`TMDB returned ${res.status}.`, res.status);
}
