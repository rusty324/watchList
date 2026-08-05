/* Building blocks shared by the movie and TV detail sheets.
 *
 * These return a node plus an `update()` so a tap can refresh just the affected
 * control instead of re-rendering the sheet — which would throw away the user's
 * scroll position halfway down a season's episode list.
 */

import { h, icon, posterBox, displayTitle, toast } from '../ui.js';
import { profileUrl, posterUrl } from '../tmdb.js';
import {
  state,
  getItem,
  setRating,
  clearRating,
  setWatchlist,
  setTitlePref,
} from '../store.js';

/* ---------- hero ---------- */

export function heroBlock(meta, { onLangChange, facts }) {
  const stored = getItem(meta.type, meta.id);
  const titleEl = h('h1', {}, displayTitle(meta, stored));

  // The secondary line shows whichever title isn't currently primary, so a
  // foreign film always displays both names somewhere on the sheet.
  const altEl = meta.foreign
    ? h('p', { class: 'alt-title' }, otherTitle(meta, stored))
    : null;

  let toggle = null;
  if (meta.foreign) {
    const mk = (pref, label) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(titlePrefOf(stored) === pref),
          onclick: () => {
            setTitlePref(meta.type, meta.id, pref);
            const s = getItem(meta.type, meta.id);
            titleEl.textContent = displayTitle(meta, s);
            if (altEl) altEl.textContent = otherTitle(meta, s);
            for (const b of toggle.children) {
              b.setAttribute('aria-pressed', String(b.dataset.pref === pref));
            }
            onLangChange?.(pref);
          },
          dataset: { pref },
        },
        label
      );
    toggle = h('div', { class: 'lang-toggle' }, mk('en', 'English'), mk('original', 'Original'));
  }

  return h(
    'div',
    { class: 'hero' },
    posterBox(meta, 'w342'),
    h(
      'div',
      { class: 'info' },
      titleEl,
      altEl,
      h('p', { class: 'facts' }, facts),
      meta.genres?.length
        ? h('div', { class: 'genres' }, meta.genres.map((g) => h('span', {}, g)))
        : null,
      toggle
    )
  );
}

function titlePrefOf(stored) {
  return stored?.titlePref || state.settings.defaultTitleLang || 'en';
}

function otherTitle(meta, stored) {
  return titlePrefOf(stored) === 'original' ? meta.title : meta.originalTitle;
}

/* ---------- scores ---------- */

export function scoresBlock(meta) {
  const node = h('div', { class: 'scores' });

  const cell = (cls, label) => {
    const val = h('div', { class: 's-val' }, '—');
    node.append(
      h('div', { class: `score ${cls}` }, h('div', { class: 's-label' }, label), val)
    );
    return val;
  };

  const imdbVal = cell('imdb', 'IMDb');
  const rtVal = cell('rt', 'Rotten Tom.');
  const tmdbVal = cell('tmdb', 'TMDB');

  const update = () => {
    const s = getItem(meta.type, meta.id)?.scores || {};
    imdbVal.textContent = s.imdb != null ? s.imdb.toFixed(1) : '—';
    rtVal.textContent = s.rt != null ? `${s.rt}%` : '—';
    tmdbVal.textContent = meta.tmdbScore != null ? meta.tmdbScore.toFixed(1) : '—';
  };
  update();

  return { node, update };
}

/* ---------- personal rating ---------- */

/**
 * The three verdicts, with the sentence each one stands for. The buttons only
 * have room for the short label, so the caption below the row carries the
 * meaning — particularly for "One and done", which is the whole point of having
 * a middle option.
 */
export const RATING_LABELS = {
  up: { short: 'Liked it', caption: 'Liked it — would happily watch again.' },
  once: {
    short: 'One and done',
    caption: 'Glad you saw it — but not looking for a rewatch.',
  },
  down: { short: 'Not for me', caption: 'Not for me — steers recommendations away.' },
};

export function ratingRow(meta, onChange) {
  const mk = (kind) =>
    h(
      'button',
      {
        type: 'button',
        class: `rating-btn ${kind}`,
        'aria-pressed': 'false',
        onclick: () => {
          const next = setRating(meta.type, meta.id, kind, snapshot(meta));
          update();
          onChange?.(next);
        },
      },
      icon(kind),
      h('span', {}, RATING_LABELS[kind].short)
    );

  const buttons = { up: mk('up'), once: mk('once'), down: mk('down') };
  const row = h('div', { class: 'rating-row' }, buttons.up, buttons.once, buttons.down);

  const caption = h('span', { class: 'r-text' }, '');
  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 'link-btn',
      onclick: () => {
        clearRating(meta.type, meta.id);
        update();
        onChange?.(null);
      },
    },
    'Clear'
  );
  const captionRow = h('div', { class: 'rating-caption' }, caption, clearBtn);

  const node = h('div', {}, row, captionRow);

  function update() {
    const r = getItem(meta.type, meta.id)?.rating || null;
    for (const [kind, button] of Object.entries(buttons)) {
      button.setAttribute('aria-pressed', String(r === kind));
    }
    caption.textContent = r
      ? RATING_LABELS[r].caption
      : 'Rate this to shape your recommendations.';
    clearBtn.hidden = !r;
  }
  update();

  return { node, update };
}

/* ---------- watchlist ---------- */

export function watchlistAction(meta, onChange) {
  const label = h('span', {}, 'Add to watchlist');
  const node = h(
    'button',
    {
      type: 'button',
      class: 'action primary',
      'aria-pressed': 'false',
      onclick: () => {
        const on = !(getItem(meta.type, meta.id)?.inWatchlist ?? false);
        setWatchlist(meta.type, meta.id, on, snapshot(meta));
        update();
        toast(on ? 'Added to watchlist' : 'Removed from watchlist');
        onChange?.(on);
      },
    },
    label
  );

  function update() {
    const on = getItem(meta.type, meta.id)?.inWatchlist ?? false;
    node.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'On your watchlist — remove' : 'Add to watchlist';
  }
  update();

  return { node, update };
}

/* ---------- checkbox row ---------- */

/** Generic labelled checkbox: used for watch marks and for Settings toggles. */
export function checkboxAction(label, isOn, setOn) {
  const box = h('div', { class: 'box' }, icon('check'));
  const text = h('span', {}, label);
  const node = h(
    'button',
    {
      type: 'button',
      class: 'action',
      'aria-pressed': 'false',
      onclick: () => {
        setOn(!isOn());
        update();
      },
    },
    box,
    text
  );

  function update() {
    node.setAttribute('aria-pressed', String(Boolean(isOn())));
  }
  update();

  return { node, update };
}

/* ---------- where to watch ---------- */

const PROVIDER_ROWS = [
  ['stream', 'Stream'],
  ['free', 'Free'],
  ['rent', 'Rent'],
  ['buy', 'Buy'],
];

/**
 * Availability box, from TMDB's JustWatch feed.
 *
 * Two things here are licensing obligations rather than style choices: the
 * JustWatch credit, and sending taps to TMDB's own `link`. The API exposes no
 * per-provider deep links, so a "Netflix" chip cannot open Netflix — the footer
 * says where it does go rather than implying otherwise.
 */
export function providerBox(providers) {
  if (!providers) return null;

  const mine = new Set(state.settings.myProviders || []);
  const open = () => {
    if (providers.link) window.open(providers.link, '_blank', 'noopener');
  };

  const chip = (provider, subscribed) =>
    h(
      'button',
      {
        type: 'button',
        class: `prov-chip${subscribed ? ' mine' : ''}`,
        onclick: open,
        title: subscribed ? `${provider.name} — you subscribe to this` : provider.name,
      },
      h(
        'span',
        { class: 'p-logo' },
        posterUrl(provider.logo, 'w92')
          ? h('img', { src: posterUrl(provider.logo, 'w92'), alt: '', loading: 'lazy' })
          : provider.name.slice(0, 1)
      ),
      h('span', { class: 'p-name' }, provider.name),
      subscribed ? icon('check', 'p-mine') : null
    );

  const rows = PROVIDER_ROWS.map(([key, label]) => {
    const list = providers[key];
    if (!list?.length) return null;
    // Services you pay for belong at the front of the row you'd check first.
    const ordered =
      key === 'stream'
        ? [...list.filter((p) => mine.has(p.id)), ...list.filter((p) => !mine.has(p.id))]
        : list;
    return h(
      'div',
      { class: 'prov-row', dataset: { row: key } },
      h('div', { class: 'p-label' }, label),
      h('div', { class: 'p-strip' }, ordered.map((p) => chip(p, mine.has(p.id))))
    );
  }).filter(Boolean);

  const credit = h(
    'button',
    { type: 'button', class: 'prov-note', onclick: open, disabled: !providers.link },
    `Availability from JustWatch · ${providers.region}`,
    providers.link ? h('span', { class: 'p-arrow' }, ' ›') : null
  );

  return h(
    'section',
    { class: 'providers' },
    h('h3', { class: 'section-title' }, 'Where to watch'),
    rows.length
      ? rows
      : h(
          'p',
          { class: 'prov-empty' },
          `Not listed to stream, rent or buy in ${providers.region}. Change your region in Settings if that looks wrong.`
        ),
    credit
  );
}

/* ---------- cast ---------- */

export function castRow(cast, onOpenPerson) {
  if (!cast?.length) return null;
  return h(
    'div',
    { class: 'cast' },
    cast.slice(0, 8).map((c) =>
      h(
        'button',
        { type: 'button', class: 'cast-member', onclick: () => onOpenPerson(c) },
        h(
          'div',
          { class: 'avatar' },
          profileUrl(c.profile)
            ? h('img', { src: profileUrl(c.profile), alt: '', loading: 'lazy' })
            : initials(c.name)
        ),
        h('div', { class: 'c-name' }, c.name),
        c.character ? h('div', { class: 'c-role' }, c.character) : null
      )
    )
  );
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/* ---------- metadata snapshot ---------- */

/**
 * The subset of API metadata worth persisting alongside a user's choices, so
 * lists render (and sort) offline without re-fetching every title.
 */
export function snapshot(meta) {
  return {
    type: meta.type,
    id: meta.id,
    title: meta.title,
    originalTitle: meta.originalTitle,
    originalLanguage: meta.originalLanguage,
    foreign: meta.foreign,
    year: meta.year,
    poster: meta.poster,
    genres: meta.genres,
    overview: meta.overview,
    imdbId: meta.imdbId,
    tmdbScore: meta.tmdbScore,
    ...(meta.type === 'tv'
      ? {
          seasonMeta: meta.seasonMeta,
          seasonCount: meta.seasonCount,
          episodeCount: meta.episodeCount,
        }
      : {}),
  };
}
