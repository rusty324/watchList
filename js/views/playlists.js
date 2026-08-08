/* Playlists: named, hand-ordered collections of titles.
 *
 * Two states in one view, keyed off the sub-route (`#/lists/playlists` vs
 * `#/lists/playlist/<id>`), the same shape the Genres tab uses — so opening one
 * is a real history entry and the back gesture returns to the index.
 *
 * Rows, not the poster grid used everywhere else, and deliberately so: every
 * tile carries the press-and-hold rating gesture, and a grid of those plus
 * drag-to-reorder would be two gestures competing for the same press.
 */

import { h, icon, clear, fill, emptyState, posterBox, displayTitle, toast } from '../ui.js';
import {
  getItem,
  livePlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  removeFromPlaylist,
  setPlaylistOrder,
} from '../store.js';
import { moveItem, armReorder } from '../reorder.js';
import { openItem } from './detail.js';

/** The stored item behind a playlist entry, which is all a row can draw from. */
function entryFor(key) {
  const [type, id] = key.split(':');
  return getItem(type, Number(id)) || { type, id: Number(id), title: key };
}

export function renderPlaylists(root, segments) {
  clear(root);
  const [what, id] = segments || [];
  if (what === 'playlist' && id) return renderOne(root, id);
  return renderIndex(root);
}

/* ---------- the index ---------- */

function renderIndex(root) {
  const lists = livePlaylists();

  const body = h('div', {});

  const paint = () => {
    const current = livePlaylists();
    if (!current.length) {
      fill(body,
        emptyState({
          iconName: 'queue',
          title: 'No playlists yet',
          body:
            'A playlist is a handful of titles in an order you choose — a run to work ' +
            'through, or a set to show someone. Open any film or show and use “Add to ' +
            'playlist”, or start an empty one here.',
        })
      );
      return;
    }

    fill(body,
      h(
        'div',
        { class: 'pl-index' },
        current.map((playlist) =>
          h(
            'a',
            { class: 'pl-card', href: `#/lists/playlist/${playlist.id}` },
            h(
              'div',
              { class: 'pl-thumbs' },
              // A few covers so a playlist is recognisable at a glance rather
              // than by name alone.
              playlist.items.slice(0, 4).map((key) => posterBox(entryFor(key), 'w92'))
            ),
            h(
              'div',
              { class: 'pl-meta' },
              h('span', { class: 'pl-name' }, playlist.name),
              h(
                'span',
                { class: 'pl-count' },
                `${playlist.items.length} title${playlist.items.length === 1 ? '' : 's'}`
              )
            ),
            icon('forward', 'pl-arrow')
          )
        )
      )
    );
  };

  root.append(
    h(
      'div',
      { class: 'genre-head' },
      h('a', { class: 'icon-btn', href: '#/lists', 'aria-label': 'Back to Lists' }, icon('back')),
      h('h1', { class: 'page-title', style: 'flex:1;margin:0' }, 'Playlists')
    ),
    body,
    h(
      'button',
      {
        type: 'button',
        class: 'btn secondary',
        style: 'margin-top:16px',
        onclick: () => {
          const name = prompt('Name this playlist:', `Playlist ${lists.length + 1}`);
          if (name === null) return;
          const made = createPlaylist(name);
          location.hash = `#/lists/playlist/${made.id}`;
        },
      },
      'New playlist'
    )
  );

  paint();
}

/* ---------- one playlist ---------- */

function renderOne(root, id) {
  const playlist = getPlaylist(id);
  if (!playlist) {
    root.append(
      h(
        'div',
        { class: 'genre-head' },
        h('a', { class: 'icon-btn', href: '#/lists/playlists', 'aria-label': 'All playlists' }, icon('back')),
        h('h1', { class: 'page-title', style: 'flex:1;margin:0' }, 'Playlist')
      ),
      emptyState({
        iconName: 'queue',
        title: 'Playlist not found',
        body: 'It may have been deleted on this device or another one.',
      })
    );
    return;
  }

  const heading = h('h1', { class: 'page-title', style: 'flex:1;margin:0' }, playlist.name);
  const rows = h('div', { class: 'pl-rows' });

  function paint() {
    const live = getPlaylist(id);
    if (!live) return;

    if (!live.items.length) {
      fill(rows,
        emptyState({
          iconName: 'queue',
          title: 'Nothing in here yet',
          body: 'Open a film or show and use “Add to playlist” to put it in this one.',
        })
      );
      return;
    }

    const move = (from, to) => {
      setPlaylistOrder(id, moveItem(live.items, from, to));
      paint();
    };

    fill(rows,
      live.items.map((key, index) => {
        const item = entryFor(key);
        const stored = getItem(item.type, item.id);
        return h(
          'div',
          { class: 'pl-row', dataset: { index: String(index), key } },
          h(
            'span',
            { class: 'drag-handle', 'aria-hidden': 'true', title: 'Drag to reorder' },
            icon('grip')
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'pl-open',
              onclick: () => openItem(stored || item),
            },
            posterBox(stored || item, 'w92'),
            h(
              'span',
              { class: 'pl-text' },
              h('span', { class: 'pl-title' }, displayTitle(item, stored)),
              h(
                'span',
                { class: 'pl-sub' },
                [item.year || null, stored?.watched ? 'Watched' : null].filter(Boolean).join(' · ')
              )
            ),
            // Watching something leaves it in place — the playlist is a record
            // of what you assembled, not a queue that empties itself.
            stored?.watched ? h('span', { class: 'pl-tick' }, icon('check')) : null
          ),
          h(
            'span',
            { class: 'pl-controls' },
            h(
              'button',
              {
                type: 'button',
                class: 'pl-btn',
                'aria-label': `Move ${item.title} up`,
                disabled: index === 0,
                onclick: () => move(index, index - 1),
              },
              icon('chevron-up')
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'pl-btn',
                'aria-label': `Move ${item.title} down`,
                disabled: index === live.items.length - 1,
                onclick: () => move(index, index + 1),
              },
              icon('chevron-down')
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'pl-btn remove',
                'aria-label': `Remove ${item.title}`,
                onclick: () => {
                  removeFromPlaylist(id, key);
                  paint();
                  toast(`Removed from ${live.name}`);
                },
              },
              icon('close')
            )
          )
        );
      })
    );
  }

  // The buttons are the accessible path; the handle is the accelerator. Both
  // end at the same setPlaylistOrder call.
  armReorder(rows, {
    onDrop: (from, to) => {
      const live = getPlaylist(id);
      if (!live) return;
      setPlaylistOrder(id, moveItem(live.items, from, to));
      paint();
    },
  });

  root.append(
    h(
      'div',
      { class: 'genre-head' },
      h('a', { class: 'icon-btn', href: '#/lists/playlists', 'aria-label': 'All playlists' }, icon('back')),
      heading,
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Rename playlist',
          onclick: () => {
            const next = prompt('Rename this playlist:', getPlaylist(id)?.name || '');
            if (next === null) return;
            const renamed = renamePlaylist(id, next);
            if (renamed) heading.textContent = renamed.name;
          },
        },
        icon('settings')
      )
    ),
    h('p', { class: 'hint', style: 'margin:0 0 12px' },
      'Drag a row by its handle, or use the arrows, to change the order.'),
    rows,
    h(
      'button',
      {
        type: 'button',
        class: 'btn danger',
        style: 'margin-top:20px',
        onclick: () => {
          const live = getPlaylist(id);
          if (!confirm(`Delete “${live?.name}”? The titles themselves are not touched.`)) return;
          deletePlaylist(id);
          toast('Playlist deleted');
          location.hash = '#/lists/playlists';
        },
      },
      'Delete playlist'
    )
  );

  paint();
}

/** How many playlists exist, for the Lists tab's header button. */
export function playlistCount() {
  return livePlaylists().length;
}
