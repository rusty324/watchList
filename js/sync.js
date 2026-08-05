/* Private-Gist sync.
 *
 * localStorage stays the source of truth; the Gist is a durable mirror so the
 * library survives a lost phone and follows you between devices. Writes are
 * debounced, and a pull runs at app open.
 *
 * Conflict rule: last edit wins PER ITEM, not per blob. Rating a film on your
 * phone and checking off episodes on an iPad therefore both survive — only
 * edits to the *same* title race, and there the newer `updatedAt` wins.
 */

import { state, secrets, saveSecrets, persistNow, notifyAll } from './store.js';

const API = 'https://api.github.com';
const FILENAME = 'watchlist-data.json';
const DEBOUNCE_MS = 5000;

let timer = null;
let pushing = false;
let queuedWhilePushing = false;

export const status = {
  state: 'idle', // idle | busy | ok | error | off
  message: '',
  lastSync: null,
};

const watchers = new Set();

export function onSyncChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function setStatus(next, message = '') {
  status.state = next;
  status.message = message;
  if (next === 'ok') status.lastSync = Date.now();
  for (const fn of watchers) fn(status);
}

export function isConfigured() {
  return Boolean(secrets.githubToken);
}

/* ---------- merge ---------- */

/**
 * Merge two data payloads. Pure — no I/O — so the conflict rule is testable.
 * Settings follow whichever side was written more recently overall.
 */
export function mergeData(local, remote) {
  const items = { ...(remote?.items || {}) };

  for (const [key, mine] of Object.entries(local?.items || {})) {
    const theirs = items[key];
    if (!theirs) {
      items[key] = mine;
      continue;
    }
    const winner = (mine.updatedAt || 0) >= (theirs.updatedAt || 0) ? mine : theirs;
    const loser = winner === mine ? theirs : mine;

    // Scores are background metadata written with touch:false, so they never
    // bump updatedAt and must be merged on their own freshness.
    const scores =
      (winner.scores?.fetchedAt || 0) >= (loser.scores?.fetchedAt || 0)
        ? winner.scores
        : loser.scores;

    items[key] = scores ? { ...winner, scores } : { ...winner };
  }

  const localNewer = newestEdit(local) >= newestEdit(remote);
  return {
    version: local?.version || remote?.version || 1,
    items,
    settings: {
      ...(remote?.settings || {}),
      ...(localNewer ? local?.settings || {} : {}),
    },
  };
}

function newestEdit(data) {
  let newest = 0;
  for (const item of Object.values(data?.items || {})) {
    if ((item.updatedAt || 0) > newest) newest = item.updatedAt || 0;
  }
  return newest;
}

/* ---------- github ---------- */

async function gh(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      authorization: `Bearer ${secrets.githubToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token.');
  if (res.status === 403) throw new Error('GitHub refused: token needs the "gist" scope.');
  if (res.status === 404) throw new Error('Gist not found — it may have been deleted.');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  return res.json();
}

function payload() {
  // Built from `state` only. Secrets live in a different storage key and are
  // structurally unreachable from here.
  return JSON.stringify({ version: state.version, items: state.items, settings: state.settings }, null, 2);
}

async function readGist(id) {
  const gist = await gh(`/gists/${id}`);
  const file = gist.files?.[FILENAME];
  if (!file) return null;
  // GitHub truncates inline content past ~1 MB and hands back a raw URL.
  const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('The Gist contains invalid JSON.');
  }
}

/* ---------- public API ---------- */

export async function pull({ quiet = false } = {}) {
  if (!isConfigured() || !secrets.gistId) return false;
  if (!quiet) setStatus('busy', 'Checking for changes…');
  try {
    const remote = await readGist(secrets.gistId);
    if (remote) {
      const merged = mergeData({ items: state.items, settings: state.settings, version: state.version }, remote);
      state.items = merged.items;
      state.settings = merged.settings;
      persistNow();
      notifyAll('sync-pull');
    }
    setStatus('ok');
    return true;
  } catch (err) {
    setStatus('error', err.message);
    return false;
  }
}

export async function push() {
  if (!isConfigured()) return false;
  if (pushing) {
    queuedWhilePushing = true;
    return false;
  }
  pushing = true;
  setStatus('busy', 'Saving…');
  try {
    const body = JSON.stringify({
      description: 'watchList — personal tracker data',
      files: { [FILENAME]: { content: payload() } },
    });

    if (secrets.gistId) {
      await gh(`/gists/${secrets.gistId}`, { method: 'PATCH', body });
    } else {
      const created = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: 'watchList — personal tracker data',
          public: false,
          files: { [FILENAME]: { content: payload() } },
        }),
      });
      secrets.gistId = created.id;
      saveSecrets();
    }
    setStatus('ok');
    return true;
  } catch (err) {
    setStatus('error', err.message);
    return false;
  } finally {
    pushing = false;
    if (queuedWhilePushing) {
      queuedWhilePushing = false;
      schedule();
    }
  }
}

/** Debounced push — a burst of episode checkboxes results in one upload. */
export function schedule() {
  if (!isConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => push(), DEBOUNCE_MS);
}

export async function flush() {
  clearTimeout(timer);
  if (isConfigured()) await push();
}

/** First-time setup: create the Gist and seed it with whatever is local. */
export async function connect() {
  secrets.gistId = secrets.gistId || '';
  const ok = await push();
  if (ok) await pull({ quiet: true });
  return ok;
}
