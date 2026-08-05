/* AniList — anime metadata to supplement TMDB.
 *
 * Free, no API key, no auth for public queries, 90 requests/minute. Used
 * because TMDB handles anime poorly: it lumps cours into arbitrary "seasons",
 * has no anime-specific tags, and Rotten Tomatoes essentially never scores it.
 *
 * (AniDB was the other candidate and is unusable here: no CORS, a registered
 * client id required on every request, one request per two seconds, and bans
 * for re-fetching. All of it assumes a server, which this app doesn't have.)
 *
 * TMDB ids remain the app's primary key. AniList is a supplement and never a
 * parallel identity — otherwise watch state, watchlists, providers and Gist
 * sync would each fragment across two id spaces.
 */

import { cached } from './idb.js';
import { search as tmdbSearch } from './tmdb.js';
import { isMock, mockAnilist } from './mock.js';

const ENDPOINT = 'https://graphql.anilist.co';
const DAY = 24 * 60 * 60 * 1000;

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  format
  episodes
  seasonYear
  averageScore
  genres
  description(asHtml: false)
  coverImage { large }
  studios(isMain: true) { nodes { name } }
  tags { name rank isGeneralSpoiler }
`;

const BROWSE_QUERY = `
  query ($page: Int, $perPage: Int, $format_in: [MediaFormat]) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, format_in: $format_in) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const MATCH_QUERY = `
  query ($search: String) {
    Media(type: ANIME, search: $search, sort: SEARCH_MATCH) {
      ${MEDIA_FIELDS}
    }
  }
`;

async function gql(query, variables) {
  if (isMock()) return mockAnilist(query, variables);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) throw new Error('AniList rate limit reached — try again in a minute.');
  if (!res.ok) throw new Error(`AniList returned ${res.status}.`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message || 'AniList query failed.');
  return body.data;
}

/**
 * One uncached round trip, for the Settings health check. Uncached on purpose:
 * `cached()` would answer from IndexedDB and mask an outage.
 */
export function ping() {
  return gql('{ Media(id: 1, type: ANIME) { id } }', {});
}

/* ---------- normalization ---------- */

/** AniList's MediaFormat values, mapped onto the app's movie/tv split. */
const MOVIE_FORMATS = ['MOVIE'];
const TV_FORMATS = ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL'];

function formatsFor(type) {
  if (type === 'movie') return MOVIE_FORMATS;
  if (type === 'tv') return TV_FORMATS;
  return [...MOVIE_FORMATS, ...TV_FORMATS];
}

/** AniList descriptions carry a little HTML even with asHtml:false. */
function stripHtml(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * An AniList entry in the app's item shape, so the existing tile renderer and
 * grid work unchanged. `source: 'anilist'` marks it as not yet resolved to a
 * TMDB id — openItem() resolves it on tap.
 */
export function normalizeAnime(media) {
  if (!media) return null;
  const english = media.title?.english || '';
  const romaji = media.title?.romaji || '';
  const native = media.title?.native || '';
  const primary = english || romaji || native;
  const original = romaji && romaji !== primary ? romaji : native;

  return {
    source: 'anilist',
    anilistId: media.id,
    type: media.format === 'MOVIE' ? 'movie' : 'tv',
    id: `al${media.id}`,
    title: primary || 'Untitled',
    originalTitle: original || '',
    originalLanguage: 'ja',
    foreign: Boolean(original && original !== primary),
    year: media.seasonYear || null,
    poster: media.coverImage?.large || null,
    genres: media.genres || [],
    overview: stripHtml(media.description).slice(0, 400),
    episodes: media.episodes || null,
    // AniList scores out of 100; the app's score cells are out of 10.
    anilistScore: media.averageScore != null ? media.averageScore / 10 : null,
    studio: media.studios?.nodes?.[0]?.name || '',
    tags: (media.tags || [])
      .filter((t) => !t.isGeneralSpoiler && (t.rank ?? 0) >= 60)
      .slice(0, 4)
      .map((t) => t.name),
  };
}

/* ---------- queries ---------- */

/** Popular anime, for the Anime tile in the Genres tab. One request. */
export async function browseAnime({ type = 'all', page = 1, perPage = 40 } = {}) {
  const formats = formatsFor(type);
  const data = await cached(`anilist:browse:${type}:${page}`, 12 * 60 * 60 * 1000, () =>
    gql(BROWSE_QUERY, { page, perPage, format_in: formats })
  );
  return (data?.Page?.media || []).map(normalizeAnime).filter(Boolean);
}

/**
 * Resolve an AniList entry to a TMDB id so it can open the normal detail sheet.
 *
 * Done on tap rather than while rendering a grid: resolving 40 tiles up front
 * would be 40 TMDB searches, against one for the title actually opened.
 */
export async function resolveToTmdb(entry) {
  if (!entry?.anilistId) return null;
  const key = `anilist:tmdb:${entry.anilistId}`;

  return cached(key, 90 * DAY, async () => {
    for (const title of [entry.title, entry.originalTitle].filter(Boolean)) {
      let results;
      try {
        results = await tmdbSearch(title);
      } catch {
        return null;
      }
      const candidates = results.filter(
        (r) => r.type === entry.type && r.originalLanguage === 'ja'
      );
      // Prefer an exact year match; anime titles get remade and rebooted often.
      const exact = candidates.find((r) => entry.year && r.year === entry.year);
      const hit = exact || candidates[0];
      if (hit) return { type: hit.type, id: hit.id };
    }
    return null;
  });
}

/* ---------- matching against the library ---------- */

/** Loose enough to survive punctuation and spacing differences between sources. */
function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9　-鿿가-힯]+/g, '');
}

/**
 * Drop AniList entries the user has already dealt with.
 *
 * The usual exclusion in recommend.js keys on `type:tmdbId`, which an
 * unresolved AniList entry doesn't have — so without this, "new to me" would
 * silently do nothing on the Anime tile. Matching on title and year instead
 * keeps it free: resolving every tile to a TMDB id up front would be one search
 * per tile, which is exactly what the lazy resolution exists to avoid.
 */
export function rejectSeen(entries, storedItems) {
  const seen = new Map();
  for (const item of Object.values(storedItems || {})) {
    if (!item.watched && !item.inWatchlist && !item.rating) continue;
    for (const title of [item.title, item.originalTitle]) {
      const key = titleKey(title);
      if (key) seen.set(key, item.year ?? null);
    }
  }
  if (!seen.size) return entries;

  return entries.filter((entry) => {
    for (const title of [entry.title, entry.originalTitle]) {
      const key = titleKey(title);
      if (!key || !seen.has(key)) continue;
      const storedYear = seen.get(key);
      // Anime release years drift by one between sources (season vs air date).
      if (storedYear == null || entry.year == null) return false;
      if (Math.abs(storedYear - entry.year) <= 1) return false;
    }
    return true;
  });
}

/* ---------- enrichment ---------- */

/**
 * Whether a TMDB title is anime, and so worth an AniList lookup.
 *
 * Japanese origin plus the Animation genre. Deliberately narrow: it must not
 * fire for Japanese live action (Kurosawa) or for Western cartoons.
 */
export function looksLikeAnime(meta) {
  return Boolean(
    meta &&
      meta.originalLanguage === 'ja' &&
      (meta.genres || []).some((g) => /animation/i.test(g))
  );
}

/** AniList data for a TMDB title, or null. Never throws — this is a bonus. */
export async function enrich(meta) {
  if (!looksLikeAnime(meta)) return null;
  const term = meta.originalTitle || meta.title;
  if (!term) return null;

  try {
    const data = await cached(`anilist:match:${meta.type}:${meta.id}`, 30 * DAY, () =>
      gql(MATCH_QUERY, { search: term })
    );
    return normalizeAnime(data?.Media);
  } catch (err) {
    console.warn('[anilist] enrichment failed', err);
    return null;
  }
}
