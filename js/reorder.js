/* Drag a row by its handle to reorder a list.
 *
 * Built like js/longpress.js: the awkward parts — where a dropped row lands,
 * what the new order is — are pure functions so they can be tested without a
 * browser, and the gesture around them stays thin.
 *
 * The drag starts on a grip handle rather than anywhere on the row. That is
 * what keeps it from fighting the page scroll: a finger that lands on the row
 * itself is still scrolling, exactly as it was before.
 *
 * It has no keyboard equivalent — a drag can't — so it is an accelerator, and
 * every row also carries move-up and move-down buttons that do the same job.
 */

/* ---------- pure helpers ---------- */

/**
 * Move one entry, returning a new array. Out-of-range indices are returned
 * unchanged rather than throwing, because the buttons at the ends of a list
 * would otherwise need to know the length to stay safe.
 */
export function moveItem(list, from, to) {
  const items = [...list];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return items;
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(to, items.length - 1));
  if (target === from) return items;
  const [moved] = items.splice(from, 1);
  items.splice(target, 0, moved);
  return items;
}

/**
 * Which slot a pointer at `y` is over, given each row's rect in order.
 *
 * Measured against row midpoints, so a row swaps once the finger passes half of
 * its neighbour rather than all of it — dragging feels stuck otherwise. Above
 * the first row is 0 and below the last is the final index, so a drag that runs
 * off the end still lands somewhere sensible.
 */
export function dropIndex(y, rects) {
  if (!rects.length) return 0;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (y < rect.top + rect.height / 2) return i;
  }
  return rects.length - 1;
}

/* ---------- gesture ---------- */

/** Blocks page scroll while a row is in hand. Must be non-passive to have effect. */
function blockScroll(event) {
  event.preventDefault();
}

/**
 * Wire up dragging for one list.
 *
 * `container` holds the rows; each row needs a `.drag-handle` inside it.
 * `onDrop(from, to)` fires once, on release, only when the position changed —
 * so a tap on the handle costs nothing and doesn't churn storage or sync.
 */
export function armReorder(container, { onDrop }) {
  container.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.('.drag-handle');
    if (!handle || !event.isPrimary) return;

    const row = handle.closest('[data-index]');
    if (!row) return;

    const rows = () => [...container.querySelectorAll('[data-index]')];
    const from = Number(row.dataset.index);
    let to = from;

    // Measured once, at the start: the rows shift about as the placeholder
    // moves, and re-measuring mid-drag makes the target flicker between slots.
    const rects = rows().map((el) => {
      const box = el.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
    const grabOffset = event.clientY - rects[from].top;

    event.preventDefault();
    row.classList.add('dragging');
    container.classList.add('reordering');
    document.addEventListener('touchmove', blockScroll, { passive: false });
    navigator.vibrate?.(10); // unsupported on iOS Safari; harmless where absent

    const onMove = (moveEvent) => {
      // Follow the finger, offset by wherever on the row it was grabbed, so the
      // row doesn't jump under the thumb on the first pixel of movement.
      row.style.transform = `translateY(${moveEvent.clientY - grabOffset - rects[from].top}px)`;

      const next = dropIndex(moveEvent.clientY, rects);
      if (next === to) return;
      to = next;
      // Shift the rows the dragged one has passed, so the gap follows it.
      for (const el of rows()) {
        const index = Number(el.dataset.index);
        if (index === from) continue;
        let shift = 0;
        if (from < to && index > from && index <= to) shift = -rects[from].height;
        else if (from > to && index >= to && index < from) shift = rects[from].height;
        el.style.transform = shift ? `translateY(${shift}px)` : '';
      }
    };

    const finish = (commit) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('touchmove', blockScroll);
      row.classList.remove('dragging');
      container.classList.remove('reordering');
      for (const el of rows()) el.style.transform = '';
      if (commit && to !== from) onDrop(from, to);
    };

    const onUp = () => finish(true);
    // A cancel is the browser claiming the gesture — expected, not an error.
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}
