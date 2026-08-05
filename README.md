# watchList

A phone-first tracker for the films and shows you've seen, the ones you mean to
get to, and what to watch next. It runs entirely in the browser as a static
site on GitHub Pages — no server, no accounts, no build step.

- **Browse** — search TMDB, or get recommendations built from your own thumbs
  up/down ratings.
- **Lists** — everything you've tracked, filtered and sorted seven ways.
- **Movies** — year, genres, IMDb / Rotten Tomatoes / TMDB scores, a synopsis,
  cast you can tap through to a sortable filmography, and an English ↔ original
  title toggle for foreign films.
- **TV** — the same, plus per-season and per-episode watch tracking with a
  completion percentage when you're partway through.

---

## Setup

### 1. Turn on GitHub Pages

In the repository: **Settings → Pages → Build and deployment → Deploy from a
branch**, and pick this branch with folder `/ (root)`. The site appears at
`https://<you>.github.io/watchList/` within a minute or so.

### 2. Get two API keys

The site is public and static, so there is nowhere to hide a secret. You supply
your own keys and they're stored only in your browser — never in this
repository, and never in your backups or sync data.

| Key | Needed? | What it does | Where |
| --- | --- | --- | --- |
| **TMDB** | Required | Search, artwork, cast, seasons, episodes, recommendations | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| **OMDb** | Optional | IMDb and Rotten Tomatoes scores | [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) |

Both are free and take a couple of minutes. Open the site, and it drops you
straight into Settings to paste them in.

OMDb's free tier allows 1000 lookups a day, so the app only calls it when you
open a title or sort a list by IMDb/RT, then caches the answer for 30 days.
Settings shows how much of today's quota is left. Rotten Tomatoes has no public
API and OMDb's coverage is movie-heavy, so many series show `—` there.

### 3. Add it to your Home Screen

In Safari, **Share → Add to Home Screen**. This matters for more than
convenience: an installed web app is exempt from Safari's rule that clears a
regular site's storage after seven days of not visiting it.

### 4. Optional — sync to a private Gist

Create a GitHub token with **only** the `gist` scope at
[github.com/settings/tokens](https://github.com/settings/tokens), paste it into
Settings, and tap **Connect sync**. Your library is mirrored to a private Gist a
few seconds after each change and pulled back when you open the app, so it
survives a lost phone and follows you between devices.

Conflicts resolve **per title, newest edit wins** — rating a film on your phone
and ticking off episodes on an iPad both survive; only edits to the same title
race each other.

Whether or not you use sync, **Settings → Save backup** writes a JSON file you
can restore later.

Setting up a second device? **Copy setup link** produces a URL carrying your API
keys so you can skip the key entry. It's as sensitive as the keys themselves.

---

## How it works

No framework and no build step: the files in this repository *are* the deployed
site. Push, and Pages serves exactly what you pushed.

```
index.html               app shell + bottom tab bar
manifest.webmanifest     Home Screen install
sw.js                    caches the app shell (never API responses)
css/app.css              design tokens, layout, light + dark themes
js/
  app.js                 boot, hash routing, sync wiring
  store.js               state and persistence
  idb.js                 TTL cache on IndexedDB
  tmdb.js                TMDB client + normalization
  omdb.js                IMDb / Rotten Tomatoes, with quota discipline
  sort.js                list filters and comparators
  recommend.js           recommendation scoring
  sync.js                Gist push/pull and the merge rule
  ui.js                  hyperscript, tiles, sheet presenter
  mock.js                fixtures for ?mock=1
  views/                 browse, lists, detail sheets, settings
tests/                   unit tests + browser walkthrough
```

### Where your data lives

Two separate localStorage keys, on purpose:

- `wl.data.v1` — your ratings, watch marks and lists. This is what gets exported
  and synced.
- `wl.secrets.v1` — API keys and the GitHub token. Device-only. The export and
  sync code paths read from `wl.data.v1` alone, so credentials are structurally
  incapable of leaking into a backup file or your Gist. A test enforces this.

Bulky API payloads (episode lists, filmographies) are cached in IndexedDB rather
than localStorage, so cache growth can't crowd out your watch history.

### A note on specials

"Season 0" — specials, recaps, holiday episodes — is hidden from the season
dropdown and left out of the percentage, so 100% means you've finished the
actual show.

---

## Development

```sh
python3 -m http.server 8765     # then open http://localhost:8765
```

Append `?mock=1` to run against built-in fixtures: no API keys, no network, and
a data set chosen to cover the awkward cases (a foreign film, an English film
that must *not* offer a title toggle, and a show with specials to hide).

**Unit tests** cover the logic worth protecting — percentage math, every sort
comparator, recommendation scoring, the sync merge rule, and the guarantee that
exports contain no secrets:

```sh
node tests/run.mjs
```

**Browser walkthrough** drives the real UI at iPhone size, asserts behaviour,
and screenshots every screen into `tests/shots/`:

```sh
npm install playwright-core
python3 -m http.server 8765 &
BROWSER=/path/to/chrome node tests/walkthrough.mjs
```
