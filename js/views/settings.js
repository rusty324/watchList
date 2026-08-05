/* Settings sheet: API keys, Gist sync, backups.
 *
 * This is the only place secrets are entered or displayed. They're written to a
 * separate localStorage key that the export and sync paths never read.
 */

import { h, fill, openSheet, toast, emptyState } from '../ui.js';
import {
  state,
  secrets,
  saveSecrets,
  setSetting,
  exportData,
  replaceData,
} from '../store.js';
import { checkboxAction } from './parts.js';
import { validateKey, watchRegions, providersForRegion, resolveRegion } from '../tmdb.js';
import { cacheClear } from '../idb.js';
import { quota, quotaRemaining } from '../omdb.js';
import { CHECKS, runChecks } from '../diagnostics.js';
import * as sync from '../sync.js';
import { isMock } from '../mock.js';

export function openSettings() {
  // Held outside `render` so the sheet's onClose can detach the sync watcher.
  let unwatch = () => {};

  return openSheet({
    title: 'Settings',
    onClose: () => unwatch(),
    render: (api) => {
      const body = api.body;

      const field = (label, node, hint) =>
        h('div', { class: 'field' }, h('label', {}, label), node, hint ? h('p', { class: 'hint', html: hint }) : null);

      /* ---- TMDB ---- */

      const tmdbInput = h('input', {
        type: 'text',
        value: secrets.tmdbKey,
        placeholder: 'TMDB API key (v3 auth)',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: false,
      });

      const tmdbStatus = h('p', { class: 'hint' }, '');
      const saveTmdb = h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            const key = tmdbInput.value.trim();
            if (!key) {
              secrets.tmdbKey = '';
              saveSecrets();
              tmdbStatus.textContent = 'Key cleared.';
              return;
            }
            saveTmdb.disabled = true;
            tmdbStatus.textContent = 'Checking…';
            try {
              const ok = await validateKey(key);
              if (!ok) {
                tmdbStatus.textContent = 'TMDB rejected that key.';
                return;
              }
              secrets.tmdbKey = key;
              saveSecrets();
              tmdbStatus.textContent = 'Key saved and verified.';
              toast('TMDB key saved');
            } catch (err) {
              tmdbStatus.textContent = `Could not verify: ${err.message}`;
            } finally {
              saveTmdb.disabled = false;
            }
          },
        },
        'Save & verify'
      );

      /* ---- OMDb ---- */

      const omdbInput = h('input', {
        type: 'text',
        value: secrets.omdbKey,
        placeholder: 'OMDb API key',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: false,
      });

      const saveOmdb = h(
        'button',
        {
          type: 'button',
          class: 'btn secondary',
          onclick: () => {
            secrets.omdbKey = omdbInput.value.trim();
            saveSecrets();
            toast(secrets.omdbKey ? 'OMDb key saved' : 'OMDb key cleared');
          },
        },
        'Save OMDb key'
      );

      const q = quota();

      /* ---- sync ---- */

      const tokenInput = h('input', {
        type: 'password',
        value: secrets.githubToken,
        placeholder: 'GitHub token with "gist" scope',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: false,
      });

      const syncStatusLine = h('p', { class: 'hint' }, '');

      function paintSync() {
        const cls =
          sync.status.state === 'ok' ? 'ok' : sync.status.state === 'error' ? 'err' : sync.status.state === 'busy' ? 'busy' : '';
        const when = sync.status.lastSync
          ? `Last synced ${new Date(sync.status.lastSync).toLocaleTimeString()}`
          : 'Not synced yet';
        fill(syncStatusLine, 
          h('span', { class: `sync-dot ${cls}` }),
          sync.status.message || (sync.isConfigured() ? when : 'Sync is off'),
          secrets.gistId ? h('span', {}, ` · Gist ${secrets.gistId.slice(0, 8)}…`) : null
        );
      }
      unwatch = sync.onSyncChange(paintSync);
      paintSync();

      const connectBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            secrets.githubToken = tokenInput.value.trim();
            saveSecrets();
            if (!secrets.githubToken) {
              toast('Sync turned off');
              paintSync();
              return;
            }
            connectBtn.disabled = true;
            const ok = await sync.connect();
            connectBtn.disabled = false;
            toast(ok ? 'Sync connected' : 'Sync failed — see status');
          },
        },
        'Connect sync'
      );

      const syncNow = h(
        'button',
        {
          type: 'button',
          class: 'btn secondary',
          onclick: async () => {
            await sync.pull();
            await sync.flush();
            toast('Synced');
          },
        },
        'Sync now'
      );

      /* ---- backup ---- */

      const importInput = h('input', {
        type: 'file',
        accept: 'application/json,.json',
        style: 'display:none',
        onchange: async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || typeof parsed.items !== 'object') {
              throw new Error('That file does not look like a watchList backup.');
            }
            replaceData(parsed);
            toast('Backup restored');
            sync.schedule();
          } catch (err) {
            toast(err.message);
          } finally {
            event.target.value = '';
          }
        },
      });

      const exportBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn secondary',
          onclick: () => {
            const blob = new Blob([exportData()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = h('a', {
              href: url,
              download: `watchlist-${new Date().toISOString().slice(0, 10)}.json`,
            });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
        'Save backup'
      );

      /* ---- setup link ---- */

      const setupLink = h(
        'button',
        {
          type: 'button',
          class: 'btn secondary',
          onclick: async () => {
            const packed = btoa(
              JSON.stringify({ t: secrets.tmdbKey, o: secrets.omdbKey })
            );
            const url = `${location.origin}${location.pathname}#/setup=${packed}`;
            try {
              await navigator.clipboard.writeText(url);
              toast('Setup link copied');
            } catch {
              prompt('Copy this link to set up another device:', url);
            }
          },
        },
        'Copy setup link'
      );

      /* ---- title language ---- */

      const langSelect = h(
        'select',
        {
          class: 'select',
          onchange: () => setSetting('defaultTitleLang', langSelect.value),
        },
        h('option', { value: 'en', selected: state.settings.defaultTitleLang === 'en' }, 'English title'),
        h('option', { value: 'original', selected: state.settings.defaultTitleLang === 'original' }, 'Original title')
      );

      /* ---- hide disliked ---- */

      const hideDisliked = checkboxAction(
        'Hide “Not for me” titles',
        () => state.settings.hideDisliked,
        (on) => setSetting('hideDisliked', on)
      );

      /* ---- diagnostics ---- */

      const diagRows = new Map();
      const diagList = h(
        'div',
        { class: 'diag' },
        CHECKS.map((check) => {
          const dot = h('span', { class: 'sync-dot' });
          const detail = h('span', { class: 'd-detail' }, 'Not checked yet.');
          const timing = h('span', { class: 'd-ms' }, '');
          diagRows.set(check.id, { dot, detail, timing });
          return h(
            'div',
            { class: 'diag-row', dataset: { check: check.id } },
            h(
              'div',
              { class: 'd-head' },
              dot,
              h('strong', {}, check.label),
              check.optional ? h('span', { class: 'd-opt' }, 'optional') : null,
              timing
            ),
            h('div', { class: 'd-purpose' }, check.purpose),
            detail
          );
        })
      );

      const runBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn secondary',
          onclick: async () => {
            runBtn.disabled = true;
            runBtn.textContent = 'Checking…';
            for (const { dot, detail, timing } of diagRows.values()) {
              dot.className = 'sync-dot busy';
              detail.textContent = 'Checking…';
              timing.textContent = '';
            }
            try {
              await runChecks((id, result) => {
                const row = diagRows.get(id);
                if (!row) return;
                row.dot.className = `sync-dot ${
                  result.status === 'ok' ? 'ok' : result.status === 'skipped' ? '' : 'err'
                }`;
                row.detail.textContent = result.detail;
                row.timing.textContent = result.ms == null ? '' : `${result.ms} ms`;
              });
            } finally {
              runBtn.disabled = false;
              runBtn.textContent = 'Check connections';
            }
          },
        },
        'Check connections'
      );

      /* ---- where to watch ---- */

      const regionSelect = h(
        'select',
        {
          class: 'select',
          'aria-label': 'Availability region',
          onchange: () => {
            setSetting('region', regionSelect.value);
            // Availability is baked into the cached detail payloads, so they
            // have to go for a region change to take effect.
            cacheClear();
            loadProviderChips();
          },
        },
        h('option', { value: '', selected: !state.settings.region }, `Auto — ${resolveRegion()}`)
      );

      watchRegions()
        .then((regions) => {
          for (const r of regions) {
            regionSelect.append(
              h('option', { value: r.code, selected: state.settings.region === r.code },
                `${r.name} (${r.code})`)
            );
          }
        })
        .catch(() => {
          // No key yet, or offline: the Auto option alone still works.
        });

      const providerFilter = h('input', {
        type: 'search',
        placeholder: 'Filter services',
        autocapitalize: 'none',
        'aria-label': 'Filter services',
      });
      const providerChips = h('div', { class: 'chips chips-wrap' });

      let allProviders = [];

      function paintProviderChips() {
        const q = providerFilter.value.trim().toLowerCase();
        const mine = new Set(state.settings.myProviders || []);
        const shown = allProviders
          .filter((p) => !q || p.name.toLowerCase().includes(q))
          .slice(0, 40);

        fill(providerChips,
          shown.length
            ? shown.map((p) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'chip',
                    'aria-pressed': String(mine.has(p.id)),
                    onclick: (event) => {
                      const next = new Set(state.settings.myProviders || []);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      setSetting('myProviders', [...next]);
                      event.currentTarget.setAttribute('aria-pressed', String(next.has(p.id)));
                    },
                  },
                  p.name
                )
              )
            : h('p', { class: 'hint' }, allProviders.length ? 'No services match.' : 'Add your TMDB key to load services.')
        );
      }

      providerFilter.addEventListener('input', paintProviderChips);

      function loadProviderChips() {
        providersForRegion(resolveRegion())
          .then((list) => {
            allProviders = list;
            paintProviderChips();
          })
          .catch(() => paintProviderChips());
      }
      loadProviderChips();

      const itemCount = Object.keys(state.items).length;

      fill(body, 
        isMock()
          ? h('div', { class: 'note warn' }, h('strong', {}, 'Fixture mode. '), 'Showing canned data; API keys are ignored. Remove ?mock=1 from the URL to use the real APIs.')
          : null,

        h('h3', { class: 'section-title' }, 'API keys'),
        h(
          'div',
          { class: 'note' },
          h('strong', {}, 'Your keys stay on this device. '),
          'This site is static, so there is no server to hold them. They are saved in this browser only and are never included in backups or sync.'
        ),
        field(
          'TMDB key',
          tmdbInput,
          'Required. Powers search, artwork, cast and episode data. Free at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org</a>.'
        ),
        saveTmdb,
        tmdbStatus,
        field(
          'OMDb key',
          omdbInput,
          `Optional. Adds IMDb and Rotten Tomatoes scores. Free at <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener">omdbapi.com</a>. Used ${q.used} of 1000 today (${quotaRemaining()} left).`
        ),
        saveOmdb,

        h('h3', { class: 'section-title' }, 'Diagnostics'),
        h('p', { class: 'hint', style: 'margin:0 0 10px' },
          'If something stops loading, start here — it tells you which service is at fault. ' +
          'The OMDb check spends one of today’s 1000 lookups, so it only runs when you tap.'),
        diagList,
        runBtn,

        h('h3', { class: 'section-title' }, 'Display'),
        field('Default title language for foreign titles', langSelect,
          'Applies to new titles. Each title can still be toggled individually.'),
        hideDisliked.node,
        h('p', { class: 'hint', style: 'margin-top:6px' },
          'Keeps titles you rated “Not for me” out of your Lists and out of Trending. ' +
          'Searching by name still finds them, and the “Not for me” filter on the Lists tab ' +
          'always shows them, so you can always change your mind.'),

        h('h3', { class: 'section-title' }, 'Where to watch'),
        field('Region', regionSelect,
          'Streaming, rental and purchase options differ by country. Availability data comes from JustWatch, via TMDB.'),
        h('label', { class: 'field-label' }, 'My services'),
        h('p', { class: 'hint', style: 'margin:0 0 8px' },
          'Tap the ones you subscribe to. They sort to the front of the Stream row on each title, marked with a check. Nothing gets hidden either way.'),
        providerFilter,
        providerChips,

        h('h3', { class: 'section-title' }, 'Sync'),
        h(
          'div',
          { class: 'note' },
          'Your library is mirrored to a ',
          h('strong', {}, 'private Gist'),
          ' so it survives losing this device and follows you to others. Changes upload a few seconds after you make them.'
        ),
        field(
          'GitHub token',
          tokenInput,
          'Needs the <strong>gist</strong> scope only. Create one at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a>. Stored on this device, never uploaded.'
        ),
        h('div', { class: 'btn-row' }, connectBtn, syncNow),
        syncStatusLine,

        h('h3', { class: 'section-title' }, 'Backup'),
        h('p', { class: 'hint', style: 'margin-bottom:12px' }, `${itemCount} title${itemCount === 1 ? '' : 's'} stored on this device.`),
        h(
          'div',
          { class: 'btn-row' },
          exportBtn,
          h(
            'button',
            { type: 'button', class: 'btn secondary', onclick: () => importInput.click() },
            'Restore backup'
          )
        ),
        importInput,
        setupLink,
        h('p', { class: 'hint' }, 'The setup link carries your API keys so a second device skips this screen. Treat it like a password.'),

        h('h3', { class: 'section-title' }, 'Danger zone'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn danger',
            onclick: () => {
              if (!confirm('Erase every rating, watch mark and list on this device? Your Gist backup is not touched until the next sync.')) return;
              replaceData({ items: {}, settings: state.settings });
              toast('Local data cleared');
            },
          },
          'Erase local data'
        ),

        h('p', { class: 'hint', style: 'margin-top:24px;text-align:center' },
          'watchList — a static site. Add it to your Home Screen to keep Safari from clearing your data.')
      );
    },
  });
}

/** Consumes a #/setup=<base64> link so a second device can skip key entry. */
export function consumeSetupLink() {
  const match = location.hash.match(/^#\/setup=(.+)$/);
  if (!match) return false;
  try {
    const parsed = JSON.parse(atob(match[1]));
    if (parsed.t) secrets.tmdbKey = parsed.t;
    if (parsed.o) secrets.omdbKey = parsed.o;
    saveSecrets();
    history.replaceState(null, '', location.pathname + location.search + '#/browse');
    toast('Keys loaded from setup link');
    return true;
  } catch {
    return false;
  }
}
