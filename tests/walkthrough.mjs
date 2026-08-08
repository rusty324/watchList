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

// An inline SVG with no CSS size fills its container instead of sitting in the
// row — invisible to every other assertion here, so it gets its own.
const looseGlyphs = await page.locator('.sheet-body svg').evaluateAll((els) =>
  els
    .map((el) => ({ cls: el.parentElement?.className || '?', box: el.getBoundingClientRect() }))
    .filter((g) => g.box.width > 40 || g.box.height > 40)
    .map((g) => `${g.cls}:${Math.round(g.box.width)}x${Math.round(g.box.height)}`)
);
console.log('oversized glyphs on the sheet ->', looseGlyphs.length ? looseGlyphs.join(', ') : 'none');
for (const glyph of looseGlyphs) problems.push(`an unconstrained icon on the detail sheet: ${glyph}`);

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
await page.selectOption('.sheet .sortbar select', 'year-asc');
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

/* ---- 7a. search filters ---- */
// "st" spans both media in the fixtures — a movies-only query would prove
// nothing about the filter.
await page.fill('input[type="search"]', 'st');
await page.waitForTimeout(900);
const searchAll = await page.locator('.grid .tile .t-name').allTextContents();
const searchMeta = await page.locator('.grid .tile .t-meta').allTextContents();
console.log('search "st" ->', searchAll.join(', '));
if (!(await page.locator('.search-filters').count())) {
  problems.push('the search filter block did not appear with results');
}
if (!searchMeta.some((m) => /season/i.test(m))) {
  problems.push('the search fixture returned no TV, so the type filter proves nothing');
}

await page.locator('.search-filters .filter-row .chip', { hasText: 'Movies' }).first().click();
await page.waitForTimeout(600);
const filmsOnly = await page.locator('.grid .tile .t-meta').allTextContents();
console.log('films only ->', filmsOnly.length, 'of', searchAll.length);
if (filmsOnly.some((m) => /season/i.test(m))) {
  problems.push('a TV result survived the Movies filter');
}
if (!filmsOnly.length || filmsOnly.length >= searchAll.length) {
  problems.push('the Movies filter did not narrow the results');
}
await shot('12a-search-filters');

// sorting reorders without changing the set
await page.selectOption('.search-filters .sortbar select', 'newest');
await page.waitForTimeout(500);
const newestFirst = await page.locator('.grid .tile .t-meta').allTextContents();
const years = newestFirst.map((m) => parseInt(m, 10)).filter(Number.isFinite);
console.log('years newest-first ->', years.join(', '));
for (let i = 1; i < years.length; i++) {
  if (years[i] > years[i - 1]) {
    problems.push(`newest sort is out of order: ${years.join(', ')}`);
    break;
  }
}

/* ---- 7b. a second tap on Browse clears the search ---- */
await page.click('.tab[data-tab="browse"]');
await page.waitForTimeout(900);
const fieldAfter = await page.inputValue('input[type="search"]');
console.log('search field after second Browse tap ->', JSON.stringify(fieldAfter));
if (fieldAfter !== '') problems.push(`the second Browse tap did not clear the field: "${fieldAfter}"`);
if (await page.locator('.search-filters').count()) {
  problems.push('the search filters survived clearing the search');
}

/* ---- 8. recommendations on browse ---- */
await page.waitForTimeout(1000);
await shot('13-browse-recommendations');

/* ---- 9. lists ---- */
await page.click('.tab[data-tab="lists"]');
await page.waitForTimeout(600);
// Six fixture titles fit on one page, so the pager must stay out of the way.
if (await page.locator('.pager').count()) {
  problems.push('a pager appeared for a list that fits on one page');
}
await shot('14-lists-title');

await page.selectOption('.sortbar select', 'genre');
await page.waitForTimeout(400);
await shot('15-lists-genre');

await page.selectOption('.sortbar select', 'imdb');
await page.waitForTimeout(1200);
await shot('16-lists-imdb');

await page.locator('.filter-row[data-group="status"] .chip', { hasText: 'Watchlist' }).click();
await page.waitForTimeout(400);
await shot('17-lists-watchlist');

/* ---- 9a. filters combine: within a group widens, across groups narrows ---- */
const listTitles = () => page.locator('.grid .tile .t-name').allTextContents();
const listChip = (group, name) =>
  page.locator(`.filter-row[data-group="${group}"] .chip`, { hasText: name });

await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(400);
const allTracked = await listTitles();
console.log('lists, no filters ->', allTracked.join(', '));

// Disliked titles are hidden by default now, without touching Settings.
if (allTracked.includes('Pulp Fiction')) {
  problems.push('a "Not for me" title showed with the new default in place');
}

await listChip('type', 'Movies').click();
await page.waitForTimeout(400);
const moviesOnly = await listTitles();
await listChip('type', 'TV').click();
await page.waitForTimeout(400);
const bothTypes = await listTitles();
console.log('movies ->', moviesOnly.join(', '), '| + TV ->', bothTypes.join(', '));
if (bothTypes.length <= moviesOnly.length) {
  problems.push('adding a second chip in the same group did not widen the results');
}

// Now narrow across groups: films that are also liked.
await listChip('type', 'TV').click();
await page.waitForTimeout(300);
await listChip('rating', 'Liked').click();
await page.waitForTimeout(400);
const likedFilms = await listTitles();
console.log('liked films ->', likedFilms.join(', '));
if (likedFilms.length > moviesOnly.length) {
  problems.push('adding a chip from another group did not narrow the results');
}
for (const title of likedFilms) {
  if (!moviesOnly.includes(title)) problems.push(`${title} is not a film but survived Movies+Liked`);
}
await shot('17a-lists-multi-filter');

// The "Not for me" chip still reveals hidden titles.
await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(300);
await listChip('rating', 'Not for me').click();
await page.waitForTimeout(400);
const revealed = await listTitles();
console.log('not-for-me chip ->', revealed.join(', '));
if (!revealed.includes('Pulp Fiction')) {
  problems.push('the "Not for me" chip no longer reveals hidden titles');
}
await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(300);

/* ---- 9b. tapping the active tab ---- */
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(300);
const scrolledTo = await page.evaluate(() => window.scrollY);
await page.click('.tab[data-tab="lists"]');
await page.waitForTimeout(900);
const afterTap = await page.evaluate(() => window.scrollY);
console.log('scroll before tab tap ->', scrolledTo, 'after ->', afterTap);
if (scrolledTo > 0 && afterTap !== 0) {
  problems.push(`tapping the active tab did not scroll to top (${scrolledTo} -> ${afterTap})`);
}

/* ---- 10. the hide setting still works in both directions ---- */

const listedTitles = () => page.locator('.grid .tile .t-name').allTextContents();

await page.selectOption('.sortbar select', 'title');
await page.waitForTimeout(400);
const hiddenByDefault = await listedTitles();
console.log('lists, default settings ->', hiddenByDefault.join(', '));
if (hiddenByDefault.includes('Pulp Fiction')) {
  problems.push('a disliked title is showing even though hiding is now the default');
}
await shot('19-lists-hiding-disliked');

// turning the setting off brings them back
await page.click('.icon-btn[aria-label="Settings"]');
await page.waitForTimeout(700);
await page.locator('.sheet button.action', { hasText: 'Not for me' }).click();
await page.waitForTimeout(300);
await shot('18-settings');
await page.goBack();
await page.waitForTimeout(700);

const shownAgain = await listedTitles();
console.log('lists, hiding turned off ->', shownAgain.join(', '));
if (!shownAgain.includes('Pulp Fiction')) {
  problems.push('turning the hide setting off did not bring the disliked title back');
}
if (shownAgain.length !== hiddenByDefault.length + 1) {
  problems.push(`expected exactly one more title, went from ${hiddenByDefault.length} to ${shownAgain.length}`);
}

// put it back to the default for the rest of the run
await page.click('.icon-btn[aria-label="Settings"]');
await page.waitForTimeout(700);
await page.locator('.sheet button.action', { hasText: 'Not for me' }).click();
await page.waitForTimeout(300);
await page.goBack();
await page.waitForTimeout(700);

// the escape hatch still reaches a hidden title
await listChip('rating', 'Not for me').click();
await page.waitForTimeout(400);
const escaped = await listedTitles();
console.log('"not for me" chip ->', escaped.join(', '));
if (!escaped.includes('Pulp Fiction')) {
  problems.push('the "Not for me" filter did not reveal the hidden title');
}
await shot('20-lists-not-for-me-chip');

// and the middle rating carries its badge through to the list
await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(300);
await listChip('rating', 'One and done').click();
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

// The options open around the finger, not around the tile. Press near the
// bottom of a tall poster, where the two placements are furthest apart.
{
  const box = await holdTarget.boundingBox();
  const pressY = box.y + box.height - 30;
  await page.mouse.move(box.x + box.width / 2, pressY);
  await page.mouse.down();
  await page.waitForTimeout(650);

  const gap = await page.locator('.rate-gap').boundingBox();
  const gapCentre = gap.y + gap.height / 2;
  console.log(
    'press y', Math.round(pressY),
    '| finger gap centre', Math.round(gapCentre),
    '| tile top', Math.round(box.y)
  );
  if (Math.abs(gapCentre - pressY) > 2) {
    problems.push(`the options did not open around the finger: gap at ${Math.round(gapCentre)}, pressed at ${Math.round(pressY)}`);
  }
  const kinds = await page.locator('.rate-opt').evaluateAll((els) => els.map((e) => e.dataset.kind));
  if (kinds.join(',') !== 'up,once,down,hide') {
    problems.push(`wrong options offered: ${kinds.join(',')}`);
  }

  // Releasing without sliding must commit nothing. This matters more than it
  // used to: clamping at a screen edge can leave an option under a stationary
  // fingertip, and that must never count as a choice.
  await page.mouse.up();
  await page.waitForTimeout(700);
  if (await page.locator('.grid .tile').first().locator('.badge').count()) {
    problems.push('releasing without sliding still applied a rating');
  }
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

/* ---- 10b. filtering the list by streaming and rent/buy platform ---- */

// Rate a show without ever opening its sheet. Every other tracked title had its
// availability recorded for free when its sheet loaded, so this is the only one
// the backfill sweep can be shown to have found — which is what makes the test
// mean anything.
await page.fill('input[type="search"]', 'stranger');
await page.waitForTimeout(900);
{
  const box = await page.locator('.grid .tile').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  if (!(await page.locator('.rate-opt[data-kind="up"]').count())) {
    problems.push('could not press-and-hold to rate a title without opening it');
    await page.mouse.up();
  } else {
    const opt = await page.locator('.rate-opt[data-kind="up"]').boundingBox();
    await page.mouse.move(opt.x + opt.width / 2, opt.y + opt.height / 2, { steps: 6 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(900);
  }
}

await page.click('.tab[data-tab="lists"]');
await page.waitForTimeout(900);
// Section 10 left the "One and done" chip on.
if (await page.locator('.chip.clear-filters:not([hidden])').count()) {
  await page.locator('.chip.clear-filters').click();
  await page.waitForTimeout(400);
}
if (!(await listedTitles()).includes('Stranger Things')) {
  problems.push('the long-press rating did not add the title to the list');
}

const platformChips = (group) =>
  page.locator(`.filter-row[data-group="${group}"] .chip`).allTextContents();
const platChip = (group, name) =>
  page.locator(`.filter-row[data-group="${group}"] .chip`, { hasText: name }).first();

// The unchecked title is advertised rather than silently excluded.
const checkLabel = await page.locator('.avail-check').textContent();
console.log('availability control ->', checkLabel);
if (!/\b1\b/.test(checkLabel)) {
  problems.push(`the availability control did not offer to check the 1 missing title: "${checkLabel}"`);
}
await shot('21c-lists-availability-prompt');

// Unchecked means unmatched: "not known to be on Netflix" is not "on Netflix".
await platChip('stream', 'Netflix').click();
await page.waitForTimeout(500);
const netflixBefore = await listedTitles();
console.log('on Netflix, before the sweep ->', netflixBefore.join(', '));
if (netflixBefore.includes('Stranger Things')) {
  problems.push('an unchecked title matched a platform filter');
}
await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(400);

await page.locator('.avail-check').click();
await page.waitForTimeout(1800);
if (await page.locator('.avail-check').count()) {
  problems.push('the availability control stayed after everything had been checked');
}

// The label column is a fixed width shared by every row, and the platform rows
// carry the longest labels — so this is where a label would first collide with
// the chips it labels.
// The column has a fixed width, so a long label overflows its box rather than
// widening it — measure the rendered text, not the box.
const rowGeometry = await page.locator('.filter-row').evaluateAll((rows) =>
  rows.map((r) => {
    const el = r.querySelector('.f-label');
    const range = document.createRange();
    range.selectNodeContents(el);
    const ink = range.getBoundingClientRect();
    const chips = r.querySelector('.chips').getBoundingClientRect();
    return {
      group: r.dataset.group,
      slack: Math.round(chips.left - ink.right),
      chipX: Math.round(chips.left),
    };
  })
);
console.log('label-to-chip slack ->', rowGeometry.map((g) => `${g.group}:${g.slack}`).join(' '));
for (const row of rowGeometry) {
  if (row.slack < 6) {
    problems.push(`the ${row.group} label leaves only ${row.slack}px before its chips`);
  }
}
if (new Set(rowGeometry.map((g) => g.chipX)).size !== 1) {
  problems.push(`filter rows are not aligned: chips start at ${rowGeometry.map((g) => g.chipX).join(', ')}`);
}

const streamChips = await platformChips('stream');
const buyChips = await platformChips('buy');
console.log('stream chips ->', streamChips.join(', '));
console.log('rent/buy chips ->', buyChips.join(', '));
if (!streamChips.includes('Netflix')) problems.push('the Stream row is missing Netflix');
if (!buyChips.includes('Apple TV')) problems.push('the Rent/buy row is missing Apple TV');
// Ad-supported folds into Stream rather than becoming a fifth group.
if (!streamChips.includes('Tubi TV')) {
  problems.push(`free/ad-supported services did not fold into Stream: ${streamChips.join('|')}`);
}

await platChip('stream', 'Netflix').click();
await page.waitForTimeout(500);
const netflixAfter = await listedTitles();
console.log('on Netflix, after the sweep ->', netflixAfter.join(', '));
if (!netflixAfter.includes('Stranger Things')) {
  problems.push('the backfill did not reach the title whose sheet was never opened');
}
// Titles that stream nowhere stay out whether or not they have been checked.
for (const gone of ['The Princess Bride', 'Spirited Away']) {
  if (netflixAfter.includes(gone)) {
    problems.push(`${gone} streams nowhere but survived a Stream filter`);
  }
}

// Within the group it widens. Start from the narrow service, since Hulu's one
// title is also on Netflix and the other order would prove nothing.
await platChip('stream', 'Netflix').click();
await page.waitForTimeout(400);
await platChip('stream', 'Hulu').click();
await page.waitForTimeout(500);
const huluOnly = await listedTitles();
await platChip('stream', 'Netflix').click();
await page.waitForTimeout(500);
const eitherService = await listedTitles();
console.log('Hulu ->', huluOnly.join(', '), '| + Netflix ->', eitherService.join(', '));
if (eitherService.length <= huluOnly.length) {
  problems.push('a second service in the Stream group did not widen the results');
}
await shot('21d-lists-platform-filter');

// Across groups it narrows, same as every other pair.
await platChip('buy', 'Apple TV').click();
await page.waitForTimeout(500);
const streamAndRent = await listedTitles();
console.log('streamable, and rentable from Apple ->', streamAndRent.join(', '));
if (streamAndRent.length >= eitherService.length) {
  problems.push('adding a Rent/buy chip did not narrow a Stream selection');
}
for (const title of streamAndRent) {
  if (!eitherService.includes(title)) problems.push(`${title} survived a filter it should not have`);
}

// The two groups read different buckets: a title you can only stream must not
// answer a Rent/buy filter.
await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(400);
await platChip('buy', 'Google Play').click();
await page.waitForTimeout(500);
const purchasable = await listedTitles();
console.log('buyable from Google Play ->', purchasable.join(', '));
if (!purchasable.includes('Squid Game')) {
  problems.push('a title with a purchase option is missing from the Rent/buy row');
}
if (purchasable.includes('Breaking Bad')) {
  problems.push('a stream-only title answered a Rent/buy filter');
}
await page.locator('.chip.clear-filters').click();
await page.waitForTimeout(400);

/* ---- 10c. hide a title, then get it back ---- */

const listedNow = () => page.locator('.grid .tile .t-name').allTextContents();
const before = await listedNow();
const victim = 'Stranger Things';
if (!before.includes(victim)) problems.push(`${victim} is not in the list to hide`);

// Press and hold it, slide down onto Hide.
{
  const target = page.locator('.grid .tile', { hasText: victim }).first();
  // Six filter rows push the second grid row below the fold, and a press at
  // off-screen coordinates lands on nothing.
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  if (!(await page.locator('.rate-pop.in').count())) {
    problems.push('press and hold on a Lists tile did not open the options');
  }
  const hide = await page.locator('.rate-opt.hide').boundingBox();
  await page.mouse.move(hide.x + hide.width / 2, hide.y + hide.height / 2, { steps: 8 });
  await page.waitForTimeout(200);
  const on = await page.locator('.rate-opt.on').count()
    ? await page.locator('.rate-opt.on').getAttribute('data-kind')
    : null;
  if (on !== 'hide') problems.push(`sliding down highlighted ${on}, not hide`);
  await page.mouse.up();
  await page.waitForTimeout(1000);
}

const afterHide = await listedNow();
console.log('lists after hiding ->', afterHide.join(', '));
// Hidden means gone from Lists too, not just from the discovery tabs.
if (afterHide.includes(victim)) problems.push('a hidden title is still in the Lists tab');
if (afterHide.length !== before.length - 1) {
  problems.push(`hiding removed ${before.length - afterHide.length} titles, expected 1`);
}
await shot('21e-lists-after-hide');

// Settings is the guaranteed way back, since it is gone from every grid.
await page.click('.icon-btn[aria-label="Settings"]');
await page.waitForTimeout(900);
const hiddenRows = await page.locator('.hidden-row .h-name').allTextContents();
console.log('settings, hidden titles ->', hiddenRows.join(', '));
if (!hiddenRows.includes(victim)) {
  problems.push(`the hidden title is not listed in Settings: ${hiddenRows.join('|')}`);
}
await page.locator('.hidden-list').scrollIntoViewIfNeeded();
await shot('21f-settings-hidden');

await page.locator('.hidden-row', { hasText: victim }).locator('button').click();
await page.waitForTimeout(500);
if ((await page.locator('.hidden-row').count()) !== 0) {
  problems.push('un-hiding did not remove the row from Settings');
}
await page.goBack();
await page.waitForTimeout(900);
const afterUnhide = await listedNow();
console.log('lists after un-hiding ->', afterUnhide.join(', '));
if (!afterUnhide.includes(victim)) problems.push('un-hiding did not bring the title back');

/* ---- 10d. playlists: build one, then rearrange it ---- */

// prompt() is how a playlist gets named; answer it rather than let it hang.
let promptReply = 'Movie night';
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? promptReply : undefined));

const addToPlaylist = async (query, { fresh = false } = {}) => {
  await page.click('.tab[data-tab="browse"]');
  await page.waitForTimeout(600);
  await page.fill('input[type="search"]', query);
  await page.waitForTimeout(900);
  await page.click('.grid .tile');
  await page.waitForTimeout(1100);

  await page.locator('.action-row .action', { hasText: /playlist|^In / }).first().click();
  await page.waitForTimeout(800);
  if (fresh) {
    await page.locator('.sheet-body button', { hasText: 'New playlist with this title' }).click();
  } else {
    await page.locator('.sheet-body .action', { hasText: promptReply }).click();
  }
  await page.waitForTimeout(600);
  await page.goBack(); // the picker
  await page.waitForTimeout(500);
  await page.goBack(); // the detail sheet
  await page.waitForTimeout(700);
};

await addToPlaylist('para', { fresh: true });
await addToPlaylist('breaking');
await addToPlaylist('princess');

await page.click('.tab[data-tab="lists"]');
await page.waitForTimeout(700);
await page.click('.icon-btn[aria-label="Playlists"]');
await page.waitForTimeout(900);

const cardNames = await page.locator('.pl-card .pl-name').allTextContents();
const cardCounts = await page.locator('.pl-card .pl-count').allTextContents();
console.log('playlist index ->', cardNames.join(', '), '|', cardCounts.join(', '));
if (!cardNames.includes('Movie night')) problems.push('the new playlist is not on the index');
if (!cardCounts.some((c) => c.startsWith('3'))) {
  problems.push(`the playlist should hold 3 titles: ${cardCounts.join('|')}`);
}
await shot('35-playlist-index');

await page.locator('.pl-card', { hasText: 'Movie night' }).click();
await page.waitForTimeout(900);
const plOrder = () => page.locator('.pl-row .pl-title').allTextContents();
const built = await plOrder();
console.log('as built ->', built.join(' | '));
if (built.length !== 3) problems.push(`expected 3 rows, found ${built.length}`);
await shot('36-playlist');

// Drag the last row to the top by its handle.
{
  const first = await page.locator('.pl-row').first().boundingBox();
  const handle = await page.locator('.pl-row').last().locator('.drag-handle').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, first.y + 6, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(800);
}
const dragged = await plOrder();
console.log('after dragging the last row to the top ->', dragged.join(' | '));
if (dragged[0] !== built[2]) {
  problems.push(`dragging did not move the row to the top: ${dragged.join('|')}`);
}
if ([...dragged].sort().join('|') !== [...built].sort().join('|')) {
  problems.push('reordering changed which titles are in the playlist');
}

// The buttons are the accessible path and must agree with the drag.
await page.locator('.pl-row').nth(2).locator('.pl-btn[aria-label^="Move"]').first().click();
await page.waitForTimeout(600);
const nudged = await plOrder();
console.log('after the up button ->', nudged.join(' | '));
if (nudged[1] !== dragged[2] || nudged[2] !== dragged[1]) {
  problems.push(`the up button did not swap rows 2 and 3: ${nudged.join('|')}`);
}
// Move-up on the first row and move-down on the last have nothing to do.
if (!(await page.locator('.pl-row').first().locator('.pl-btn').first().isDisabled())) {
  problems.push('move-up is enabled on the first row');
}

// The order is what has to survive a reload, not just the membership.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const reloaded = await plOrder();
console.log('after a reload ->', reloaded.join(' | '));
if (reloaded.join('|') !== nudged.join('|')) {
  problems.push(`the order did not persist: ${reloaded.join('|')} vs ${nudged.join('|')}`);
}

// Watching something leaves it in place, with a tick — it does not drop out.
await page.locator('.pl-row .pl-open').first().click();
await page.waitForTimeout(1200);
await page.locator('.action-row .action', { hasText: 'Watched' }).first().click();
await page.waitForTimeout(400);
await page.goBack();
await page.waitForTimeout(900);
const afterWatch = await plOrder();
console.log('after marking the top one watched ->', afterWatch.join(' | '));
if (afterWatch.join('|') !== reloaded.join('|')) {
  problems.push('marking a title watched changed the playlist');
}
if (!(await page.locator('.pl-row').first().locator('.pl-tick').count())) {
  problems.push('a watched row is not showing its tick');
}
await shot('36a-playlist-watched');

// Removing a title, and deleting the playlist, both stick.
await page.locator('.pl-row').first().locator('.pl-btn.remove').click();
await page.waitForTimeout(700);
if ((await plOrder()).length !== 2) problems.push('removing a row did not shorten the playlist');

await page.locator('button', { hasText: 'Delete playlist' }).click();
await page.waitForTimeout(1000);
if (await page.locator('.pl-card').count()) {
  problems.push('the deleted playlist is still on the index');
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
if (await page.locator('.pl-card').count()) {
  problems.push('the deleted playlist came back after a reload');
}
await page.click('.tab[data-tab="lists"]');
await page.waitForTimeout(700);

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

// ...and so must tapping the Genres tab while inside a genre
await page.locator('.genre-tile', { hasText: 'Comedy' }).first().click();
await page.waitForTimeout(1000);
if (await page.locator('.genre-tile').count()) {
  problems.push('opening a genre did not replace the grid');
}
await page.click('.tab[data-tab="genres"]');
await page.waitForTimeout(900);
if (!(await page.locator('.genre-tile').count())) {
  problems.push('tapping the active Genres tab did not return to the genre grid');
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
await light.close();

/* ---- 12. paging a large library ----
 *
 * Last, and in its own context: it seeds a synthetic library over localStorage,
 * which would invalidate every assertion before it. The fixtures hold six
 * titles, which is the case where the pager must NOT appear — a library big
 * enough to page is only reachable by writing one. */
const bulk = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
});
const bp = await bulk.newPage();
bp.on('pageerror', (e) => problems.push(`pageerror(bulk): ${e.message}`));
bp.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console(bulk): ${m.text()}`);
});

await bp.goto(BASE, { waitUntil: 'networkidle' });
const TOTAL = 120;
await bp.evaluate((n) => {
  const genres = ['Drama', 'Comedy', 'Thriller', 'Action'];
  const items = {};
  for (let i = 0; i < n; i++) {
    const type = i % 3 === 0 ? 'tv' : 'movie';
    items[`${type}:${900000 + i}`] = {
      type,
      id: 900000 + i,
      // Zero-padded so title order and index order agree, which is what lets
      // the page-boundary assertions below be exact.
      title: `Synthetic ${String(i).padStart(4, '0')}`,
      year: 1960 + (i % 60),
      poster: null,
      genres: [genres[i % genres.length]],
      rating: i % 7 === 0 ? 'up' : null,
      watched: true,
      inWatchlist: false,
      seasons: {},
      updatedAt: i,
    };
  }
  localStorage.setItem(
    'wl.data.v1',
    JSON.stringify({
      version: 2,
      items,
      settings: { defaultTitleLang: 'en', theme: 'auto', hideDisliked: true, region: 'US', myProviders: [] },
    })
  );
}, TOTAL);

await bp.reload({ waitUntil: 'networkidle' });
await bp.waitForTimeout(500);
await bp.click('.tab[data-tab="lists"]');
await bp.waitForTimeout(1200);

const bulkNames = () => bp.locator('.grid .tile .t-name').allTextContents();
const bulkCount = () => bp.locator('.grid .tile').count();

const firstPage = await bulkNames();
console.log(
  'page 1 ->', firstPage.length, 'tiles,',
  await bp.locator('.section-sub').first().textContent(),
  '| pages:', await bp.locator('.pager:not(.compact)').getAttribute('data-pages')
);
if (firstPage.length !== 50) {
  problems.push(`page 1 rendered ${firstPage.length} tiles, expected 50`);
}
// The point of the whole change: the DOM must not carry the whole library.
if ((await bulkCount()) > 50) problems.push('more than a page of tiles reached the DOM');
if ((await bp.locator('.pager:not(.compact)').getAttribute('data-pages')) !== '3') {
  problems.push('120 titles did not come to 3 pages of 50');
}
if (firstPage[0] !== 'Synthetic 0000') {
  problems.push(`page 1 does not start at the top of the sort: ${firstPage[0]}`);
}
await bp.screenshot({ path: `${OUT}/31-lists-paged.png` });

// Page controls sit in two places: beside Sort, and under the grid.
if ((await bp.locator('.pager').count()) !== 2) {
  problems.push(`expected a pager above and below the grid, found ${await bp.locator('.pager').count()}`);
}
if ((await bp.locator('.sortbar .pager.compact').count()) !== 1) {
  problems.push('the Sort row has no page controls');
}
// The crowded row is the risk: Sort's longest label plus arrows plus a
// position readout, on a 390px screen.
await bp.selectOption('.sortbar select', 'unseen');
await bp.waitForTimeout(600);
const sortRow = await bp.evaluate(() => {
  const bar = document.querySelector('.sortbar');
  const box = bar.getBoundingClientRect();
  const kids = [...bar.children].map((el) => el.getBoundingClientRect());
  const sel = bar.querySelector('select');
  return {
    barRight: box.right,
    rightmost: Math.max(...kids.map((r) => r.right)),
    // Centres, not tops: the row centres items of different heights, so equal
    // tops would be the wrong thing to ask for. Drift here means a wrap.
    centreSpread: Math.max(...kids.map((r) => r.top + r.height / 2))
      - Math.min(...kids.map((r) => r.top + r.height / 2)),
    tallest: Math.max(...kids.map((r) => r.height)),
    barHeight: box.height,
    truncated: sel.scrollWidth > sel.clientWidth + 1,
    label: sel.selectedOptions[0].textContent,
  };
});
console.log('sort row ->', JSON.stringify(sortRow));
if (sortRow.centreSpread > 2) problems.push('the Sort row wrapped onto more than one line');
if (sortRow.barHeight > sortRow.tallest + 2) problems.push('the Sort row is taller than its tallest control');
if (sortRow.rightmost > sortRow.barRight + 1) problems.push('the page controls overflow the Sort row');
if (sortRow.truncated) problems.push(`the sort label is being cut off: "${sortRow.label}"`);
await bp.selectOption('.sortbar select', 'title');
await bp.waitForTimeout(600);

// Turning from the top control has to move the bottom one, and the count line.
await bp.click('.sortbar .page-step[aria-label="Next page"]');
await bp.waitForTimeout(800);
console.log(
  'after the top Next ->', await bp.locator('.page-of').textContent(),
  '| bottom', await bp.locator('.pager:not(.compact)').getAttribute('data-page'),
  '|', await bp.locator('.section-sub').first().textContent()
);
if ((await bp.locator('.page-of').textContent()) !== '2/3') {
  problems.push('the top page readout did not advance');
}
if ((await bp.locator('.pager:not(.compact)').getAttribute('data-page')) !== '2') {
  problems.push('the two pagers drifted out of step');
}
await bp.screenshot({ path: `${OUT}/34-lists-top-pager.png` });
// Back to page 1 for the boundary checks below.
await bp.click('.sortbar .page-step[aria-label="Previous page"]');
await bp.waitForTimeout(800);

await bp.click('.pager:not(.compact) .page-step[aria-label="Next page"]');
await bp.waitForTimeout(800);
const secondPage = await bulkNames();
console.log('page 2 ->', secondPage.length, 'tiles, first:', secondPage[0]);
// Sorting happens over the library and slicing after it, so page 2 continues
// the alphabet rather than restarting it.
if (secondPage[0] !== 'Synthetic 0050') {
  problems.push(`page 2 did not continue the sort: starts at ${secondPage[0]}`);
}
if (secondPage.some((t) => firstPage.includes(t))) {
  problems.push('a title appeared on two pages');
}
if ((await bp.evaluate(() => window.scrollY)) !== 0) {
  problems.push('turning the page left the old scroll position');
}

// The last page is the remainder, and Next is spent.
await bp.click('.pager:not(.compact) .page-step[aria-label="Next page"]');
await bp.waitForTimeout(800);
const lastPage = await bulkNames();
console.log('page 3 ->', lastPage.length, 'tiles, last:', lastPage.at(-1));
if (lastPage.length !== 20) problems.push(`last page rendered ${lastPage.length} tiles, expected 20`);
if (!(await bp.locator('.pager:not(.compact) .page-step[aria-label="Next page"]').isDisabled())) {
  problems.push('Next is still enabled on the last page');
}

// Filtering from page 3 must not strand you past the end of a shorter list.
await bp.locator('.filter-row[data-group="rating"] .chip', { hasText: 'Liked' }).click();
await bp.waitForTimeout(800);
const filtered = await bulkNames();
console.log('liked, from page 3 ->', filtered.length, 'tiles;', await bp.locator('.pager').count(), 'pager');
if (!filtered.length) {
  problems.push('narrowing the filter while on a later page left an empty grid');
}
if (await bp.locator('.pager').count()) {
  problems.push('a single page of results still drew a pager');
}

// And the picker jumps straight to a page rather than stepping.
await bp.locator('.chip.clear-filters').click();
await bp.waitForTimeout(700);
await bp.selectOption('.pager .page-pick', '3');
await bp.waitForTimeout(800);
console.log('jumped to ->', await bp.locator('.section-sub').first().textContent());
if ((await bp.locator('.pager:not(.compact)').getAttribute('data-page')) !== '3') {
  problems.push('the page picker did not jump to the chosen page');
}
await bp.screenshot({ path: `${OUT}/32-lists-last-page.png` });

/* ---- 13. a genre keeps digging once you've dealt with page 1 ----
 *
 * The discover fixture serves one title a page, so marking off page 1 of each
 * medium leaves the genre empty unless the view walks to page 2 and beyond.
 * Before this change it fetched page 1 only and said "nothing new here" for
 * good. Seeds storage, so it runs in the bulk context alongside the paging
 * checks rather than in the main flow. */
await bp.evaluate(() => {
  // Page 1 of Drama: the first drama film and the first drama series.
  localStorage.setItem(
    'wl.data.v1',
    JSON.stringify({
      version: 2,
      items: {
        'movie:120467': { type: 'movie', id: 120467, title: 'The Grand Budapest Hotel', watched: true, seasons: {}, updatedAt: 1 },
        'tv:1396': { type: 'tv', id: 1396, title: 'Breaking Bad', watched: true, seasons: {}, updatedAt: 2 },
      },
      settings: { defaultTitleLang: 'en', theme: 'auto', hideDisliked: true, region: 'US', myProviders: [] },
    })
  );
});
await bp.reload({ waitUntil: 'networkidle' });
await bp.waitForTimeout(500);
await bp.click('.tab[data-tab="genres"]');
await bp.waitForTimeout(700);
await bp.locator('.genre-tile', { hasText: 'Drama' }).first().click();
await bp.waitForTimeout(2200);

const deeper = await bp.locator('.grid .tile .t-name').allTextContents();
console.log('drama with page 1 already seen ->', deeper.join(', '));
if (!deeper.length) {
  problems.push('a genre whose first page is all seen came back empty instead of fetching more');
}
for (const seen of ['The Grand Budapest Hotel', 'Breaking Bad']) {
  if (deeper.includes(seen)) problems.push(`${seen} is already watched but was offered as a new pick`);
}
if (new Set(deeper).size !== deeper.length) {
  problems.push(`the same title appeared twice across pages: ${deeper.join('|')}`);
}
await bp.screenshot({ path: `${OUT}/33-genre-deeper-pages.png` });

// And once every page really is exhausted, it says so rather than spinning.
await bp.evaluate(() => {
  const data = JSON.parse(localStorage.getItem('wl.data.v1'));
  for (const id of [496243, 120467]) {
    data.items[`movie:${id}`] = { type: 'movie', id, title: String(id), watched: true, seasons: {}, updatedAt: 3 };
  }
  for (const id of [1396, 66732, 93405]) {
    data.items[`tv:${id}`] = { type: 'tv', id, title: String(id), watched: true, seasons: {}, updatedAt: 3 };
  }
  localStorage.setItem('wl.data.v1', JSON.stringify(data));
});
await bp.reload({ waitUntil: 'networkidle' });
await bp.waitForTimeout(500);
await bp.click('.tab[data-tab="genres"]');
await bp.waitForTimeout(700);
await bp.locator('.genre-tile', { hasText: 'Drama' }).first().click();
await bp.waitForTimeout(2400);
const exhausted = await bp.locator('.empty p').textContent().catch(() => '');
console.log('drama, everything seen ->', exhausted);
if (!/page/i.test(exhausted)) {
  problems.push(`an exhausted genre did not say how far it looked: "${exhausted}"`);
}
if (await bp.locator('.grid .tile').count()) {
  problems.push('an exhausted genre still rendered tiles');
}

await browser.close();

console.log('\n=== problems ===');
console.log(problems.length ? problems.join('\n') : 'none');
process.exit(problems.length ? 1 : 0);
