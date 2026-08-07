/* End-to-end walkthrough: drives the app at iPhone size in fixture mode,
 * asserts the behaviours that are easy to break, and writes a screenshot of
 * every screen.
 *
 * Needs a browser and playwright-core, neither of which the app itself depends
 * on:
 *
 *   npm install playwright-core
 *   python3 -m http.server 8765 &
 *   BROWSER=/path/to/chrome node tests/walkthrough.mjs
 *
 * Screenshots land in tests/shots/. Exits non-zero if any check fails or the
 * page logs an error.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = `${process.env.BASE_URL || 'http://127.0.0.1:8765'}/index.html?mock=1`;
const OUT = new URL('./shots/', import.meta.url).pathname;
const problems = [];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.BROWSER || undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: process.env.SCHEME === 'light' ? 'light' : 'dark',
});
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

/* ---- 1. browse, cold start ---- */
if (await page.locator('.searchbar .s-clear').isVisible()) {
  problems.push('the clear-search button is visible with an empty field');
}
await shot('01-browse-cold');

/* ---- 2. search ---- */
await page.fill('input[type="search"]', 'para');
await page.waitForTimeout(700);
await shot('02-search');

/* ---- 3. movie detail: foreign title ---- */
await page.click('.grid .tile');
await page.waitForTimeout(700);
await shot('03-movie-parasite');

// language toggle
await page.click('.lang-toggle button[data-pref="original"]');
await page.waitForTimeout(200);
const heroTitle = await page.textContent('.hero h1');
console.log('title after toggle ->', heroTitle);
if (!/기생충/.test(heroTitle)) problems.push('language toggle did not switch to the original title');
await shot('04-movie-original-title');

// three rating buttons must fit one row at 390px without overflowing —
// the layout risk in offering a middle verdict alongside the two thumbs
const ratingRow = page.locator('.rating-row');
const rowBox = await ratingRow.boundingBox();
const btnBoxes = await Promise.all(
  (await page.locator('.rating-btn').all()).map((b) => b.boundingBox())
);
console.log('rating buttons ->', btnBoxes.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '));
if (btnBoxes.length !== 3) problems.push(`expected 3 rating buttons, found ${btnBoxes.length}`);
if (new Set(btnBoxes.map((b) => Math.round(b.y))).size !== 1) {
  problems.push('rating buttons wrapped onto more than one row');
}
for (const b of btnBoxes) {
  if (b.x < rowBox.x - 1 || b.x + b.width > rowBox.x + rowBox.width + 1) {
    problems.push('a rating button overflows the row');
  }
}

/* ---- where to watch ---- */
const rowNames = async (row) =>
  page.locator(`.prov-row[data-row="${row}"] .p-name`).allTextContents();

const streamRow = await rowNames('stream');
const freeRow = await rowNames('free');
console.log('stream ->', streamRow.join(', '));
console.log('free ->', freeRow.join(', '));
console.log('rent ->', (await rowNames('rent')).join(', '));
console.log('buy ->', (await rowNames('buy')).join(', '));

// sorted by TMDB's display_priority, not fixture order
if (streamRow.join('|') !== 'Netflix|Max|Hulu') {
  problems.push(`stream row wrong or unsorted: ${streamRow.join('|')}`);
}
// Tubi is in both `free` and `ads` upstream and must appear once
if (freeRow.filter((n) => n === 'Tubi TV').length !== 1) {
  problems.push(`Tubi listed ${freeRow.filter((n) => n === 'Tubi TV').length} times in the free row`);
}
// all four chip strips must start at the same x, or the box looks ragged
const stripX = await Promise.all(
  (await page.locator('.prov-row .p-strip').all()).map(async (s) => Math.round((await s.boundingBox()).x))
);
console.log('strip start positions ->', stripX.join(', '));
if (new Set(stripX).size !== 1) {
  problems.push(`provider rows are not aligned: strips start at ${stripX.join(', ')}`);
}

const credit = await page.textContent('.prov-note');
console.log('credit ->', credit);
if (!/JustWatch/.test(credit)) problems.push('the JustWatch attribution line is missing');
await shot('04a-movie-where-to-watch');

// the middle rating, and the caption that carries its meaning
await page.click('.rating-btn.once');
await page.waitForTimeout(250);
const onceCaption = await page.textContent('.rating-caption .r-text');
console.log('caption after "one and done" ->', onceCaption);
if (!/rewatch/i.test(onceCaption)) {
  problems.push(`"one and done" caption did not explain itself: "${onceCaption}"`);
}
if ((await page.getAttribute('.rating-btn.once', 'aria-pressed')) !== 'true') {
  problems.push('"one and done" did not register as selected');
}
await shot('05a-movie-one-and-done');

// tapping it again clears back to no rating
await page.click('.rating-btn.once');
await page.waitForTimeout(250);
if ((await page.getAttribute('.rating-btn.once', 'aria-pressed')) !== 'false') {
  problems.push('tapping "one and done" a second time did not clear it');
}

// rate + watched + watchlist
await page.click('.rating-btn.up');
await page.click('.action-row .action:not(.primary)');
await page.waitForTimeout(300);
await shot('05-movie-rated-watched');

/* ---- 4. cast member ---- */
await page.click('.cast-member');
await page.waitForTimeout(700);
await shot('06-person');
await page.selectOption('.sortbar select', 'year-asc');
await page.waitForTimeout(300);
const glyph = page.locator('.film > svg').first();
if (await glyph.count()) {
  const box = await glyph.boundingBox();
  console.log('filmography rating glyph ->', box.width, 'x', box.height);
  if (box.width > 30 || box.height > 30) {
    problems.push(`filmography rating glyph is unconstrained (${box.width}x${box.height})`);
  }
}
await shot('07-person-sorted');

// back out of person + movie
await page.goBack();
await page.waitForTimeout(500);
await page.goBack();
await page.waitForTimeout(600);

/* ---- 5. english movie must NOT have a toggle ---- */
await page.fill('input[type="search"]', 'princess');
await page.waitForTimeout(700);
await page.click('.grid .tile');
await page.waitForTimeout(700);
const toggles = await page.locator('.lang-toggle').count();
console.log('princess bride lang toggles ->', toggles);
if (toggles !== 0) problems.push('The Princess Bride wrongly offers a language toggle');

// rent/buy only: empty rows must not render at all
if (await page.locator('.prov-row[data-row="stream"]').count()) {
  problems.push('a Stream row rendered for a title with nothing to stream');
}
if (!(await page.locator('.prov-row[data-row="rent"]').count())) {
  problems.push('the Rent row is missing for a rent-only title');
}
await shot('08-movie-english-no-toggle');
await page.goBack();
await page.waitForTimeout(500);

/* ---- a title with no availability at all ---- */
await page.fill('input[type="search"]', 'spirited');
await page.waitForTimeout(700);
await page.click('.grid .tile');
await page.waitForTimeout(800);
const emptyNote = await page.textContent('.prov-empty');
console.log('no-availability note ->', emptyNote);
if (!/US/.test(emptyNote)) problems.push('the empty availability note does not name the region');
if (await page.locator('.prov-row').count()) {
  problems.push('provider rows rendered for a title with no availability');
}
await shot('08a-movie-no-availability');
await page.goBack();
await page.waitForTimeout(500);

/* ---- 6. TV detail ---- */
await page.fill('input[type="search"]', 'breaking');
await page.waitForTimeout(700);
await page.click('.grid .tile');
await page.waitForTimeout(900);

const seasonOptions = await page.locator('.sheet select option').allTextContents();
console.log('season options ->', seasonOptions.join(' | '));
if (seasonOptions.some((t) => /special/i.test(t))) problems.push('specials leaked into the season dropdown');
if (seasonOptions.length !== 5) problems.push(`expected 5 seasons, got ${seasonOptions.length}`);
await shot('09-tv-breaking-bad');

// check three episodes -> partial percentage
await page.locator('.episode').nth(0).click();
await page.locator('.episode').nth(1).click();
await page.locator('.episode').nth(2).click();
await page.waitForTimeout(300);
const pct3 = await page.textContent('.progress .pct');
console.log('after 3 episodes ->', pct3);
if (!pct3.includes('3/62')) problems.push(`expected 3/62 watched, got "${pct3}"`);
await shot('10-tv-partial');

// whole season
await page.click('.season-row .link-btn');
await page.waitForTimeout(300);
const pctSeason = await page.textContent('.progress .pct');
console.log('after season 1 ->', pctSeason);
if (!pctSeason.includes('7/62')) problems.push(`expected 7/62 after season 1, got "${pctSeason}"`);

// switch to season 2 and confirm episodes reload
await page.selectOption('.sheet select', '2');
await page.waitForTimeout(700);
const s2count = await page.locator('.episode').count();
console.log('season 2 episode count ->', s2count);
if (s2count !== 13) problems.push(`season 2 should list 13 episodes, listed ${s2count}`);
await shot('11-tv-season-2');

// whole show
await page.click('.action-row .action:not(.primary)');
await page.waitForTimeout(400);
const pctAll = await page.textContent('.progress .pct');
console.log('after mark whole show ->', pctAll);
if (!pctAll.startsWith('100%')) problems.push(`expected 100%, got "${pctAll}"`);
await shot('12-tv-complete');

await page.goBack();
await page.waitForTimeout(600);

/* ---- 7. seed a few more ratings for the lists + recs ---- */
for (const [query, rating] of [['squid', 'up'], ['spirited', 'once'], ['pulp', 'down']]) {
  await page.fill('input[type="search"]', query);
  await page.waitForTimeout(700);
  await page.click('.grid .tile');
  await page.waitForTimeout(800);
  await page.click(`.rating-btn.${rating}`);
  await page.waitForTimeout(200);
  if (rating === 'up') await page.click('.action-row .action.primary'); // watchlist
  await page.waitForTimeout(200);
  await page.goBack();
  await page.waitForTimeout(500);
}

/* ---- 8. recommendations on browse ---- */
await page.click('.searchbar .s-clear');
await page.waitForTimeout(1400);
await shot('13-browse-recommendations');

/* ---- 9. lists ---- */
await page.click('.tab[data-tab="lists"]');
await page.waitForTimeout(600);
await shot('14-lists-title');

await page.selectOption('.sortbar select', 'genre');
await page.waitForTimeout(400);
await shot('15-lists-genre');

await page.selectOption('.sortbar select', 'imdb');
await page.waitForTimeout(1200);
await shot('16-lists-imdb');

await page.click('.chips .chip:nth-child(2)'); // Watchlist
await page.waitForTimeout(400);
await shot('17-lists-watchlist');

/* ---- 10. hiding "not for me" titles ---- */

const chip = (name) => page.locator('.chips .chip', { hasText: name });
const listedTitles = () => page.locator('.grid .tile .t-name').allTextContents();

await chip('All').click();
await page.selectOption('.sortbar select', 'title');
await page.waitForTimeout(400);
const before = await listedTitles();
console.log('lists before hiding ->', before.join(', '));
if (!before.includes('Pulp Fiction')) {
  problems.push('the disliked title was missing before hiding was even enabled');
}

// flip the setting
await page.click('.icon-btn[aria-label="Settings"]');
await page.waitForTimeout(700);
await page.locator('.sheet button.action', { hasText: 'Not for me' }).click();
await page.waitForTimeout(300);
await shot('18-settings');
await page.goBack();
await page.waitForTimeout(700);

const after = await listedTitles();
console.log('lists after hiding ->', after.join(', '));
if (after.includes('Pulp Fiction')) problems.push('the disliked title is still listed after hiding');
if (after.length !== before.length - 1) {
  problems.push(`expected exactly one title hidden, went from ${before.length} to ${after.length}`);
}
await shot('19-lists-hiding-disliked');

// the escape hatch must still reach it
await chip('Not for me').click();
await page.waitForTimeout(400);
const escaped = await listedTitles();
console.log('"not for me" chip ->', escaped.join(', '));
if (!escaped.includes('Pulp Fiction')) {
  problems.push('the "Not for me" filter did not reveal the hidden title');
}
await shot('20-lists-not-for-me-chip');

// and the middle rating carries its badge through to the list
await chip('One and done').click();
await page.waitForTimeout(400);
const onceListed = await listedTitles();
console.log('"one and done" chip ->', onceListed.join(', '));
if (!onceListed.includes('Spirited Away')) {
  problems.push('the "One and done" filter did not list the title rated that way');
}
if (!(await page.locator('.grid .tile .badge.once').count())) {
  problems.push('the "one and done" tile badge is missing');
}
await shot('21-lists-one-and-done');

/* ---- 10a. press and hold a tile to rate it ---- */
await page.click('.tab[data-tab="browse"]');
await page.waitForTimeout(700);
await page.fill('input[type="search"]', 'grand');
await page.waitForTimeout(900);

const holdTarget = page.locator('.grid .tile').first();
const heldName = await holdTarget.locator('.t-name').textContent();

async function press(ms) {
  const box = await holdTarget.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  return from;
}

async function dragToOption(kind) {
  const opt = await page.locator(`.rate-opt[data-kind="${kind}"]`).boundingBox();
  await page.mouse.move(opt.x + opt.width / 2, opt.y + opt.height / 2, { steps: 6 });
  await page.waitForTimeout(150);
}

// a quick tap still opens the sheet
await press(120);
await page.mouse.up();
await page.waitForTimeout(700);
if (!(await page.locator('.sheet').count())) {
  problems.push('a short tap no longer opens the detail sheet');
}
await page.goBack();
await page.waitForTimeout(700);

// moving before the hold completes is a scroll, not a press
await press(200);
const startBox = await holdTarget.boundingBox();
await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2 - 40, { steps: 4 });
await page.waitForTimeout(500);
if (await page.locator('.rate-pop.in').count()) {
  problems.push('the rating options opened even though the pointer was dragging (scrolling)');
}
await page.mouse.up();
await page.waitForTimeout(600);
// With a mouse, drag-and-release inside a button still fires a click, so the
// sheet opens. A finger doing the same thing would have scrolled instead.
if (await page.locator('.sheet').count()) {
  await page.goBack();
  await page.waitForTimeout(700);
}

// hold, drag onto "Liked it", release
await press(650);
if (!(await page.locator('.rate-pop.in').count())) {
  problems.push('press and hold did not open the rating options');
}
await shot('21a-longpress-open');
await dragToOption('up');
const highlighted = await page.locator('.rate-opt.on').getAttribute('data-kind');
console.log('highlighted option ->', highlighted);
if (highlighted !== 'up') problems.push(`wrong option highlighted: ${highlighted}`);
await page.mouse.up();
await page.waitForTimeout(900);

console.log('held tile ->', heldName);
if (!(await page.locator('.grid .tile').first().locator('.badge.up').count())) {
  problems.push('the long-press rating did not stick');
}
// The click that follows release must not also open the sheet.
if (await page.locator('.sheet').count()) {
  problems.push('the detail sheet opened after a long-press rating');
}
await shot('21b-longpress-rated');

// dragging onto the same verdict again clears it
await press(650);
await dragToOption('up');
await page.mouse.up();
await page.waitForTimeout(900);
if (await page.locator('.grid .tile').first().locator('.badge.up').count()) {
  problems.push('dragging onto the active verdict did not clear it');
}

// releasing away from the options rates nothing
await press(650);
const away = await holdTarget.boundingBox();
await page.mouse.move(away.x + away.width / 2, away.y + away.height - 4, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(700);
if (await page.locator('.grid .tile').first().locator('.badge').count()) {
  problems.push('releasing away from the options still applied a rating');
}

/* ---- 11. genres tab ---- */
const tabLabels = await page.locator('.tab span').allTextContents();
console.log('tabs ->', tabLabels.join(' | '));
if (tabLabels.join('|') !== 'Browse|Genres|Lists') {
  problems.push(`tabs wrong or out of order: ${tabLabels.join('|')}`);
}

await page.click('.tab[data-tab="genres"]');
await page.waitForTimeout(700);
const genreNames = await page.locator('.genre-tile span').allTextContents();
console.log('genre count ->', genreNames.length);
if (!genreNames.includes('Anime') || !genreNames.includes('Animation')) {
  problems.push('Anime and Animation are not both listed as genres');
}
await shot('22-genres-catalog');

// Animation must exclude Japanese-origin titles; Spirited Away is the trap
await page.locator('.genre-tile', { hasText: 'Animation' }).first().click();
await page.waitForTimeout(1200);
const animationTitles = await page.locator('.grid .tile .t-name').allTextContents();
console.log('animation ->', animationTitles.join(', '));
if (animationTitles.includes('Spirited Away')) {
  problems.push('an anime leaked into the Animation genre');
}
if (!animationTitles.includes('Toy Story')) {
  problems.push('non-Japanese animation is missing from the Animation genre');
}
await shot('23-genres-animation');

// back must return to the catalog, not leave the tab
await page.goBack();
await page.waitForTimeout(700);
if (!(await page.locator('.genre-tile').count())) {
  problems.push('back from a genre did not return to the genre grid');
}

/* the Anime tile is AniList-sourced */
await page.locator('.genre-tile', { hasText: 'Anime' }).first().click();
await page.waitForTimeout(1200);
const animeTitles = await page.locator('.grid .tile .t-name').allTextContents();
console.log('anime ->', animeTitles.join(', '));
if (!animeTitles.includes('Attack on Titan')) {
  problems.push(`AniList-sourced anime results missing: ${animeTitles.join('|')}`);
}
// AniList lists each cour separately; the tile must show the show once.
if (animeTitles.some((t) => /season\s*\d|final season/i.test(t))) {
  problems.push(`a later cour was listed as its own show: ${animeTitles.join('|')}`);
}
if (animeTitles.filter((t) => /^Attack on Titan/.test(t)).length !== 1) {
  problems.push(`Attack on Titan listed ${animeTitles.filter((t) => /^Attack on Titan/.test(t)).length} times`);
}
// ...but a film that follows a series has its own TMDB entry and must survive.
if (!animeTitles.some((t) => /Mugen Train/.test(t))) {
  problems.push('a sequel film was collapsed away along with the cours');
}
await shot('24-genres-anime');

/* an anime with no TMDB match gets a read-only AniList sheet, not a dead end */
await page.locator('.grid .tile', { hasText: 'Yofukashi' }).first().click();
await page.waitForTimeout(1400);
const noTmdbBody = await page.locator('.sheet-body').innerText();
console.log('no-TMDB sheet ->', noTmdbBody.split('\n').slice(0, 6).join(' / '));
if (!/Not on TMDB/.test(noTmdbBody)) {
  problems.push('the AniList-only sheet does not explain why the title cannot be tracked');
}
if (!/Studio Nowhere/.test(noTmdbBody)) {
  problems.push('the AniList-only sheet is missing the AniList metadata');
}
if (!(await page.locator('.sheet-body a[href*="anilist.co"]').count())) {
  problems.push('the AniList-only sheet has no link out to AniList');
}
// It must not offer tracking controls it cannot honour.
if (await page.locator('.sheet-body .rating-btn').count()) {
  problems.push('the AniList-only sheet offers rating controls it cannot store');
}
await shot('24a-anime-no-tmdb');
await page.goBack();
await page.waitForTimeout(700);

// the movie/TV filter narrows to one format
await page.locator('.chips .chip', { hasText: 'Movies' }).first().click();
await page.waitForTimeout(1000);
const animeMovies = await page.locator('.grid .tile .t-name').allTextContents();
console.log('anime films ->', animeMovies.join(', '));
if (animeMovies.includes('Attack on Titan')) {
  problems.push('a TV series survived the Movies filter');
}
if (!animeMovies.includes('Your Name.')) {
  problems.push('anime films missing under the Movies filter');
}

// "Show all" must reveal something the default hid: Spirited Away is rated
await page.locator('.chips .chip', { hasText: 'All' }).first().click();
await page.waitForTimeout(1000);
const beforeShowAll = await page.locator('.grid .tile .t-name').allTextContents();
await page.locator('.chips .chip', { hasText: 'Show all' }).click();
await page.waitForTimeout(1000);
const afterShowAll = await page.locator('.grid .tile .t-name').allTextContents();
console.log('anime new-to-me ->', beforeShowAll.length, 'show-all ->', afterShowAll.length);
if (beforeShowAll.includes('Spirited Away')) {
  problems.push('an already-rated title showed under "new to me"');
}
if (!afterShowAll.includes('Spirited Away')) {
  problems.push('"Show all" did not reveal the already-rated title');
}
await shot('25-genres-anime-show-all');

/* ---- 12. AniList enrichment on an anime sheet ---- */
await page.click('.tab[data-tab="browse"]');
await page.waitForTimeout(600);
await page.fill('input[type="search"]', 'spirited');
await page.waitForTimeout(800);
await page.click('.grid .tile');
await page.waitForTimeout(1400);
const scoreLabels = await page.locator('.scores .s-label').allTextContents();
const scoreValues = await page.locator('.scores .s-val').allTextContents();
console.log('anime scores ->', scoreLabels.map((l, i) => `${l}=${scoreValues[i]}`).join(' '));
if (!scoreLabels.includes('AniList')) {
  problems.push('the AniList score did not replace Rotten Tomatoes on an anime sheet');
}
const heroFacts = await page.textContent('.hero .facts');
console.log('anime facts ->', heroFacts);
if (!/Ghibli/.test(heroFacts)) problems.push('the AniList studio is missing from the facts line');
if (!(await page.locator('.hero .genres .g-tag').count())) {
  problems.push('AniList tags were not merged into the genre chips');
}
await shot('26-anime-enriched');

/* tapping an AniList tag opens an anime browse for it */
const tagName = await page.locator('.hero .genres .g-tag').first().textContent();
await page.locator('.hero .genres .g-tag').first().click();
await page.waitForTimeout(1400);
const tagHeading = await page.locator('.genre-head h1').textContent();
console.log(`tag "${tagName}" -> heading "${tagHeading}"`);
if (tagHeading.trim() !== tagName.trim()) {
  problems.push(`tag browse heading wrong: "${tagHeading}" for tag "${tagName}"`);
}
if (!(await page.locator('.grid .tile').count())) {
  problems.push('the AniList tag browse returned nothing');
}
await shot('26a-tag-browse');

/* tapping a genre chip opens that genre, with the medium carried over */
await page.click('.tab[data-tab="browse"]');
await page.waitForTimeout(600);
await page.fill('input[type="search"]', 'breaking');
await page.waitForTimeout(800);
await page.click('.grid .tile');
await page.waitForTimeout(1200);
const chipHref = await page.locator('.hero .genres .g-link').first().getAttribute('href');
console.log('tv genre chip href ->', chipHref);
if (!/^#\/genres\/[a-z]+\/tv$/.test(chipHref)) {
  problems.push(`a TV sheet's genre chip did not carry the medium: ${chipHref}`);
}
await page.locator('.hero .genres .g-link').first().click();
await page.waitForTimeout(1400);
const tvChipPressed = await page.locator('.chips .chip[data-type="tv"]').getAttribute('aria-pressed');
console.log('TV chip preselected ->', tvChipPressed);
if (tvChipPressed !== 'true') {
  problems.push('the genre opened from a TV sheet did not preselect the TV filter');
}
await shot('26b-genre-from-chip');

// a non-anime sheet must be untouched by all of this
await page.click('.tab[data-tab="browse"]');
await page.waitForTimeout(700);
await page.fill('input[type="search"]', 'princess');
await page.waitForTimeout(800);
await page.click('.grid .tile');
await page.waitForTimeout(1200);
const plainLabels = await page.locator('.scores .s-label').allTextContents();
console.log('non-anime scores ->', plainLabels.join(', '));
if (plainLabels.includes('AniList')) {
  problems.push('a non-anime title was given an AniList score');
}
if (await page.locator('.hero .genres .g-tag').count()) {
  problems.push('a non-anime title was given AniList tags');
}
await page.goBack();
await page.waitForTimeout(600);

/* ---- 13. marking a service as mine floats it to the front ---- */
await page.click('.icon-btn[aria-label="Settings"]');
await page.waitForTimeout(800);

/* the API health check */
const diagRows = await page.locator('.diag-row').count();
console.log('diagnostic rows ->', diagRows);
if (diagRows !== 3) problems.push(`expected 3 service checks, found ${diagRows}`);
if (!/Not checked yet/.test(await page.textContent('.diag-row .d-detail'))) {
  problems.push('checks ran on open — they should cost a deliberate tap');
}
await page.locator('.sheet-body button', { hasText: 'Check connections' }).click();
await page.waitForTimeout(900);
const diagStates = await page.locator('.diag-row').evaluateAll((rows) =>
  rows.map((r) => `${r.dataset.check}:${r.querySelector('.sync-dot').className.replace('sync-dot', '').trim() || 'none'}`)
);
console.log('diagnostics ->', diagStates.join(' '));
if (diagStates.some((s) => s.includes('err'))) {
  problems.push(`a health check reported failure in fixture mode: ${diagStates.join(' ')}`);
}
if (!diagStates.every((s) => s.endsWith(':ok'))) {
  problems.push(`checks did not all resolve: ${diagStates.join(' ')}`);
}
await shot('27a-settings-diagnostics');

await page.fill('.sheet-body input[placeholder="Filter services"]', 'hulu');
await page.waitForTimeout(300);
await page.locator('.chips-wrap .chip', { hasText: 'Hulu' }).click();
await page.waitForTimeout(300);
await shot('27-settings-where-to-watch');
await page.goBack();
await page.waitForTimeout(600);

await page.click('.tab[data-tab="browse"]');
await page.waitForTimeout(600);
await page.fill('input[type="search"]', 'para');
await page.waitForTimeout(800);
await page.click('.grid .tile');
await page.waitForTimeout(900);
const streamAfter = await page.locator('.prov-row[data-row="stream"] .p-name').allTextContents();
console.log('stream row with Hulu subscribed ->', streamAfter.join(', '));
if (streamAfter[0] !== 'Hulu') {
  problems.push(`a subscribed service did not sort first: ${streamAfter.join('|')}`);
}
if (!(await page.locator('.prov-chip.mine').count())) {
  problems.push('the subscribed-service marker is missing');
}
await shot('28-movie-my-service-first');
await page.goBack();
await page.waitForTimeout(500);

/* ---- 11. light mode pass ---- */
await context.close();
const light = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'light',
});
const lp = await light.newPage();
lp.on('pageerror', (e) => problems.push(`pageerror(light): ${e.message}`));
await lp.goto(BASE, { waitUntil: 'networkidle' });
await lp.waitForTimeout(900);
await lp.screenshot({ path: `${OUT}/29-light-browse.png` });
await lp.fill('input[type="search"]', 'squid');
await lp.waitForTimeout(700);
await lp.click('.grid .tile');
await lp.waitForTimeout(900);
await lp.click('.rating-btn.once');
await lp.waitForTimeout(250);
await lp.screenshot({ path: `${OUT}/30-light-tv.png` });

await browser.close();

console.log('\n=== problems ===');
console.log(problems.length ? problems.join('\n') : 'none');
process.exit(problems.length ? 1 : 0);
