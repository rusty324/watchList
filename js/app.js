/* Boot, routing, and the wiring between the store and background sync. */

import { subscribe } from './store.js';
import { sheetDepth, closeAllSheets } from './ui.js';
import { renderBrowse, invalidateRecommendations } from './views/browse.js';
import { renderGenres } from './views/genres.js';
import { renderLists } from './views/lists.js';
import { consumeSetupLink, openSettings } from './views/settings.js';
import { hasTmdbKey } from './tmdb.js';
import * as sync from './sync.js';

const view = document.getElementById('view');
const tabs = [...document.querySelectorAll('.tab')];

const ROUTES = {
  browse: renderBrowse,
  genres: renderGenres,
  lists: renderLists,
};

let current = 'browse';
let dirty = false;

/**
 * `#/genres/horror` -> { name: 'genres', sub: 'horror' }. The selected genre
 * lives in the hash so it becomes a real history entry, which is what makes the
 * back gesture return to the genre grid rather than leaving the tab.
 */
function parseRoute() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  // The remainder is handed on whole: the Genres tab uses it for both the genre
  // key and an optional preselected medium (#/genres/drama/tv).
  return { name: ROUTES[name] ? name : 'browse', sub: rest.length ? rest : null };
}

function render() {
  dirty = false;
  const route = parseRoute();
  const tabChanged = route.name !== current;
  current = route.name;
  for (const tab of tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === current));
  }
  ROUTES[current](view, route.sub);
  // Moving within a tab (picking a genre) shouldn't fight the browser over
  // scroll position the way switching tabs should reset it.
  if (tabChanged) view.scrollTop = 0;
}

addEventListener('hashchange', () => {
  closeAllSheets();
  render();
});

/* ---------- store -> sync + repaint ---------- */

subscribe((reason) => {
  if (reason === 'rating') invalidateRecommendations();
  if (reason !== 'secrets' && reason !== 'storage-error') sync.schedule();

  // Repainting the tab underneath an open sheet would throw away its scroll
  // position for no visible benefit, so defer until the sheets are gone.
  dirty = true;
  if (sheetDepth() === 0) render();
});

addEventListener('popstate', () => {
  setTimeout(() => {
    if (dirty && sheetDepth() === 0) render();
  }, 0);
});

/* ---------- lifecycle ---------- */

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sync.flush();
  else sync.pull({ quiet: true });
});

// pagehide is the reliable "leaving" signal on iOS; beforeunload often isn't.
addEventListener('pagehide', () => sync.flush());

/* ---------- start ---------- */

consumeSetupLink();

// Keep the query string: dropping it would silently exit ?mock=1 on reload.
if (!location.hash) {
  history.replaceState(null, '', location.pathname + location.search + '#/browse');
}
render();

if (sync.isConfigured()) sync.pull({ quiet: true });

// First run with no key: drop the user straight into setup rather than making
// them find the gear icon.
if (!hasTmdbKey()) openSettings();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    // Relative path so the worker scopes correctly under /watchList/ on Pages.
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[sw] registration failed', err);
    });
  });
}
