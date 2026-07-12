// Reproduces the user's exact bug report: ONE browser window, THREE tabs.
// Tab 1: host creates game. Tab 2: joins as UserA, creates team, claims
// Demand Planner. Tab 3: joins as UserB, joins the team, claims Production
// Planner. All three pages live in ONE BrowserContext, so they share
// localStorage (like real tabs) but each has its own sessionStorage.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--ssl-version-max=tls1.2'],
  // Outbound HTTPS (supabase.co) must go via the sandbox proxy; localhost
  // (the vite dev server) must not.
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!ok) fails.push(msg);
};

// On any hard failure, dump what every open tab was showing.
process.on('uncaughtException', async (err) => {
  console.error('ERROR:', err.message.split('\n')[0]);
  for (const p of ctx.pages()) {
    try {
      console.error(`--- ${p.url()} ---`);
      console.error((await p.locator('body').innerText()).slice(0, 500));
    } catch {}
  }
  process.exit(1);
});

// ---------- Tab 1: host creates a game ----------
const tab1 = await ctx.newPage();
await tab1.goto(BASE);
await tab1.getByPlaceholder('e.g. Vijay').fill('Host');
await tab1.getByRole('button', { name: /create game/i }).click();
await tab1.waitForSelector('text=Lobby', { timeout: 20000 });
const codeText = await tab1.locator('.card b').first().textContent();
const code = codeText.trim();
console.log('game code:', code);

// ---------- Tab 2: UserA joins, creates team, claims Demand Planner ----------
const tab2 = await ctx.newPage();
await tab2.goto(BASE);
// Fresh tab must land on the landing page, NOT inherit tab 1's session
await tab2.getByPlaceholder('e.g. Priya').waitFor({ timeout: 30000 });
check(!(await tab2.locator('text=Lobby').isVisible()),
  'tab 2 starts as its own player (landing page, not hijacking tab 1)');
await tab2.getByPlaceholder('e.g. Priya').fill('UserA');
await tab2.getByPlaceholder('e.g. K7M2QX').fill(code);
await tab2.getByRole('button', { name: /join game/i }).click();
await tab2.waitForSelector('text=Lobby', { timeout: 20000 });
await tab2.getByPlaceholder('Team name').fill('Alpha');
await tab2.getByRole('button', { name: /create team/i }).click();
await tab2.waitForSelector('h3:has-text("Alpha")', { timeout: 15000 });
const alpha2 = tab2.locator('.card', { has: tab2.locator('h3:has-text("Alpha")') }).first();
await alpha2.locator('.rolechip', { hasText: 'Demand Planner' }).click();
await tab2.waitForSelector('.rolechip.mine:has-text("Demand Planner")', { timeout: 15000 });
check(true, 'tab 2 (UserA) created team Alpha and claimed Demand Planner');

// ---------- Tab 3: UserB joins, joins team, claims Production Planner ----------
const tab3 = await ctx.newPage();
await tab3.goto(BASE);
await tab3.getByPlaceholder('e.g. Priya').waitFor({ timeout: 30000 });
check(!(await tab3.locator('text=Lobby').isVisible()),
  'tab 3 starts as its own player (landing page)');
await tab3.getByPlaceholder('e.g. Priya').fill('UserB');
await tab3.getByPlaceholder('e.g. K7M2QX').fill(code);
await tab3.getByRole('button', { name: /join game/i }).click();
await tab3.waitForSelector('text=Lobby', { timeout: 20000 });

const alpha3 = tab3.locator('.card', { has: tab3.locator('h3:has-text("Alpha")') }).first();

// The reported bug path: clicking the role BEFORE joining the team must now
// explain itself instead of silently doing nothing.
await alpha3.locator('.rolechip', { hasText: 'Production Planner' }).click();
const gotHint = await tab3
  .locator('text=/Join Alpha first/i')
  .isVisible({ timeout: 5000 })
  .catch(() => false);
check(gotHint, 'tab 3 clicking a role before joining shows "Join Alpha first" hint');

// Now do it right: Join team, wait until we appear in the team, then claim.
await alpha3.getByRole('button', { name: /join team/i }).click();
await alpha3.locator('.badge.on', { hasText: 'UserB' }).waitFor({ timeout: 20000 });
await tab3.waitForTimeout(500); // let the busy flag clear
await alpha3.locator('.rolechip', { hasText: 'Production Planner' }).click();
await tab3.waitForSelector('.rolechip.mine:has-text("Production Planner")', { timeout: 20000 });
check(true, 'tab 3 (UserB) joined Alpha and claimed Production Planner');

// ---------- Cross-checks: three distinct simultaneous identities ----------
await tab2.waitForTimeout(1500); // let realtime catch up
const dpOwner = await tab2
  .locator('.rolechip:has-text("Demand Planner")').first().textContent();
const ppOwner = await tab2
  .locator('.rolechip:has-text("Production Planner")').first().textContent();
check(dpOwner.includes('UserA'), `Demand Planner still owned by UserA (saw: ${dpOwner.trim()})`);
check(ppOwner.includes('UserB'), `Production Planner owned by UserB (saw: ${ppOwner.trim()})`);

// Tab 2 is still UserA (its own chip is highlighted), tab 1 is still Host/admin
const tab2StillA = await tab2.locator('.badge.on:has-text("UserA")').count();
check(tab2StillA > 0, 'tab 2 still identifies as UserA (not stolen by tab 3)');
const tab1Admin = await tab1.locator('text=/Host.*admin/i').count();
check(tab1Admin > 0, 'tab 1 still identifies as Host (admin)');

// Refresh tab 3: per-tab session must survive a reload
await tab3.reload();
await tab3.waitForSelector('.rolechip.mine:has-text("Production Planner")', { timeout: 20000 });
check(true, 'tab 3 refresh keeps UserB + Production Planner');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
