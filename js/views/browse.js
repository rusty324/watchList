/* Browse tab: search across TMDB, plus recommendations and trending when the
 * search field is empty. */

import { h, icon, clear, fill, grid, skeletonGrid, emptyState, displayTitle, tile } from '../ui.js';
import { state, getItem, hasKeys } from '../store.js';
import { search, trending, hasTmdbKey } from '../tmdb.js';
import { buildRecommendations, seedsFrom } from '../recommend.js';
import { hiddenByPreference, applySearch, searchGenres, SEARCH_SORTS } from '../sort.js';
import { openItem } from './detail.js';
import { openSettings } from './settings.js';

const storedFor = (item) => getItem(item.type, item.id);

let lastQuery = '';
let searchTimer = null;
let recCache = null;

// Applied to the results TMDB returned, not to the query — see applySearch.
const searchUi = { type: 'all', genres: new Set(), sort: 'relevance', hideTracked: false };
let lastResults = [];

export function invalidateRecommendations() {
  recCache = null;
}

export function searchQuery() {
  return lastQuery.trim();
}

/** Used by the tab bar: tapping Browse again while a search is up clears it. */
export function clearSearch() {
  lastQuery = '';
  lastResults = [];
  searchUi.type = 'all';
  searchUi.genres = new Set();
  searchUi.sort = 'relevance';
  searchUi.hideTracked = false;
}

export function renderBrowse(root) {
  clear(root);

  const results = h('div', {});

  const input = h('input', {
    type: 'search',
    placeholder: 'Search movies and TV',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: false,
    value: lastQuery,
    'aria-label': 'Search movies and TV',
  });

  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 's-clear',
      'aria-label': 'Clear search',
      hidden: !lastQuery,
      onclick: () => {
        input.value = '';
        lastQuery = '';
        clearBtn.hidden = true;
        renderHome(results);
      },
    },
    icon('close')
  );

  input.addEventListener('input', () => {
    const q = input.value;
    lastQuery = q;
    clearBtn.hidden = !q;
    clearTimeout(searchTimer);
    // Debounced so typing doesn't fire a request per keystroke.
    searchTimer = setTimeout(() => runSearch(results, q), 300);
  });

  root.append(
    h(
      'div',
      { style: 'display:flex;align-items:center;gap:10px' },
      h('h1', { class: 'page-title', style: 'flex:1;margin-bottom:12px' }, 'Browse'),
      h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: () => openSettings() },
        icon('settings')
      )
    ),
    h('div', { class: 'searchbar' }, icon('search', 's-icon'), input, clearBtn),
    results
  );

  if (lastQuery) runSearch(results, lastQuery);
  else renderHome(results);
}

async function runSearch(host, query) {
  const q = query.trim();
  if (!q) return renderHome(host);

  if (!hasTmdbKey()) return renderNeedsKey(host);

  fill(host, skeletonGrid(6));
  try {
    const items = await search(q);
    // A slower earlier query must not overwrite a newer one's results.
    if (lastQuery.trim() !== q) return;
    if (!items.length) {
      fill(host, 
        emptyState({ iconName: 'search', title: 'No matches', body: `Nothing found for “${q}”.` })
      );
      return;
    }
    lastResults = items;
    paintResults(host);
  } catch (err) {
    if (lastQuery.trim() !== q) return;
    fill(host, 
      emptyState({
        iconName: 'search',
        title: 'Search failed',
        body: err?.message || String(err),
        action: err?.status === 401 || !hasKeys()
          ? h('button', { class: 'btn', type: 'button', onclick: () => openSettings() }, 'Open settings')
          : null,
      })
    );
  }
}

/**
 * Result filters.
 *
 * These narrow what came back, not what was asked for: TMDB's multi-search
 * takes no type, genre or year parameter. Building the genre chips from the
 * results themselves keeps that honest — it can only offer genres that are
 * actually present, so it never looks like a genre-wide search.
 */
function searchFilters(host) {
  const genres = searchGenres(lastResults);

  const chipRow = (label, options, isOn, toggle) =>
    h(
      'div',
      { class: 'filter-row' },
      h('span', { class: 'f-label' }, label),
      h(
        'div',
        { class: 'chips' },
        options.map(([key, text]) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              dataset: { key },
              'aria-pressed': String(isOn(key)),
              onclick: () => {
                toggle(key);
                paintResults(host);
              },
            },
            text
          )
        )
      )
    );

  const sortSelect = h(
    'select',
    {
      class: 'select',
      'aria-label': 'Sort results',
      onchange: () => {
        searchUi.sort = sortSelect.value;
        paintResults(host);
      },
    },
    Object.entries(SEARCH_SORTS).map(([key, s]) =>
      h('option', { value: key, selected: searchUi.sort === key }, s.label)
    )
  );

  return h(
    'div',
    { class: 'filters search-filters' },
    chipRow(
      'Type',
      [['all', 'All'], ['movie', 'Movies'], ['tv', 'TV'], ['person', 'People']],
      (key) => searchUi.type === key,
      (key) => {
        searchUi.type = key;
        // People carry no genres, so a genre filter would empty the list.
        if (key === 'person') searchUi.genres = new Set();
      }
    ),
    genres.length > 1
      ? chipRow(
          'Genre',
          genres.map((g) => [g, g]),
          (key) => searchUi.genres.has(key),
          (key) => {
            if (searchUi.genres.has(key)) searchUi.genres.delete(key);
            else searchUi.genres.add(key);
          }
        )
      : null,
    h(
      'div',
      { class: 'sortbar' },
      h('label', {}, 'Sort'),
      sortSelect,
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(searchUi.hideTracked),
          onclick: (event) => {
            searchUi.hideTracked = !searchUi.hideTracked;
            event.currentTarget.setAttribute('aria-pressed', String(searchUi.hideTracked));
            paintResults(host);
          },
        },
        'Hide tracked'
      )
    )
  );
}

function paintResults(host) {
  const shown = applySearch(lastResults, { ...searchUi, items: state.items });

  fill(host,
    searchFilters(host),
    shown.length
      ? grid(shown, storedFor, openItem)
      : emptyState({
          iconName: 'search',
          title: 'Nothing left',
          body:
            'No results match those filters. Filters only narrow what this search ' +
            'returned — for browsing a whole genre, use the Genres tab.',
        })
  );
}

function renderNeedsKey(host) {
  fill(host, 
    emptyState({
      iconName: 'settings',
      title: 'Add your TMDB key',
      body: 'watchList runs entirely in your browser, so it needs your own free TMDB key to look anything up.',
      action: h(
        'button',
        { class: 'btn', type: 'button', onclick: () => openSettings() },
        'Set up keys'
      ),
    })
  );
}

async function renderHome(host) {
  if (!hasTmdbKey()) return renderNeedsKey(host);

  fill(host, skeletonGrid(6));

  // Applies to the browsing rows only. Search deliberately still returns
  // disliked titles — see hiddenByPreference in sort.js.
  const visible = (items) =>
    items.filter((i) => !hiddenByPreference(storedFor(i), state.settings));

  const seeds = seedsFrom(state.items);
  const sections = [];

  if (seeds.length) {
    try {
      recCache = recCache || (await buildRecommendations());
    } catch (err) {
      console.warn('[browse] recommendations failed', err);
      recCache = null;
    }
  }

  if (recCache?.top?.length) {
    sections.push(
      h('h2', { class: 'section-title' }, 'Top picks for you'),
      h('p', { class: 'section-sub' }, `Based on ${recCache.seeds.length} title${recCache.seeds.length === 1 ? '' : 's'} you liked`),
      grid(visible(recCache.top.map((c) => c.item)).slice(0, 8), storedFor, openItem)
    );

    for (const rail of recCache.rails) {
      sections.push(
        h(
          'h2',
          { class: 'section-title' },
          `Because you liked ${displayTitle(rail.seed, rail.seed)}`
        ),
        h('div', { class: 'rail' }, visible(rail.items).map((i) => tile(i, storedFor(i), openItem)))
      );
    }
  } else if (!seeds.length) {
    sections.push(
      emptyState({
        iconName: 'sparkle',
        title: 'Rate something to get picks',
        body: 'Search for a film or show you love and give it a thumbs up. Recommendations appear here once you have at least one.',
      })
    );
  }

  try {
    const items = visible(await trending());
    sections.push(
      h('h2', { class: 'section-title' }, 'Trending this week'),
      grid(items.slice(0, 12), storedFor, openItem)
    );
  } catch (err) {
    if (!sections.length) {
      fill(host, 
        emptyState({
          iconName: 'film',
          title: 'Could not reach TMDB',
          body: err?.message || String(err),
          action: h(
            'button',
            { class: 'btn', type: 'button', onclick: () => openSettings() },
            'Open settings'
          ),
        })
      );
      return;
    }
  }

  fill(host, sections);
}
