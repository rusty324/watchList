/* Shared rendering helpers: a mini hyperscript, icons, poster tiles, the
 * stacked sheet presenter, and toasts. */

import { posterUrl } from './tmdb.js';
import { state, tvProgress } from './store.js';
import { armRatingGesture, tapWasSwallowed } from './longpress.js';

/* ---------- hyperscript ---------- */

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else node.setAttribute(key, value === true ? '' : value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Replace a node's contents. Always use this rather than the native DOM
 * `append`, which stringifies an array argument into "[object HTMLDivElement]"
 * instead of appending it. This flattens nested arrays the way `h()` does.
 */
export function fill(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/* ---------- icons ---------- */

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  up: '<path d="M7 22V11l5-9a2.5 2.5 0 0 1 2.5 3l-1 5H20a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 18.6 22H7Z"/><rect x="2" y="11" width="5" height="11" rx="1"/>',
  down: '<path d="M17 2v11l-5 9a2.5 2.5 0 0 1-2.5-3l1-5H4a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 5.4 2H17Z"/><rect x="17" y="2" width="5" height="11" rx="1"/>',
  // "seen it, not going round again" — a replay arrow struck through. Kept to
  // three strokes so it still reads at 12px in a tile badge.
  once: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/><path d="M4 4l16 16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  film: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 12h20M2 8h5M2 16h5M17 8h5M17 16h5"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
};

export function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

/* ---------- titles ---------- */

/**
 * The title to show in tiles and lists. Only foreign-language titles can be
 * toggled; everything else always renders its one and only name.
 */
export function displayTitle(meta, stored) {
  const pref = stored?.titlePref || state.settings.defaultTitleLang || 'en';
  if (meta?.foreign && pref === 'original' && meta.originalTitle) return meta.originalTitle;
  return meta?.title || stored?.title || 'Untitled';
}

export function metaLine(item) {
  if (item.type === 'tv') {
    const parts = [item.year || '—'];
    const seasons = item.seasonCount || 0;
    // AniList entries know their episode count but not a season count, since
    // it models cours as separate entries rather than seasons of one show.
    if (seasons) parts.push(`${seasons} season${seasons === 1 ? '' : 's'}`);
    else if (item.episodes) parts.push(`${item.episodes} ep${item.episodes === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }
  return item.year ? String(item.year) : '—';
}

/* ---------- tiles ---------- */

export function posterBox(item, size = 'w185') {
  const url = posterUrl(item.poster, size);
  const box = h('div', { class: 'poster' });
  if (url) {
    box.append(
      // draggable=false stops iOS starting an image drag during a long-press.
      h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })
    );
  } else {
    box.append(h('div', { class: 'ph' }, item.title || ''));
  }
  return box;
}

export function tile(item, stored, onOpen) {
  const box = posterBox(item);

  const badges = h('div', { class: 'badges' });
  if (stored?.rating === 'up') badges.append(h('span', { class: 'badge up' }, icon('up')));
  if (stored?.rating === 'once') badges.append(h('span', { class: 'badge once' }, icon('once')));
  if (stored?.rating === 'down') badges.append(h('span', { class: 'badge down' }, icon('down')));
  if (stored?.watched) badges.append(h('span', { class: 'badge seen' }, icon('check')));
  else if (stored?.inWatchlist) badges.append(h('span', { class: 'badge' }, icon('bookmark')));
  if (badges.childElementCount) box.append(badges);

  // Partially-watched shows get a progress sliver along the bottom of the art.
  if (stored?.type === 'tv') {
    const pct = tvProgress(stored);
    if (pct > 0 && pct < 1) {
      box.append(
        h('div', { class: 'progress-strip' }, h('i', { style: `width:${Math.round(pct * 100)}%` }))
      );
    }
  }

  const node = h(
    'button',
    {
      class: 'tile',
      type: 'button',
      onclick: () => {
        // A long-press ends in a click too; that one shouldn't also open the
        // sheet on top of the rating the user just set.
        if (tapWasSwallowed()) return;
        onOpen(item);
      },
      'aria-label': `${displayTitle(item, stored)}, ${metaLine(item)}`,
    },
    box,
    h('div', { class: 't-name' }, displayTitle(item, stored)),
    h('div', { class: 't-meta' }, metaLine(item))
  );

  // People have no rating; everything else can be rated by press-and-hold.
  if (item.type !== 'person') armRatingGesture(node, item);
  return node;
}

export function grid(items, storedFor, onOpen) {
  return h('div', { class: 'grid' }, items.map((i) => tile(i, storedFor(i), onOpen)));
}

export function skeletonGrid(count = 6) {
  return h(
    'div',
    { class: 'grid' },
    Array.from({ length: count }, () => h('div', { class: 'skeleton poster-sk' }))
  );
}

export function emptyState({ iconName = 'film', title, body, action }) {
  return h(
    'div',
    { class: 'empty' },
    icon(iconName),
    h('h3', {}, title),
    body ? h('p', {}, body) : null,
    action || null
  );
}

/* ---------- sheets ---------- */

const sheetHost = () => document.getElementById('sheets');
const stack = [];

/**
 * Present a full-height sheet. Sheets stack (movie -> cast member -> that
 * person's film), and each one pushes a history entry so the iOS back swipe and
 * the browser back button pop them in the expected order.
 */
export function openSheet({ title, render, onClose }) {
  const host = sheetHost();
  host.style.pointerEvents = 'auto';

  const scrim = h('div', { class: 'scrim', onclick: () => history.back() });
  const body = h('div', { class: 'sheet-body' });
  const heading = h('h2', {}, title || '');

  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'grabber' }),
      h(
        'button',
        { type: 'button', onclick: () => history.back(), 'aria-label': 'Close' },
        stack.length ? icon('back') : icon('close')
      ),
      heading,
      h('div', { class: 'spacer' })
    ),
    body
  );

  host.append(scrim, sheet);
  const entry = { scrim, sheet, body, heading, onClose };
  stack.push(entry);

  history.pushState({ wlDepth: stack.length }, '');

  requestAnimationFrame(() => {
    scrim.classList.add('in');
    sheet.classList.add('in');
  });

  const api = {
    body,
    setTitle: (t) => {
      heading.textContent = t;
    },
    close: () => history.back(),
  };
  entry.api = api;

  Promise.resolve(render(api)).catch((err) => {
    console.error('[sheet] render failed', err);
    fill(body, 
      emptyState({ title: 'Something went wrong', body: err?.message || String(err) })
    );
  });

  return api;
}

function popSheet() {
  const entry = stack.pop();
  if (!entry) return;
  entry.scrim.classList.remove('in');
  entry.sheet.classList.remove('in');
  const done = () => {
    entry.scrim.remove();
    entry.sheet.remove();
    if (!stack.length) sheetHost().style.pointerEvents = 'none';
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) done();
  else setTimeout(done, 340);
  try {
    entry.onClose?.();
  } catch (err) {
    console.error('[sheet] onClose failed', err);
  }
}

export function closeAllSheets() {
  while (stack.length) popSheet();
}

export function sheetDepth() {
  return stack.length;
}

addEventListener('popstate', (event) => {
  // A hash change (tab switch) carries no wlDepth, which correctly unwinds
  // every open sheet.
  const target = event.state?.wlDepth ?? 0;
  while (stack.length > target) popSheet();
});

/* ---------- toast ---------- */

let toastTimer = null;

export function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  requestAnimationFrame(() => node.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => {
      node.hidden = true;
    }, 220);
  }, 2200);
}
