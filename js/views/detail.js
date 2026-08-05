/* Movie, TV, and person detail sheets.
 *
 * These live in one module on purpose: a movie sheet opens a cast member, and a
 * cast member's filmography opens a movie. Splitting them into separate files
 * would make that a circular import for no benefit.
 */

import { h, icon, fill, openSheet, displayTitle, emptyState } from '../ui.js';
import {
  getItem,
  upsertItem,
  persist,
  setMovieWatched,
  setEpisodeWatched,
  setSeasonWatched,
  setShowWatched,
  seasonWatchedCount,
  totalEpisodes,
  tvWatchedCount,
  tvProgress,
  realSeasons,
} from '../store.js';
import { movieDetail, tvDetail, seasonDetail, personCredits, posterUrl } from '../tmdb.js';
import { fetchScores } from '../omdb.js';
import {
  heroBlock,
  scoresBlock,
  ratingRow,
  watchlistAction,
  watchedAction,
  castRow,
  snapshot,
} from './parts.js';

/** Entry point for anything tappable in a grid, rail, or list. */
export function openItem(item) {
  if (item.type === 'person') return openPerson(item.id, item.title);
  if (item.type === 'tv') return openTv(item.id, item);
  return openMovie(item.id, item);
}

function loading() {
  return h('div', { style: 'display:grid;place-items:center;padding:60px 0' }, h('div', { class: 'spinner' }));
}

function failure(err) {
  return emptyState({
    title: 'Could not load this title',
    body: err?.message || String(err),
  });
}

/* ---------- movie ---------- */

export function openMovie(id, hint) {
  return openSheet({
    title: hint ? displayTitle(hint, getItem('movie', id)) : 'Loading…',
    render: async (api) => {
      api.body.append(loading());
      let meta;
      try {
        meta = await movieDetail(id);
      } catch (err) {
        fill(api.body, failure(err));
        return;
      }

      // Refresh whatever metadata we already had stored, without claiming this
      // as a user edit for sync purposes.
      if (getItem('movie', id)) upsertItem('movie', id, snapshot(meta), { touch: false });

      const rerenderTitle = () => api.setTitle(displayTitle(meta, getItem('movie', id)));
      rerenderTitle();

      const scores = scoresBlock(meta);
      const rating = ratingRow(meta);
      const watchlist = watchlistAction(meta);
      const watched = watchedAction(
        'Watched',
        () => getItem('movie', id)?.watched ?? false,
        (on) => {
          setMovieWatched(id, on, snapshot(meta));
          watchlist.update();
        }
      );

      fill(api.body, 
        heroBlock(meta, {
          onLangChange: rerenderTitle,
          facts: [meta.year || 'Year unknown', meta.originalLanguage?.toUpperCase()]
            .filter(Boolean)
            .join(' · '),
        }),
        scores.node,
        rating.node,
        h('div', { class: 'action-row' }, watched.node, watchlist.node),
        meta.overview ? h('p', { class: 'overview' }, meta.overview) : null,
        meta.cast?.length ? h('h3', { class: 'section-title' }, 'Cast') : null,
        castRow(meta.cast, (c) => openPerson(c.id, c.name))
      );

      // OMDb is quota-limited, so it only runs here — on an explicit open.
      fetchScores('movie', id, meta.imdbId).then(() => scores.update());
    },
  });
}

/* ---------- tv ---------- */

export function openTv(id, hint) {
  return openSheet({
    title: hint ? displayTitle(hint, getItem('tv', id)) : 'Loading…',
    render: async (api) => {
      api.body.append(loading());
      let meta;
      try {
        meta = await tvDetail(id);
      } catch (err) {
        fill(api.body, failure(err));
        return;
      }

      // Season counts drive the percentage, so store them before anything reads
      // progress — otherwise the first render divides by zero episodes.
      upsertItem('tv', id, snapshot(meta), { touch: false });
      persist('tv-meta');

      const rerenderTitle = () => api.setTitle(displayTitle(meta, getItem('tv', id)));
      rerenderTitle();

      const seasons = realSeasons(getItem('tv', id));
      const scores = scoresBlock(meta);
      const rating = ratingRow(meta);
      const watchlist = watchlistAction(meta);

      /* progress */
      const bar = h('i', { style: 'width:0%' });
      const pctLabel = h('div', { class: 'pct' }, '0%');
      const progress = h('div', { class: 'progress' }, h('div', { class: 'bar' }, bar), pctLabel);

      const showWatched = watchedAction(
        'Mark entire show watched',
        () => getItem('tv', id)?.watched ?? false,
        (on) => {
          setShowWatched(id, on, snapshot(meta));
          refreshAll();
        }
      );

      /* season picker */
      const seasonSelect = h(
        'select',
        {
          class: 'select',
          'aria-label': 'Season',
          onchange: () => renderEpisodes(Number(seasonSelect.value)),
        },
        seasons.map((s) =>
          h('option', { value: String(s.n) }, `${s.name} · ${s.episodes} ep${s.episodes === 1 ? '' : 's'}`)
        )
      );

      const seasonToggle = h('button', { type: 'button', class: 'link-btn' }, 'Mark season watched');
      const seasonCountLabel = h('span', {
        class: 'pct',
        style: 'min-width:auto;flex:1;text-align:left',
      });
      const episodeHost = h('div', { class: 'episodes' });

      const summary = seasons.length
        ? `${seasons.length} season${seasons.length === 1 ? '' : 's'} · ${totalEpisodes(
            getItem('tv', id)
          )} episodes`
        : 'Season data unavailable';

      fill(api.body, 
        heroBlock(meta, {
          onLangChange: rerenderTitle,
          facts: [meta.year ? `First aired ${meta.year}` : 'Year unknown', summary]
            .filter(Boolean)
            .join(' · '),
        }),
        scores.node,
        rating.node,
        progress,
        h('div', { class: 'action-row' }, showWatched.node, watchlist.node),
        meta.overview ? h('p', { class: 'overview' }, meta.overview) : null,
        meta.cast?.length ? h('h3', { class: 'section-title' }, 'Cast') : null,
        castRow(meta.cast, (c) => openPerson(c.id, c.name)),
        seasons.length ? h('h3', { class: 'section-title' }, 'Episodes') : null,
        seasons.length ? seasonSelect : null,
        seasons.length ? h('div', { class: 'season-row' }, seasonCountLabel, seasonToggle) : null,
        episodeHost
      );

      fetchScores('tv', id, meta.imdbId).then(() => scores.update());

      let currentEpisodes = [];

      function refreshProgress() {
        const stored = getItem('tv', id);
        const pct = Math.round(tvProgress(stored) * 100);
        const total = totalEpisodes(stored);
        bar.style.width = `${pct}%`;
        pctLabel.textContent = total
          ? `${pct}% · ${tvWatchedCount(stored)}/${total}`
          : `${pct}%`;
        showWatched.update();
        watchlist.update();
      }

      function refreshSeasonControls() {
        const n = Number(seasonSelect.value);
        const stored = getItem('tv', id);
        const done = seasonWatchedCount(stored, n);
        const total = currentEpisodes.length || seasons.find((s) => s.n === n)?.episodes || 0;
        seasonCountLabel.textContent = total ? `${done} of ${total} watched` : '';
        seasonToggle.textContent =
          total && done >= total ? 'Clear this season' : 'Mark season watched';
      }

      function refreshEpisodeBoxes() {
        const stored = getItem('tv', id);
        const n = Number(seasonSelect.value);
        const watchedMap = stored?.seasons?.[String(n)]?.watched || {};
        for (const row of episodeHost.children) {
          row.setAttribute('aria-pressed', String(Boolean(watchedMap[row.dataset.ep])));
        }
      }

      function refreshAll() {
        refreshProgress();
        refreshSeasonControls();
        refreshEpisodeBoxes();
      }

      seasonToggle.addEventListener('click', () => {
        const n = Number(seasonSelect.value);
        const stored = getItem('tv', id);
        const total = currentEpisodes.length || seasons.find((s) => s.n === n)?.episodes || 0;
        const allDone = total > 0 && seasonWatchedCount(stored, n) >= total;
        const numbers = currentEpisodes.length
          ? currentEpisodes.map((e) => e.number)
          : Array.from({ length: total }, (_, i) => i + 1);
        setSeasonWatched(id, n, numbers, !allDone, snapshot(meta));
        refreshAll();
      });

      async function renderEpisodes(seasonNumber) {
        fill(episodeHost, loading());
        let data;
        try {
          data = await seasonDetail(id, seasonNumber);
        } catch (err) {
          fill(episodeHost, failure(err));
          return;
        }
        // A slower earlier season can land after the user has already switched.
        if (Number(seasonSelect.value) !== seasonNumber) return;

        currentEpisodes = data.episodes;
        fill(episodeHost, 
          data.episodes.map((ep) =>
            h(
              'button',
              {
                type: 'button',
                class: 'episode',
                dataset: { ep: String(ep.number) },
                'aria-pressed': 'false',
                onclick: (event) => {
                  const row = event.currentTarget;
                  const on = row.getAttribute('aria-pressed') !== 'true';
                  setEpisodeWatched(id, seasonNumber, ep.number, on, snapshot(meta));
                  refreshAll();
                },
              },
              h('div', { class: 'box' }, icon('check')),
              h(
                'div',
                { class: 'e-body' },
                h(
                  'div',
                  { class: 'e-title' },
                  h('span', { class: 'e-num' }, `${seasonNumber}×${String(ep.number).padStart(2, '0')}`),
                  ep.title
                ),
                ep.overview ? h('div', { class: 'e-desc' }, ep.overview) : null
              )
            )
          )
        );
        refreshAll();
      }

      refreshProgress();
      if (seasons.length) renderEpisodes(seasons[0].n);
    },
  });
}

/* ---------- person ---------- */

const PERSON_SORTS = {
  'year-desc': { label: 'Newest first', cmp: (a, b) => (b.year || 0) - (a.year || 0) },
  'year-asc': { label: 'Oldest first', cmp: (a, b) => (a.year || 9999) - (b.year || 9999) },
  title: { label: 'Title A–Z', cmp: (a, b) => a.title.localeCompare(b.title) },
  rating: { label: 'Rating', cmp: (a, b) => (b.tmdbScore || 0) - (a.tmdbScore || 0) },
  popularity: { label: 'Popularity', cmp: (a, b) => (b.popularity || 0) - (a.popularity || 0) },
};

export function openPerson(personId, nameHint) {
  return openSheet({
    title: nameHint || 'Loading…',
    render: async (api) => {
      api.body.append(loading());
      let person;
      try {
        person = await personCredits(personId);
      } catch (err) {
        fill(api.body, failure(err));
        return;
      }
      api.setTitle(person.name);

      const listHost = h('div', { class: 'film-list' });
      const sortSelect = h(
        'select',
        { class: 'select', 'aria-label': 'Sort filmography', onchange: () => renderList() },
        Object.entries(PERSON_SORTS).map(([key, s]) =>
          h('option', { value: key }, s.label)
        )
      );

      fill(api.body, 
        h(
          'div',
          { class: 'hero' },
          h(
            'div',
            { class: 'poster', style: 'flex:0 0 92px;border-radius:50%;aspect-ratio:1' },
            posterUrl(person.profile, 'w185')
              ? h('img', { src: posterUrl(person.profile, 'w185'), alt: '' })
              : h('div', { class: 'ph' }, person.name)
          ),
          h(
            'div',
            { class: 'info' },
            h('h1', {}, person.name),
            h(
              'p',
              { class: 'facts' },
              `${person.credits.length} title${person.credits.length === 1 ? '' : 's'}${
                person.knownForDepartment ? ` · ${person.knownForDepartment}` : ''
              }`
            )
          )
        ),
        person.biography
          ? h('p', { class: 'overview' }, person.biography.split('\n')[0].slice(0, 260))
          : null,
        h('div', { class: 'sortbar' }, h('label', {}, 'Sort'), sortSelect),
        listHost
      );

      function renderList() {
        const sorted = [...person.credits].sort(PERSON_SORTS[sortSelect.value].cmp);
        fill(listHost, 
          sorted.map((credit) => {
            const stored = getItem(credit.type, credit.id);
            const bits = [
              credit.type === 'tv' ? 'TV' : 'Film',
              credit.year || '—',
              credit.character || null,
              stored?.watched ? 'Watched' : null,
            ].filter(Boolean);
            const url = posterUrl(credit.poster, 'w92');
            return h(
              'button',
              { type: 'button', class: 'film', onclick: () => openItem(credit) },
              h('div', { class: 'mini' }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : null),
              h(
                'div',
                { class: 'f-body' },
                h('div', { class: 'f-title' }, displayTitle(credit, stored)),
                h('div', { class: 'f-meta' }, bits.join(' · '))
              ),
              stored?.rating === 'up' ? icon('up') : stored?.rating === 'down' ? icon('down') : null
            );
          })
        );
      }

      renderList();
    },
  });
}
