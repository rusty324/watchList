/* Genres tab: a grid of genres, and recommendations within the one you pick.
 *
 * Two states in one view, keyed off the sub-route (`#/genres` vs
 * `#/genres/horror`), so picking a genre is a history entry and the back
 * gesture returns to the grid.
 */

import { h, icon, clear, fill, grid, skeletonGrid, emptyState } from '../ui.js';
import { state, getItem, hasKeys } from '../store.js';
import { discoverByGenre, hasTmdbKey } from '../tmdb.js';
import { browseAnime, rejectSeen } from '../anilist.js';
import { GENRES, findGenre, availableTypes, genreIdFor } from '../genres.js';
import { excludeSet, genreAffinity, rankByAffinity } from '../recommend.js';
import { hiddenByPreference } from '../sort.js';
import { openItem } from './detail.js';
import { openSettings } from './settings.js';

const storedFor = (item) => getItem(item.type, item.id);

// Kept across renders so returning to a genre restores the filters you set.
const ui = { type: 'all', unseenOnly: true };

export function renderGenres(root, genreKey) {
  clear(root);
  if (genreKey) renderResults(root, genreKey);
  else renderCatalog(root);
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

function renderResults(root, genreKey) {
  const genre = findGenre(genreKey);
  if (!genre) {
    fill(root, emptyState({ title: 'Unknown genre', body: 'That genre no longer exists.' }));
    return;
  }

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

  let items;
  try {
    items = await fetchForGenre(genre);
  } catch (err) {
    if (token !== loadToken) return;
    fill(host, emptyState({ title: 'Could not load picks', body: err?.message || String(err) }));
    return;
  }
  // A slower earlier tap must not overwrite a newer one's results.
  if (token !== loadToken) return;

  const exclude = ui.unseenOnly ? excludeSet(state.items) : new Set();
  const affinity = genreAffinity(Object.values(state.items));

  let filtered = items.filter((item) => {
    if (exclude.has(`${item.type}:${item.id}`)) return false;
    return !hiddenByPreference(storedFor(item), state.settings);
  });

  // AniList entries have no TMDB id yet, so the id-keyed exclusion above can't
  // see them — they need matching by title instead.
  if (genre.source === 'anilist' && ui.unseenOnly) {
    filtered = rejectSeen(filtered, state.items);
  }

  if (!filtered.length) {
    fill(host,
      emptyState({
        iconName: 'sparkle',
        title: ui.unseenOnly ? 'Nothing new here' : 'Nothing found',
        body: ui.unseenOnly
          ? 'You’ve already seen or rated everything this genre turned up. Tap “Show all” to see them anyway.'
          : 'This genre returned no titles.',
      })
    );
    return;
  }

  fill(host, grid(rankByAffinity(filtered, affinity).slice(0, 40), storedFor, openItem));
}

let loadToken = 0;

async function fetchForGenre(genre) {
  if (genre.source === 'anilist') return browseAnime({ type: ui.type });

  const types = availableTypes(genre).filter((t) => ui.type === 'all' || t === ui.type);
  const pages = await Promise.all(
    types.map((type) => discoverByGenre(type, genreIdFor(genre, type)))
  );

  let items = interleave(pages);
  if (genre.excludeJapanese) {
    // TMDB offers with_original_language but no "without", so anime has to be
    // dropped here rather than in the query.
    items = items.filter((i) => i.originalLanguage !== 'ja');
  }
  return items;
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
