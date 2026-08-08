/* Lists tab: everything you've tracked, filtered and sorted. */

import { h, icon, clear, fill, tile, emptyState, toast } from '../ui.js';
import { state, getItem } from '../store.js';
import {
  FILTER_GROUPS,
  SORTS,
  applyList,
  groupByGenre,
  trackedItems,
  emptyFilters,
  anyFilterActive,
  genreOptions,
} from '../sort.js';
import { backfillScores, hasOmdbKey } from '../omdb.js';
import {
  loadIndex,
  indexNow,
  indexRegion,
  needsCheck,
  checkedCount,
  platformOptions,
  backfillAvailability,
} from '../providers.js';
import { hasTmdbKey } from '../tmdb.js';
import { openItem } from './detail.js';
import { openSettings } from './settings.js';

const ui = { filters: emptyFilters(), sort: 'title', query: '' };
let sweeping = false;

export function renderLists(root) {
  clear(root);

  const results = h('div', {});
  let filterBlock = null;

  /** One labelled, horizontally-scrolling row per group. */
  function buildFilters() {
    const rows = [];
    const tracked = trackedItems(state.items);

    for (const [groupKey, group] of Object.entries(FILTER_GROUPS)) {
      let options;
      if (group.bucket) {
        options = platformOptions(tracked, group.bucket).map((p) => [p.id, { label: p.name }]);
      } else if (group.dynamic) {
        options = genreOptions(state.items).map((g) => [g.name, { label: g.name }]);
      } else {
        options = Object.entries(group.options);
      }

      // Rows that can't narrow anything are just noise. A lone genre chip is
      // one of those — every tracked title carries it — but a lone platform
      // chip is not, since plenty of titles stream nowhere. Platform rows also
      // stay absent until the index exists, so nobody who never uses them pays
      // six rows of height for four.
      const floor = group.bucket ? 1 : group.dynamic ? 2 : 1;
      if (options.length < floor) continue;

      rows.push(
        h(
          'div',
          { class: 'filter-row', dataset: { group: groupKey } },
          h('span', { class: 'f-label' }, group.label),
          h(
            'div',
            { class: 'chips' },
            options.map(([key, option]) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'chip',
                  dataset: { group: groupKey, key },
                  'aria-pressed': String(ui.filters[groupKey].has(key)),
                  onclick: (event) => {
                    const set = ui.filters[groupKey];
                    if (set.has(key)) set.delete(key);
                    else set.add(key);
                    event.currentTarget.setAttribute('aria-pressed', String(set.has(key)));
                    refreshFilters();
                    draw(results);
                  },
                },
                option.label
              )
            )
          )
        )
      );
    }

    const clearBtn = h(
      'button',
      {
        type: 'button',
        class: 'chip clear-filters',
        hidden: !anyFilterActive(ui.filters),
        onclick: () => {
          ui.filters = emptyFilters();
          refreshFilters();
          draw(results);
        },
      },
      'Clear filters'
    );

    return h('div', { class: 'filters' }, rows, availabilityNote(tracked), clearBtn);
  }

  /**
   * The control that seeds and tops up the availability index.
   *
   * It exists because platform filtering can't be free the way the others are:
   * every other filter reads a field already on the item, while availability is
   * one TMDB request per title with no batch endpoint. Making that a deliberate
   * tap — with the count in the label — is more honest than firing off a
   * hundred requests the moment someone opens the Lists tab.
   */
  function availabilityNote(tracked) {
    if (!tracked.length || !hasTmdbKey()) return null;

    const missing = needsCheck(tracked).length;
    const checked = checkedCount(tracked);
    if (!missing) return null;

    const label = checked
      ? `Check ${missing} more`
      : `Find where to watch (${tracked.length} title${tracked.length === 1 ? '' : 's'})`;

    const button = h(
      'button',
      {
        type: 'button',
        class: 'chip avail-check',
        disabled: sweeping,
        onclick: async () => {
          if (sweeping) return;
          sweeping = true;
          button.disabled = true;
          button.textContent = 'Checking…';
          try {
            const { done } = await backfillAvailability(tracked, {
              max: 40,
              onProgress: (n, total) => {
                button.textContent = `Checking ${n} of ${total}…`;
              },
            });
            if (done) toast(`Checked ${done} title${done === 1 ? '' : 's'}`);
          } finally {
            sweeping = false;
          }
          refreshFilters();
          draw(results);
        },
      },
      label
    );

    return h(
      'div',
      { class: 'avail-note' },
      button,
      checked
        ? h('span', {}, `${checked} of ${tracked.length} checked`)
        : h('span', {}, `in ${indexRegion() || 'your region'}`)
    );
  }

  function refreshFilters() {
    const next = buildFilters();
    filterBlock.replaceWith(next);
    filterBlock = next;
  }

  filterBlock = buildFilters();

  // The index lives in IndexedDB and the first paint can't await it, so the
  // platform rows arrive a frame later rather than blocking the whole tab.
  loadIndex().then(() => {
    refreshFilters();
    draw(results);
  });

  const sortSelect = h(
    'select',
    {
      class: 'select',
      'aria-label': 'Sort by',
      onchange: () => {
        ui.sort = sortSelect.value;
        draw(results);
      },
    },
    Object.entries(SORTS).map(([key, s]) =>
      h('option', { value: key, selected: ui.sort === key }, s.label)
    )
  );

  const filterInput = h('input', {
    type: 'search',
    placeholder: 'Filter your list',
    autocomplete: 'off',
    autocapitalize: 'none',
    value: ui.query,
    'aria-label': 'Filter your list',
  });
  filterInput.addEventListener('input', () => {
    ui.query = filterInput.value;
    draw(results);
  });

  root.append(
    h(
      'div',
      { style: 'display:flex;align-items:center;gap:10px' },
      h('h1', { class: 'page-title', style: 'flex:1;margin-bottom:12px' }, 'Lists'),
      h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: () => openSettings() },
        icon('settings')
      )
    ),
    h('div', { class: 'searchbar' }, icon('search', 's-icon'), filterInput),
    filterBlock,
    h('div', { class: 'sortbar' }, h('label', {}, 'Sort'), sortSelect),
    results
  );

  draw(results);
}

/** Why an empty result is empty, when the reason isn't obvious from the chips. */
function emptyReason() {
  const platform = ui.filters.stream.size || ui.filters.buy.size;
  const unchecked = platform ? needsCheck(trackedItems(state.items)).length : 0;
  if (unchecked) {
    return `No titles match this filter. ${unchecked} title${unchecked === 1 ? " hasn't" : "s haven't"} been checked for availability yet, and an unchecked title can't match a platform.`;
  }
  if (state.settings.hideDisliked && !ui.filters.rating.has('disliked')) {
    return 'No titles match this filter. “Not for me” titles are hidden — the “Not for me” chip still shows them.';
  }
  return 'No titles match this filter.';
}

function draw(host) {
  const items = applyList(state.items, {
    ...ui,
    settings: state.settings,
    availability: indexNow(),
  });

  if (!items.length) {
    fill(host,
      trackedItems(state.items).length
        ? emptyState({
            iconName: 'bookmark',
            title: 'Nothing here',
            body: emptyReason(),
          })
        : emptyState({
            iconName: 'bookmark',
            title: 'Your list is empty',
            body: 'Search on the Browse tab, then mark things watched or add them to your watchlist.',
          })
    );
    return;
  }

  const storedFor = (i) => getItem(i.type, i.id);
  const count = h(
    'p',
    { class: 'section-sub', style: 'margin:0 0 12px' },
    `${items.length} title${items.length === 1 ? '' : 's'}`
  );

  if (ui.sort === 'genre') {
    // Genre order is only useful with headers; otherwise it looks like noise.
    fill(host, 
      count,
      groupByGenre(items).map(([genre, group]) => [
        h('h2', { class: 'section-title' }, genre),
        h('div', { class: 'grid' }, group.map((i) => tile(i, storedFor(i), openItem))),
      ])
    );
  } else {
    fill(host, 
      count,
      h('div', { class: 'grid' }, items.map((i) => tile(i, storedFor(i), openItem)))
    );
  }

  maybeBackfillScores(items, host);
}

/**
 * Sorting by IMDb or Rotten Tomatoes only works if those numbers exist. Items
 * added before an OMDb key was entered (or pulled in from a Gist) won't have
 * them, so fill the gaps in the background — capped, to protect the daily quota.
 */
let backfilling = false;

async function maybeBackfillScores(items, host) {
  if (backfilling || !hasOmdbKey()) return;
  if (ui.sort !== 'imdb' && ui.sort !== 'rt') return;

  const missing = items.filter((i) => i.imdbId && i.scores?.fetchedAt == null);
  if (!missing.length) return;

  backfilling = true;
  try {
    const done = await backfillScores(missing, { max: 20 });
    if (done) {
      toast(`Fetched ratings for ${done} title${done === 1 ? '' : 's'}`);
      draw(host);
    }
  } finally {
    backfilling = false;
  }
}
