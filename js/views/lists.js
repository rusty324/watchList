/* Lists tab: everything you've tracked, filtered and sorted. */

import { h, icon, clear, fill, tile, emptyState, toast, scrollToTop } from '../ui.js';
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
  pageCount,
  clampPage,
  pageSlice,
  pageRange,
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
import { renderPlaylists } from './playlists.js';

const ui = { filters: emptyFilters(), sort: 'title', query: '', page: 1 };
let sweeping = false;
// Lives beside the Sort control, above the grid. Held here because draw() has
// to refill it and only knows about the results container.
let topPagerSlot = null;

/** Anything that changes which titles match has to send you back to page 1. */
function resetPage() {
  ui.page = 1;
}

export function renderLists(root, segments) {
  // Playlists live under this tab as sub-routes, the way genres do under
  // theirs, so opening one is a history entry the back gesture understands.
  if (segments?.length) return renderPlaylists(root, segments);

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
                    resetPage();
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
          resetPage();
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
        resetPage();
        draw(results);
      },
    },
    Object.entries(SORTS).map(([key, s]) =>
      h('option', { value: key, selected: ui.sort === key }, s.label)
    )
  );

  topPagerSlot = h('div', { class: 'pager-slot' });

  const filterInput = h('input', {
    type: 'search',
    placeholder: 'Filter your list',
    autocomplete: 'off',
    autocapitalize: 'none',
    value: ui.query,
    'aria-label': 'Filter your list',
  });
  // Debounced: a redraw rebuilds every tile on the page, and firing that on
  // each keystroke was the single slowest thing about a large library.
  let queryTimer = null;
  filterInput.addEventListener('input', () => {
    ui.query = filterInput.value;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      resetPage();
      draw(results);
    }, 180);
  });

  root.append(
    h(
      'div',
      { style: 'display:flex;align-items:center;gap:10px' },
      h('h1', { class: 'page-title', style: 'flex:1;margin-bottom:12px' }, 'Lists'),
      h('a', { class: 'icon-btn', href: '#/lists/playlists', 'aria-label': 'Playlists' }, icon('queue')),
      h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: () => openSettings() },
        icon('settings')
      )
    ),
    h('div', { class: 'searchbar' }, icon('search', 's-icon'), filterInput),
    filterBlock,
    h('div', { class: 'sortbar' }, h('label', {}, 'Sort'), sortSelect, topPagerSlot),
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

/**
 * Previous / page / Next, in two sizes.
 *
 * It renders twice: below the grid, where you arrive after reading a page, and
 * beside the Sort control, so turning a page never means scrolling past fifty
 * posters to reach the button. Both are rebuilt on every draw, so neither can
 * drift out of step with the other.
 *
 * The bottom one picks pages from a select rather than a row of numbers,
 * because a four-figure library runs to twenty-odd pages — more than fits
 * across a phone, and stepping to page 14 with a Next button is nobody's idea
 * of a good time. The top one has no room for that next to a sort menu, so it
 * shows the position and leaves jumping to its twin.
 */
function pager(host, total, pages, { compact = false } = {}) {
  if (pages < 2) return null;

  const go = (page) => {
    ui.page = clampPage(page, total);
    draw(host);
    // A new page under your thumb with the old scroll position is disorienting.
    scrollToTop({ smooth: false });
  };

  const step = (label, iconName, delta, disabled) =>
    h(
      'button',
      {
        type: 'button',
        class: 'page-step',
        'aria-label': label,
        disabled,
        onclick: () => go(ui.page + delta),
      },
      icon(iconName)
    );

  const picker = h(
    'select',
    {
      class: 'select page-pick',
      'aria-label': `Page ${ui.page} of ${pages}`,
      onchange: () => go(Number(picker.value)),
    },
    Array.from({ length: pages }, (_, i) =>
      h('option', { value: i + 1, selected: ui.page === i + 1 }, `Page ${i + 1} of ${pages}`)
    )
  );

  const middle = compact
    ? h(
        'span',
        { class: 'page-of', 'aria-label': `Page ${ui.page} of ${pages}` },
        `${ui.page}/${pages}`
      )
    : picker;

  return h(
    'div',
    {
      class: `pager${compact ? ' compact' : ''}`,
      dataset: { page: String(ui.page), pages: String(pages) },
    },
    step('Previous page', 'back', -1, ui.page <= 1),
    middle,
    step('Next page', 'forward', 1, ui.page >= pages)
  );
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
    if (topPagerSlot) fill(topPagerSlot);
    return;
  }

  // A filter can shrink the list under a page you were already on.
  ui.page = clampPage(ui.page, items.length);
  const shown = pageSlice(items, ui.page);
  const pages = pageCount(items.length);
  const { from, to } = pageRange(ui.page, items.length);

  const storedFor = (i) => getItem(i.type, i.id);
  const count = h(
    'p',
    { class: 'section-sub', style: 'margin:0 0 12px' },
    pages > 1
      ? `${from}–${to} of ${items.length} titles`
      : `${items.length} title${items.length === 1 ? '' : 's'}`
  );

  // Grouping applies to the page, not the library: the list is sorted by genre
  // before it is sliced, so the headers still read in order across pages.
  const body =
    ui.sort === 'genre'
      ? groupByGenre(shown).map(([genre, group]) => [
          h('h2', { class: 'section-title' }, genre),
          h('div', { class: 'grid' }, group.map((i) => tile(i, storedFor(i), openItem))),
        ])
      : h('div', { class: 'grid' }, shown.map((i) => tile(i, storedFor(i), openItem)));

  fill(host, count, body, pager(host, items.length, pages));
  // The twin beside the Sort control, so turning a page doesn't mean scrolling
  // past a screenful of posters first.
  if (topPagerSlot) fill(topPagerSlot, pager(host, items.length, pages, { compact: true }));

  // Deliberately the whole filtered list, not this page: sorting by IMDb is
  // only correct if the scores exist for everything being sorted, so the
  // backfill has to keep chipping away past the visible 50.
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
