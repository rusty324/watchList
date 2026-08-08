/* Genres tab: a grid of genres, and recommendations within the one you pick.
 *
 * Two states in one view, keyed off the sub-route (`#/genres` vs
 * `#/genres/horror`), so picking a genre is a history entry and the back
 * gesture returns to the grid.
 */

import { h, icon, clear, fill, grid, skeletonGrid, emptyState } from '../ui.js';
import { state, getItem, hasKeys } from '../store.js';
import { discoverByGenre, hasTmdbKey } from '../tmdb.js';
import { browseAnime, browseByTag, rejectSeen } from '../anilist.js';
import { GENRES, findGenre, availableTypes, genreIdFor } from '../genres.js';
import { excludeSet, genreAffinity, rankByAffinity } from '../recommend.js';
import { suppressed } from '../sort.js';
import { openItem } from './detail.js';
import { openSettings } from './settings.js';

const storedFor = (item) => getItem(item.type, item.id);

// Kept across renders so returning to a genre restores the filters you set.
const ui = { type: 'all', unseenOnly: true };

export function renderGenres(root, segments) {
  clear(root);
  const [key, type] = segments || [];
  if (!key) return renderCatalog(root);

  // A chip carries its medium through (#/genres/drama/tv), so a TV show's Drama
  // opens filtered to TV rather than resetting to whatever was last used.
  if (type === 'movie' || type === 'tv') ui.type = type;

  // AniList tags are browsable but aren't TMDB genres, so they ride a prefixed
  // sub-route rather than pretending to be a catalog key.
  if (key.startsWith('tag:')) {
    return renderResults(root, {
      key,
      name: decodeURIComponent(key.slice(4)),
      source: 'anilist',
      tag: decodeURIComponent(key.slice(4)),
    });
  }

  const genre = findGenre(key);
  if (!genre) {
    fill(root, emptyState({ title: 'Unknown genre', body: 'That genre no longer exists.' }));
    return;
  }
  renderResults(root, genre);
}

/* ---------- the genre grid ---------- */

function renderCatalog(root) {
  root.append(
    h(
      'div',
      { style: 'display:flex;align-items:center;gap:10px' },
      h('h1', { class: 'page-title', style: 'flex:1;margin-bottom:12px' }, 'Genres'),
      h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: () => openSettings() },
        icon('settings')
      )
    ),
    h('p', { class: 'section-sub' }, 'Pick a genre for picks you haven’t seen yet.'),
    h(
      'div',
      { class: 'genre-grid' },
      GENRES.map((genre) =>
        h(
          'a',
          {
            class: 'genre-tile',
            href: `#/genres/${genre.key}`,
            style: `--g-hue:${genre.hue}`,
          },
          h('span', {}, genre.name),
          genre.source === 'anilist' ? h('em', { class: 'g-src' }, 'AniList') : null
        )
      )
    )
  );
}

/* ---------- a genre's results ---------- */

function renderResults(root, genre) {
  const types = availableTypes(genre);
  // A genre TMDB only has for film shouldn't offer a TV filter that can only
  // ever come back empty.
  if (!types.includes(ui.type) && ui.type !== 'all') ui.type = 'all';

  const results = h('div', {});

  const typeChips = [
    types.length > 1 ? ['all', 'All'] : null,
    types.includes('movie') ? ['movie', 'Movies'] : null,
    types.includes('tv') ? ['tv', 'TV'] : null,
  ].filter(Boolean);

  const chips = h(
    'div',
    { class: 'chips' },
    typeChips.map(([value, label]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          dataset: { type: value },
          'aria-pressed': String(ui.type === value),
          onclick: () => {
            ui.type = value;
            for (const c of chips.children) {
              c.setAttribute('aria-pressed', String(c.dataset.type === value));
            }
            load(results, genre);
          },
        },
        label
      )
    ),
    h('span', { class: 'chip-gap' }),
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        dataset: { seen: 'toggle' },
        'aria-pressed': String(!ui.unseenOnly),
        onclick: (event) => {
          ui.unseenOnly = !ui.unseenOnly;
          event.currentTarget.setAttribute('aria-pressed', String(!ui.unseenOnly));
          event.currentTarget.textContent = ui.unseenOnly ? 'Show all' : 'New to me only';
          load(results, genre);
        },
      },
      ui.unseenOnly ? 'Show all' : 'New to me only'
    )
  );

  root.append(
    h(
      'div',
      { class: 'genre-head' },
      h(
        'a',
        { class: 'icon-btn', href: '#/genres', 'aria-label': 'All genres' },
        icon('back')
      ),
      h('h1', { class: 'page-title', style: 'flex:1;margin:0' }, genre.name)
    ),
    chips,
    results
  );

  load(results, genre);
}

async function load(host, genre) {
  if (!hasTmdbKey()) {
    fill(host,
      emptyState({
        iconName: 'settings',
        title: 'Add your TMDB key',
        body: 'Genre picks need your own free TMDB key.',
        action: h('button', { class: 'btn', type: 'button', onclick: () => openSettings() }, 'Set up keys'),
      })
    );
    return;
  }

  fill(host, skeletonGrid(6));
  const token = ++loadToken;

  const exclude = ui.unseenOnly ? excludeSet(state.items) : new Set();
  const affinity = genreAffinity(Object.values(state.items));
  const keep = [];
  const seen = new Set();
  let pagesRead = 0;

  // Keep asking for pages until enough survive the exclusion. Without this a
  // genre you've worked through says "nothing new" forever, because only the
  // first page was ever fetched — and the more of a genre you've seen, the more
  // certain that is to happen.
  for (let page = 1; page <= MAX_PAGES && keep.length < TARGET; page++) {
    let batch;
    let empty;
    try {
      ({ items: batch, empty } = await fetchForGenre(genre, page));
    } catch (err) {
      if (token !== loadToken) return;
      // A later page failing after earlier ones worked isn't worth throwing the
      // results away for.
      if (keep.length) break;
      fill(host, emptyState({ title: 'Could not load picks', body: err?.message || String(err) }));
      return;
    }
    // Checked every page, not just at the end: the loop widens the window in
    // which a newer tap can overtake this one.
    if (token !== loadToken) return;

    pagesRead = page;
    // Only stop when the source itself is out. A page that came back full but
    // filtered down to nothing still has pages after it.
    if (empty) break;

    // AniList entries have no TMDB id yet, so the id-keyed exclusion below
    // can't see them — they need matching by title instead.
    if (genre.source === 'anilist' && ui.unseenOnly) batch = rejectSeen(batch, state.items);

    for (const item of batch) {
      const key = `${item.type}:${item.id}`;
      // TMDB shouldn't repeat across pages, but interleaving and AniList's
      // season collapsing both make this worth guaranteeing.
      if (seen.has(key)) continue;
      seen.add(key);
      if (exclude.has(key)) continue;
      if (suppressed(storedFor(item), state.settings)) continue;
      keep.push(item);
    }
  }

  if (!keep.length) {
    fill(host,
      emptyState({
        iconName: 'sparkle',
        title: ui.unseenOnly ? 'Nothing new here' : 'Nothing found',
        body: ui.unseenOnly
          ? `You’ve already seen, rated or hidden everything in the first ${pagesRead} page${pagesRead === 1 ? '' : 's'} of this genre. Tap “Show all” to see them anyway.`
          : 'This genre returned no titles.',
      })
    );
    return;
  }

  fill(host, grid(rankByAffinity(keep, affinity).slice(0, TARGET), storedFor, openItem));
}

let loadToken = 0;

// How many new-to-you titles are worth filling a screen with, and how far to
// dig for them. Every page is one cached request per medium, so the cap is what
// keeps an exhausted genre from turning into a stack of round trips.
const TARGET = 40;
const MAX_PAGES = 5;

/**
 * One page of a genre.
 *
 * Returns `empty` separately from an empty `items`, because they mean different
 * things to the paging loop: `empty` is the source running out, while an empty
 * `items` can just be a page whose every title was filtered out here. Conflating
 * them stops Animation at page one, since its first result is Ghibli and gets
 * dropped as anime.
 */
async function fetchForGenre(genre, page = 1) {
  if (genre.tag) {
    const items = await browseByTag(genre.tag, { type: ui.type, page });
    return { items, empty: !items.length };
  }
  if (genre.source === 'anilist') {
    const items = await browseAnime({ type: ui.type, page });
    return { items, empty: !items.length };
  }

  const types = availableTypes(genre).filter((t) => ui.type === 'all' || t === ui.type);
  const pages = await Promise.all(
    types.map((type) => discoverByGenre(type, genreIdFor(genre, type), { page }))
  );

  let items = interleave(pages);
  const empty = !items.length;
  if (genre.excludeJapanese) {
    // TMDB offers with_original_language but no "without", so anime has to be
    // dropped here rather than in the query.
    items = items.filter((i) => i.originalLanguage !== 'ja');
  }
  return { items, empty };
}

/** Round-robins movie and TV results so one type can't monopolise the top. */
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}
