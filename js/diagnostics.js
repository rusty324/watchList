/* Health checks for the three services the app depends on.
 *
 * When something stops loading, the symptom is always the same — nothing
 * appears — and the cause could be an expired key, an outage, or OMDb's daily
 * quota running out. This says which.
 *
 * Every check makes a direct, uncached call. Going through `cached()` in
 * js/idb.js would let IndexedDB answer and report a dead service as healthy,
 * which is precisely the failure this is meant to catch.
 *
 * The classify* functions are pure so the mapping from API response to verdict
 * is testable without network.
 */

import { secrets } from './store.js';
import { validateKey } from './tmdb.js';
import { ping as omdbPing, quotaRemaining } from './omdb.js';
import { ping as anilistPing } from './anilist.js';
import { isMock } from './mock.js';

/* ---------- classifiers ---------- */

export function classifyTmdb({ valid, error }) {
  if (error) {
    // A rejected key and an unreachable host are different problems with
    // different fixes, so they must not collapse into one message.
    if (error.status === 401) return { status: 'error', detail: 'Key rejected — check it above.' };
    return { status: 'error', detail: error.message || 'Could not reach TMDB.' };
  }
  if (!valid) return { status: 'error', detail: 'Key rejected — check it above.' };
  return { status: 'ok', detail: 'Responding normally.' };
}

export function classifyOmdb({ payload, error }) {
  if (error) return { status: 'error', detail: error.message || 'Could not reach OMDb.' };
  if (payload?.Response === 'False') {
    const message = payload.Error || 'Request refused.';
    return {
      status: 'error',
      detail: /key/i.test(message) ? 'Key rejected — check it above.' : message,
    };
  }
  const left = quotaRemaining();
  return {
    status: 'ok',
    // Quota exhaustion looks exactly like an outage from the outside, so the
    // remaining count belongs here rather than only next to the key field.
    detail: `Responding normally. ${left} of 1000 lookups left today.`,
  };
}

export function classifyAnilist({ data, error }) {
  if (error) return { status: 'error', detail: error.message || 'Could not reach AniList.' };
  // GraphQL reports failures in-band with HTTP 200, so a status code alone lies.
  if (data?.errors?.length) {
    return { status: 'error', detail: data.errors[0].message || 'Query rejected.' };
  }
  if (!data?.Media) return { status: 'error', detail: 'Responded, but returned no data.' };
  return { status: 'ok', detail: 'Responding normally. No key needed.' };
}

/* ---------- checks ---------- */

export const CHECKS = [
  {
    id: 'tmdb',
    label: 'TMDB',
    purpose: 'Search, artwork, cast, episodes',
    needsKey: () => Boolean(secrets.tmdbKey),
    async run() {
      try {
        return classifyTmdb({ valid: await validateKey(secrets.tmdbKey) });
      } catch (error) {
        return classifyTmdb({ error });
      }
    },
  },
  {
    id: 'omdb',
    label: 'OMDb',
    purpose: 'IMDb and Rotten Tomatoes scores',
    optional: true,
    needsKey: () => Boolean(secrets.omdbKey),
    async run() {
      try {
        return classifyOmdb({ payload: await omdbPing() });
      } catch (error) {
        return classifyOmdb({ error });
      }
    },
  },
  {
    id: 'anilist',
    label: 'AniList',
    purpose: 'Anime titles, scores and tags',
    needsKey: () => true, // no key exists to be missing
    async run() {
      try {
        return classifyAnilist({ data: await anilistPing() });
      } catch (error) {
        return classifyAnilist({ error });
      }
    },
  },
];

/**
 * Run every check, reporting each as it lands so rows fill in progressively
 * rather than sitting blank until the slowest one returns.
 */
export async function runChecks(onResult) {
  await Promise.all(
    CHECKS.map(async (check) => {
      if (isMock()) {
        // No timing: nothing was sent, and "0 ms" would imply otherwise.
        onResult(check.id, { status: 'ok', detail: 'Fixture mode — not a real request.', ms: null });
        return;
      }
      if (!check.needsKey()) {
        onResult(check.id, {
          status: 'skipped',
          detail: check.optional ? 'No key set — this one is optional.' : 'No key set.',
          ms: null,
        });
        return;
      }
      const started = Date.now();
      const result = await check.run();
      onResult(check.id, { ...result, ms: Date.now() - started });
    })
  );
}
