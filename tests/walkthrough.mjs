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
await shot('08-movie-english-no-toggle');
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
await lp.screenshot({ path: `${OUT}/22-light-browse.png` });
await lp.fill('input[type="search"]', 'squid');
await lp.waitForTimeout(700);
await lp.click('.grid .tile');
await lp.waitForTimeout(900);
await lp.click('.rating-btn.once');
await lp.waitForTimeout(250);
await lp.screenshot({ path: `${OUT}/23-light-tv.png` });

await browser.close();

console.log('\n=== problems ===');
console.log(problems.length ? problems.join('\n') : 'none');
process.exit(problems.length ? 1 : 0);
