# watchList

A phone-first tracker for the films and shows you've seen, the ones you mean to
get to, and what to watch next. It runs entirely in the browser as a static
site on GitHub Pages — no server, no accounts, no build step.

- **Browse** — search TMDB, or get recommendations built from your own ratings.
- **Genres** — pick a genre, get picks in it you haven't seen, filter to films or
  TV. Anime is its own tile, sourced from AniList.
- **Lists** — everything you've tracked, with filters that combine, eleven sort
  orders, and paging that keeps a four-figure library quick.
- **Playlists** — named, hand-ordered sets of titles, rearranged by drag or by
  button.
- **Three verdicts** — *Liked it*, *One and done* ("glad I saw it, but never
  again"), and *Not for me*, which you can hide from view entirely. Press and
  hold any poster to set one, or to hide a title outright.
- **Where to watch** — what's streaming, free, rentable or buyable in your
  country, with your own subscriptions marked.
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
race each other. Playlists resolve the same way but a whole playlist at a time,
since an order has no element-wise merge.

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
  providers.js           per-region availability index for the platform filters
  reorder.js             drag-a-row-by-its-handle, for playlist order
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

### The three ratings

| | Means | Effect on recommendations |
| --- | --- | --- |
| **Liked it** | Would happily watch again | Seeds a "Because you liked…" row; full positive weight on its genres |
| **One and done** | Glad you saw it, but not looking for a rewatch | Never seeds a row — half positive weight on its genres |
| **Not for me** | Didn't work for you | Steers away: full negative weight on its genres |

The middle option exists so a "worth seeing once" verdict doesn't have to be
filed as either a lie or a thumbs up. Tapping the active rating clears it.

**Settings → Display → Hide "Not for me" titles** keeps disliked titles out of
your Lists and out of Trending. Searching by name still finds them, and the
"Not for me" filter chip on the Lists tab always shows them — so a rating you
hide is never a rating you can't undo.

### Filters that combine

The Lists tab's filters are grouped — Status, Type, Rating, Genre, Stream and
Rent/buy — and several can be on at once. **Picks inside a group widen the
results; picks across groups narrow them.** So Movies + TV + Liked means "liked
films and shows", while Movies + Liked means "liked films".

Grouping is what makes multi-select work here at all: several of these exclude
each other by construction (nothing is both Watched and Not watched, and a title
carries at most one rating), so a flat "match everything selected" would make
half the combinations empty by design.

Genre chips are built from the genres your library actually contains, not the
full catalog of 21 — a genre you own nothing in would only ever return nothing.

**"Not for me" titles are hidden by default.** Selecting the *Not for me* chip
always reveals them, and Settings → Display can turn the hiding off entirely.

### Filtering by platform

Two of those groups — **Stream** and **Rent/buy** — filter by service: what in
your library is on Netflix, what you'd have to buy. Subscription and free/ads
collapse into Stream, since both mean watching it without paying for that title;
rent and buy collapse into Rent/buy, since both are a transaction. As with
genres, the chips only offer services your library is actually on.

These cost something the other filters don't. Every other filter reads a field
already on the title, but availability is a **separate lookup per title, per
country**, and TMDB has no batch endpoint for it. So the app doesn't go and
fetch a hundred of them the moment you open the Lists tab. Instead:

- Opening any title records its availability for free — the sheet was fetching
  it anyway for the Where to watch box.
- A **Find where to watch** control under the filters fills in the rest, in
  batches of 40, telling you how many are left.

A title nobody has checked yet matches no platform, which is the truthful
answer rather than a guess — if a filter comes back empty and something is still
unchecked, the empty state says so.

The index is device-local and keyed by country. It is deliberately **not** part
of your synced data: availability is regional and changes as licences move, so
syncing it would have one device overwrite another's answer with something
neither of you chose, for a value that goes stale on its own anyway. Changing
your region in Settings clears it.

### Long lists

The Lists tab shows **50 titles a page**. The page controls appear twice — a
compact pair beside the Sort menu and a full set under the grid — so turning a
page never means scrolling past fifty posters to reach a button. The bottom one
carries a picker to jump straight to a page; the top one has no room for that
next to a sort menu, so it shows your position and leaves jumping to its twin.

Anything that changes what matches — a filter, a sort, the filter box — takes
you back to page 1, and turning a page returns you to the top.

This is a performance measure, not a tidiness one. Filtering and sorting a
four-figure library costs about **3 ms**; building the tiles is what hurts,
since each is several elements plus a press-and-hold listener that the browser
then has to lay out. Measured at phone speed with 1,200 titles:

| | before | after |
| --- | --- | --- |
| Opening the tab | 1,484 ms | 399 ms |
| Tiles in the page | 660 | 50 |
| Turning a page | — | 60 ms |

The filter box is also **debounced**. It used to redraw on every keystroke, so
typing an eight-letter title meant eight full rebuilds — with a large library
that was the single slowest thing in the app.

Browse and Genres aren't paged: an API page is twenty-odd results, which was
never the problem.

### Search filters

Searching shows chips for type (All / Movies / TV / People) and for the genres
present in the results, a sort control, and a *Hide tracked* toggle.

These narrow **what came back**, not what was asked for: TMDB's multi-search
accepts no type, genre or year parameter. That's why the genre chips are built
from the results themselves — they can only offer genres actually present. For
browsing a whole genre, the Genres tab does it properly.

### Tapping the tab you're already on

Returns you to that tab's root, the way iOS apps do: scrolls to the top, and on
Browse clears the search, and on Genres backs out to the genre grid.

### Rating without opening anything

**Press and hold a poster for about half a second.** Four targets appear around
your fingertip — the three verdicts in a row just above it, and **Hide** just
below — so slide onto one and let go.

```
         [ Liked it ] [ One and done ] [ Not for me ]
                          (finger)
                          [  Hide  ]
```

They open around the **finger**, not around the tile, so the slide is short
wherever on a poster you happened to press. Release without sliding, or
anywhere that isn't a target, and nothing happens. Dragging onto the option
already set undoes it, the same as tapping it twice in the detail sheet.

Works on every poster grid — Browse, Genres and Lists. Anime tiles from the
AniList grid have no TMDB id until they're opened, so releasing on an option
looks up the match first and tells you if there isn't one.

Two things it deliberately doesn't do. There's **no haptic tap**: WebKit never
shipped the Vibration API, so the feedback is visual. And it has **no keyboard
equivalent** — a long-press can't have one — so it's an accelerator rather than
a new capability; the detail sheet's rating row offers the same three verdicts
to everyone.

### Shuffling Top Picks

**Tap ↻ beside "Top picks for you"** for a different eight. Picks are scored,
so without this the same library always produces the same row — recomputing
alone would change nothing.

A shuffle draws from the top 48 candidates, weighted by score: strong matches
still turn up most often, but the rest of the pool gets a look in, and it never
hands back any of the eight you were just shown. It needs no network — TMDB's
recommendations for a title don't change day to day — and only the picks
repaint, so the rows below stay where they were.

The shuffle survives switching tabs. Rating anything resets to the plain
best-first eight, since your taste has just changed. With eight or fewer
candidates — early on, with only a few likes — the button is hidden, because
every shuffle would show the same titles.

### Playlists

A playlist is a handful of titles **in an order you choose** — a run to work
through, a marathon, a set to show someone. The watchlist is one flat bag; this
is the part where sequence matters.

Open any film or show and use **Add to playlist** in its action row. Any title
qualifies, watchlisted or not: a playlist of things you've already seen is as
reasonable as one of things you haven't. The Lists tab's header has a button for
the playlist index, and each playlist opens as its own screen.

Reorder a row by **dragging its handle**, or with the **up/down buttons** beside
it. The handle is why dragging never fights scrolling the page — a finger that
lands anywhere else on the row still scrolls, exactly as before. The buttons
aren't a fallback for weak pointers so much as the only path that works without
one: a drag can't have a keyboard equivalent.

**Marking a title watched leaves it where it is,** with a tick. A playlist is a
record of what you assembled, not a queue that empties itself, so nothing
disappears from under you — remove things when you mean to.

Two notes on how they sync. Playlists merge **per playlist, whole**: unlike a
title, where the newer edit only wins that title's fields, an ordered list
reordered on two devices has no sensible element-wise merge, so the later edit
takes all of it. And deleting one leaves a tombstone rather than removing the
record, because otherwise the other device's copy would simply reappear on the
next pull.

### Hiding a title

**Hide** is the fourth press-and-hold target, and it is not a verdict. *Not for
me* is an opinion — it steers the recommender away from that title's genres.
Hiding records no opinion at all; it just takes the title out of your way.

A hidden title is gone from **Browse, Genres, your recommendations and your
Lists**. Searching by name still finds it, and the sheet then says it's hidden
and offers to un-hide it — the same principle as "Not for me": something you
typed the name of should never look like it doesn't exist.

**Settings → Hidden titles** lists everything you've hidden with an un-hide
button on each, plus *Un-hide all*. Because hiding removes a title from every
grid, that list is the one place it's guaranteed to be reachable.

### When something stops working

**Settings → Diagnostics → Check connections** pings TMDB, OMDb and AniList and
reports each as OK, skipped or failing, with the error and the round-trip time.
Every failure otherwise looks identical from the outside — nothing appears —
whether the cause is an expired key, a service outage, or OMDb's daily quota
running out, so this tells you which.

It only runs when you tap it: the OMDb check genuinely spends one of the day's
1000 lookups. The checks bypass the cache deliberately, so a cached response
can't report a dead service as healthy.

### Genres

The middle tab opens on a grid of 21 genres. Pick one and you get popular titles
in it, minus anything you've already watched, rated, hidden or listed, re-ranked
by your taste — within a single genre the shared genre cancels out, so what actually
moves the order is a candidate's *other* genres. Chips filter to Movies or TV,
and **Show all** drops the exclusion when you'd rather browse a genre's canon
than get new-to-you picks.

Genres that TMDB only has for one medium (Horror is film-only, Reality is
TV-only) don't offer a filter that could only ever come back empty.

**A genre keeps digging.** Subtracting everything you've dealt with used to
leave nothing once you'd worked through the first page of results — and the more
of a genre you'd seen, the more certain that was. It now keeps requesting pages
until it has 40 new-to-you titles, giving up after five. Pages are cached
individually, so going back into a genre costs nothing, and the empty state
tells you how far it looked before running out.

**Genre chips in a detail sheet are tappable** and open that genre with the
medium carried over — a TV show's *Drama* chip opens Drama already filtered to
TV. Outlined chips are the tappable ones. AniList tags are tappable too, opening
an anime browse for that tag.

### Anime, via AniList

**Anime is its own tile**, separate from Animation, and comes from
[AniList](https://anilist.co) rather than TMDB — free, no API key, and much
better at anime than TMDB, which lumps cours into arbitrary "seasons" and files
Ghibli next to Pixar. Animation covers everything else animated.

Open any anime and the sheet gains AniList data on top of TMDB's: the **AniList
score replaces the Rotten Tomatoes cell** (RT essentially never scores anime),
the studio joins the facts line, and AniList tags like *Iyashikei* appear beside
the TMDB genres, tinted blue to show they're from a different source.

TMDB ids stay the app's primary key — AniList is a supplement, never a second
identity, or watch state, watchlists, providers and sync would each split across
two id spaces. An AniList tile resolves to its TMDB entry when you tap it, not
while the grid renders, so a screen of anime costs one request rather than forty.

**Cours are collapsed into one entry per show.** AniList gives each cour its own
record — *Attack on Titan*, *…Season 2*, *…The Final Season* — while TMDB models
the whole thing as one show with four seasons, which is also how this app tracks
it. Later cours are detected through AniList's `PREQUEL` relations and folded
away. A *film* that follows a series (Demon Slayer's *Mugen Train*) has a TV
prequel too but is genuinely its own TMDB entry, so it survives the collapse.

Anime that TMDB has never heard of — obscure OVAs, very new shows — opens a
read-only AniList sheet with its score, studio, synopsis and a link out. It
can't be rated or listed, and says so: tracking is keyed on TMDB ids.

**AniDB was considered and rejected**: it sends no CORS headers, needs a
registered client id on every request, and allows one request per two seconds
with day-long bans for refetching. All of that assumes a server, and this app
deliberately doesn't have one.

### Where to watch

Each detail sheet shows a **Stream / Free / Rent / Buy** box for your country.
The data is JustWatch's, delivered through TMDB, and it rides along on the
request the sheet already makes — so it costs no extra API calls and no extra
key.

Set your country under **Settings → Where to watch**; it's guessed from your
device's locale until you change it. Tap the services you subscribe to under
**My services** and they sort to the front of the Stream row with a check.
Nothing is ever hidden — you still want to see that something left your service
and is now rentable elsewhere.

Three limits come from the data itself: there are **no prices**, availability is
**per country**, and TMDB provides a single JustWatch link per title rather than
per-provider deep links — so tapping *Netflix* opens the availability page, not
Netflix. That link is also how JustWatch gets credited for the data, which their
terms require.

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
