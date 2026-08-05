/* Boot, routing, and the wiring between the store and background sync. */

import { subscribe } from './store.js';
import { sheetDepth, closeAllSheets } from './ui.js';
import { renderBrowse, invalidateRecommendations } from './views/browse.js';
import { renderLists } from './views/lists.js';
import { consumeSetupLink, openSettings } from './views/settings.js';
import { hasTmdbKey } from './tmdb.js';
import * as sync from './sync.js';

const view = document.getElementById('view');
const tabs = [...document.querySelectorAll('.tab')];

const ROUTES = {
  browse: renderBrowse,
  lists: renderLists,
};

let current = 'browse';
let dirty = false;

function routeName() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[hash] ? hash : 'browse';
}

function render() {
  dirty = false;
  current = routeName();
  for (const tab of tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === current));
  }
  ROUTES[current](view);
  view.scrollTop = 0;
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
