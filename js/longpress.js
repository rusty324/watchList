/* Press and hold a poster, slide onto a verdict, release.
 *
 * Rating from a grid otherwise costs three interactions — open, tap, back — for
 * a decision you made the moment you saw the poster.
 *
 * Built on Pointer Events so touch and mouse share one path. The awkward parts
 * (where the popover goes, what's under the finger, whether a move was a scroll)
 * are pure functions so they can be tested without a browser.
 *
 * This is an accelerator, not a new capability: a long-press has no keyboard
 * equivalent, and the detail sheet's rating row offers the same three verdicts
 * to everyone.
 */

import { h, icon, toast } from './ui.js';
import { getItem, setRating } from './store.js';
import { RATING_LABELS, snapshot } from './views/parts.js';
import { resolveToTmdb } from './anilist.js';

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;
const GAP = 10;
const EDGE = 8;

const OPTIONS = ['up', 'once', 'down'];

let popover = null;
let gestureInProgress = false;
// Set while a long-press completes, so the click that follows release doesn't
// also open the detail sheet.
let swallowClick = false;

/* ---------- pure helpers ---------- */

/** True once the pointer has moved far enough that this is a scroll, not a hold. */
export function movedTooFar(start, current, tolerance = MOVE_TOLERANCE) {
  return Math.hypot(current.x - start.x, current.y - start.y) > tolerance;
}

/**
 * Where to put the option row.
 *
 * Above the tile by preference — that's where the finger isn't. A tile near the
 * top of the viewport has no room there, so it flips below, and it clamps
 * horizontally so an edge-column tile can't push it off screen.
 */
export function placePopover(tileRect, size, viewport, edge = EDGE, gap = GAP) {
  const above = tileRect.top - gap - size.height;
  const fitsAbove = above >= edge;

  const y = fitsAbove
    ? above
    : Math.min(tileRect.bottom + gap, viewport.height - size.height - edge);
  const centred = tileRect.left + tileRect.width / 2 - size.width / 2;
  const x = Math.max(edge, Math.min(centred, viewport.width - size.width - edge));

  return { x, y, placement: fitsAbove ? 'above' : 'below' };
}

/** Which option the point is over, or null. */
export function pickOption(point, optionRects) {
  for (const { kind, rect } of optionRects) {
    if (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    ) {
      return kind;
    }
  }
  return null;
}

/* ---------- popover ---------- */

function ensurePopover() {
  if (popover) return popover;
  popover = h(
    'div',
    { class: 'rate-pop', role: 'menu', 'aria-hidden': 'true' },
    OPTIONS.map((kind) =>
      h(
        'div',
        { class: `rate-opt ${kind}`, dataset: { kind }, role: 'menuitem' },
        icon(kind),
        h('span', {}, RATING_LABELS[kind].short)
      )
    )
  );
  document.body.append(popover);
  return popover;
}

function optionRects() {
  return [...ensurePopover().children].map((el) => ({
    kind: el.dataset.kind,
    rect: el.getBoundingClientRect(),
  }));
}

function highlight(kind) {
  for (const el of ensurePopover().children) {
    el.classList.toggle('on', el.dataset.kind === kind);
  }
}

function openPopover(tile, currentRating) {
  const pop = ensurePopover();
  pop.classList.add('in');
  pop.setAttribute('aria-hidden', 'false');

  for (const el of pop.children) {
    // Show what's already set, so dragging onto it reads as "clear this".
    el.classList.toggle('current', el.dataset.kind === currentRating);
    el.classList.remove('on');
  }

  // Measure once visible, then position.
  const size = { width: pop.offsetWidth, height: pop.offsetHeight };
  const spot = placePopover(tile.getBoundingClientRect(), size, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  pop.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px)`;
  pop.dataset.placement = spot.placement;
}

function closePopover() {
  if (!popover) return;
  popover.classList.remove('in');
  popover.setAttribute('aria-hidden', 'true');
  for (const el of popover.children) el.classList.remove('on', 'current');
}

/* ---------- committing ---------- */

async function commit(item, kind) {
  let target = item;
  let meta = snapshot(item);

  if (item.source === 'anilist') {
    // AniList tiles carry no TMDB id, and ratings are keyed on TMDB ids.
    const match = await resolveToTmdb(item);
    if (!match) {
      toast(`No TMDB entry for “${item.title}” — open it to see why`);
      return;
    }
    target = match;
    // Minimal metadata on purpose: opening the title later refreshes it from
    // TMDB, and an AniList cover shouldn't be persisted as the poster.
    meta = { type: match.type, id: match.id, title: item.title, year: item.year };
  }

  // setRating already clears when the same verdict is set again, which is what
  // dragging onto the active option should do.
  const next = setRating(target.type, target.id, kind, meta);
  toast(next ? `${item.title} — ${RATING_LABELS[next].short}` : `${item.title} — rating cleared`);
}

/* ---------- gesture ---------- */

function currentRatingOf(item) {
  if (item.source === 'anilist') return null; // unknown until resolved
  return getItem(item.type, item.id)?.rating || null;
}

/** Blocks page scroll once the popover is up. Must be non-passive to have effect. */
function blockScroll(event) {
  event.preventDefault();
}

export function armRatingGesture(tile, item) {
  tile.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || gestureInProgress) return;

    const start = { x: event.clientX, y: event.clientY };
    let open = false;
    gestureInProgress = true;

    const timer = setTimeout(() => {
      open = true;
      tile.classList.add('pressing');
      // Everything is passive by default, which would make preventDefault a
      // no-op — this is what stops the page scrolling under the popover.
      document.addEventListener('touchmove', blockScroll, { passive: false });
      openPopover(tile, currentRatingOf(item));
      // Unsupported on iOS Safari; harmless where it's missing.
      navigator.vibrate?.(10);
    }, HOLD_MS);

    // Listening on the window rather than the tile: once the finger leaves the
    // poster on its way to an option, tile-scoped events stop being reliable.
    const onMove = (moveEvent) => {
      const point = { x: moveEvent.clientX, y: moveEvent.clientY };
      if (!open) {
        // Movement before the hold completes means the user is scrolling.
        if (movedTooFar(start, point)) finish(null);
        return;
      }
      highlight(pickOption(point, optionRects()));
    };

    const onUp = (upEvent) => {
      finish(open ? pickOption({ x: upEvent.clientX, y: upEvent.clientY }, optionRects()) : null);
    };

    // A cancel is the browser claiming the gesture for a scroll — expected, not
    // an error.
    const onCancel = () => finish(null);

    function finish(kind) {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      tile.classList.remove('pressing');
      gestureInProgress = false;

      if (open) {
        document.removeEventListener('touchmove', blockScroll);
        closePopover();
        // The click that follows release would otherwise also open the sheet.
        swallowClick = true;
        setTimeout(() => {
          swallowClick = false;
        }, 400);
      }
      open = false;

      if (kind) commit(item, kind);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });

  // Stops the desktop right-click menu; belt-and-braces for iOS's callout.
  tile.addEventListener('contextmenu', (event) => event.preventDefault());
}

/** True when a click should be ignored because it followed a long-press. */
export function tapWasSwallowed() {
  return swallowClick;
}
