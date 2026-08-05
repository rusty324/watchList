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
for (const [query, rating] of [['squid', 'up'], ['spirited', 'up'], ['pulp', 'down']]) {
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

/* ---- 10. settings ---- */
await page.click('.icon-btn[aria-label="Settings"]');
await page.waitForTimeout(700);
await shot('18-settings');

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
await lp.screenshot({ path: `${OUT}/19-light-browse.png` });
await lp.fill('input[type="search"]', 'squid');
await lp.waitForTimeout(700);
await lp.click('.grid .tile');
await lp.waitForTimeout(900);
await lp.screenshot({ path: `${OUT}/20-light-tv.png` });

await browser.close();

console.log('\n=== problems ===');
console.log(problems.length ? problems.join('\n') : 'none');
process.exit(problems.length ? 1 : 0);
