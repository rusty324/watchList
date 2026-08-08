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
import { getItem, setRating, setHidden } from './store.js';
import { RATING_LABELS, snapshot } from './views/parts.js';
import { resolveToTmdb } from './anilist.js';

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;
const EDGE = 8;
// How far the finger must travel after the options appear before a release
// counts as a choice. Smaller than MOVE_TOLERANCE: by this point the press has
// already been recognised, so this only has to rule out a stationary finger.
const SLIDE_MIN = 6;

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
 * Where to put the options, relative to the finger rather than the tile.
 *
 * Anchoring to the tile meant that on a tall poster the options could open most
 * of a screen away from where you were actually pressing. Here the popover is
 * centred on the press point, with the verdict row above it and Hide below, so
 * every target is one short slide from where the finger already is.
 *
 * `anchorOffset` is the distance from the popover's top edge to the gap the
 * fingertip sits in. Both axes clamp into the viewport, which can pull the gap
 * off the fingertip near a screen edge — that is why a release without any
 * movement commits nothing.
 */
export function placePopover(point, size, viewport, anchorOffset, edge = EDGE) {
  const ideal = point.y - anchorOffset;
  const maxY = viewport.height - size.height - edge;
  const y = Math.max(edge, Math.min(ideal, maxY));

  const centred = point.x - size.width / 2;
  const x = Math.max(edge, Math.min(centred, viewport.width - size.width - edge));

  // Which way the popover had to move to fit, so the CSS can grow from the
  // right corner.
  const placement = y < ideal ? 'shifted-up' : y > ideal ? 'shifted-down' : 'centred';
  return { x, y, placement };
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

/**
 * Three verdicts in a row, a gap the fingertip occupies, then Hide.
 *
 * Hide is on its own row rather than a fourth chip in the first: four across is
 * already too wide for a 390px screen, and it isn't a verdict — it records no
 * opinion, it just takes the title out of the grids.
 */
function ensurePopover() {
  if (popover) return popover;

  const opt = (kind, label) =>
    h(
      'div',
      { class: `rate-opt ${kind}`, dataset: { kind }, role: 'menuitem' },
      icon(kind === 'hide' ? 'eye-off' : kind),
      h('span', {}, label)
    );

  popover = h(
    'div',
    { class: 'rate-pop', role: 'menu', 'aria-hidden': 'true' },
    h('div', { class: 'rate-row' }, OPTIONS.map((kind) => opt(kind, RATING_LABELS[kind].short))),
    h('div', { class: 'rate-gap' }),
    h('div', { class: 'rate-row' }, opt('hide', 'Hide'))
  );
  document.body.append(popover);
  return popover;
}

const optionEls = () => [...ensurePopover().querySelectorAll('.rate-opt')];

function optionRects() {
  return optionEls().map((el) => ({ kind: el.dataset.kind, rect: el.getBoundingClientRect() }));
}

function highlight(kind) {
  for (const el of optionEls()) el.classList.toggle('on', el.dataset.kind === kind);
}

/** Distance from the popover's top edge to the middle of the finger gap. */
function anchorOffset(pop) {
  const gap = pop.querySelector('.rate-gap');
  return gap.offsetTop + gap.offsetHeight / 2;
}

function openPopover(point, active) {
  const pop = ensurePopover();
  pop.classList.add('in');
  pop.setAttribute('aria-hidden', 'false');

  for (const el of optionEls()) {
    // Show what's already set, so dragging onto it reads as "clear this".
    el.classList.toggle('current', el.dataset.kind === active);
    el.classList.remove('on');
  }

  // Measure once visible, then position.
  const size = { width: pop.offsetWidth, height: pop.offsetHeight };
  const spot = placePopover(point, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  }, anchorOffset(pop));
  pop.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px)`;
  pop.dataset.placement = spot.placement;
}

function closePopover() {
  if (!popover) return;
  popover.classList.remove('in');
  popover.setAttribute('aria-hidden', 'true');
  for (const el of optionEls()) el.classList.remove('on', 'current');
}

/* ---------- committing ---------- */

async function commit(item, kind) {
  let target = item;
  let meta = snapshot(item);

  if (item.source === 'anilist') {
    // AniList tiles carry no TMDB id, and both ratings and hides are keyed on
    // TMDB ids.
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

  if (kind === 'hide') {
    // Same "drag onto the active one to undo it" rule the verdicts follow.
    const on = !getItem(target.type, target.id)?.hidden;
    setHidden(target.type, target.id, on, meta);
    toast(on ? `${item.title} — hidden` : `${item.title} — no longer hidden`);
    return;
  }

  // setRating already clears when the same verdict is set again, which is what
  // dragging onto the active option should do.
  const next = setRating(target.type, target.id, kind, meta);
  toast(next ? `${item.title} — ${RATING_LABELS[next].short}` : `${item.title} — rating cleared`);
}

/* ---------- gesture ---------- */

/** Which option to mark as already set, so dragging onto it reads as "undo". */
function activeOptionOf(item) {
  if (item.source === 'anilist') return null; // unknown until resolved
  const stored = getItem(item.type, item.id);
  if (stored?.hidden) return 'hide';
  return stored?.rating || null;
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
    // The popover now opens around the finger rather than above the tile, so an
    // option can end up under a stationary fingertip when the layout clamps at a
    // screen edge. Requiring a deliberate slide is what stops that rating
    // something nobody chose.
    let slid = false;
    gestureInProgress = true;

    const timer = setTimeout(() => {
      open = true;
      tile.classList.add('pressing');
      // Everything is passive by default, which would make preventDefault a
      // no-op — this is what stops the page scrolling under the popover.
      document.addEventListener('touchmove', blockScroll, { passive: false });
      openPopover(start, activeOptionOf(item));
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
      if (movedTooFar(start, point, SLIDE_MIN)) slid = true;
      highlight(slid ? pickOption(point, optionRects()) : null);
    };

    const onUp = (upEvent) => {
      const point = { x: upEvent.clientX, y: upEvent.clientY };
      finish(open && slid ? pickOption(point, optionRects()) : null);
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
