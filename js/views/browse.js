/* Browse tab: search across TMDB, plus recommendations and trending when the
 * search field is empty. */

import { h, icon, clear, fill, grid, skeletonGrid, emptyState, displayTitle, tile } from '../ui.js';
import { state, getItem, hasKeys } from '../store.js';
import { search, trending, hasTmdbKey } from '../tmdb.js';
import { buildRecommendations, seedsFrom } from '../recommend.js';
import { openItem } from './detail.js';
import { openSettings } from './settings.js';

const storedFor = (item) => getItem(item.type, item.id);

let lastQuery = '';
let searchTimer = null;
let recCache = null;

export function invalidateRecommendations() {
  recCache = null;
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
    fill(host, grid(items, storedFor, openItem));
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
      grid(recCache.top.slice(0, 8).map((c) => c.item), storedFor, openItem)
    );

    for (const rail of recCache.rails) {
      sections.push(
        h(
          'h2',
          { class: 'section-title' },
          `Because you liked ${displayTitle(rail.seed, rail.seed)}`
        ),
        h('div', { class: 'rail' }, rail.items.map((i) => tile(i, storedFor(i), openItem)))
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
    const items = await trending();
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
