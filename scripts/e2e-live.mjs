// Full-game end-to-end test against the LIVE deployed site (Supabase +
// Netlify) — the real thing the user plays, not the local harness.
// One browser window, one tab per player (per-tab identity): 1 facilitator
// + 2 single-player teams play a complete 3-month game: explicit month-1
// decisions incl. a truckload/interplant SPLIT shipment, a month-2 trade,
// defaults through month 3, final leaderboard.
// Usage: node scripts/e2e-live.mjs   (BASE_URL overrides the target)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'https://millsops.netlify.app';
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e-live-shots';
mkdirSync(SHOTS, { recursive: true });

const steps = [];
function step(msg) {
  steps.push(msg);
  console.log(`  ✓ ${msg}`);
}

async function clickConfirm(page, nameRe) {
  await page.getByRole('button', { name: nameRe }).first().click();
  await page.getByRole('button', { name: 'Click again to confirm' }).click();
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--ssl-version-max=tls1.2'],
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
// ONE context = one browser window; each page = one tab (per-tab identity)
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  ignoreHTTPSErrors: true,
});

async function main() {
  const mk = async () => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(45_000); // real network + realtime latency
    await page.goto(BASE);
    return page;
  };

  const admin = await mk();
  const alice = await mk();
  const bob = await mk();

  // ---- create + join
  await admin.getByPlaceholder('e.g. Vijay').fill('Host');
  await admin.getByLabel('Months').fill('3');
  await admin.getByLabel('SKUs').fill('2');
  await admin.getByLabel('Customers').fill('2');
  await admin.getByRole('button', { name: 'Create game' }).click();
  const code = (await admin.locator('.gamecode').textContent()).trim();
  step(`Admin created game ${code} on ${BASE}`);

  for (const [page, name, team] of [[alice, 'Alice', 'Alpha'], [bob, 'Bob', 'Beta']]) {
    await page.getByPlaceholder('e.g. Priya').fill(name);
    await page.getByPlaceholder('e.g. K7M2QX').fill(code);
    await page.getByRole('button', { name: 'Join game' }).click();
    await page.getByPlaceholder('Team name').waitFor();
    await page.getByPlaceholder('Team name').fill(team);
    await page.getByRole('button', { name: 'Create team' }).click();
    const myCard = page.locator('.card', { has: page.locator('h3', { hasText: team }) });
    await myCard.locator('.badge.on', { hasText: name }).waitFor();
    for (const role of ['Demand Planner', 'Production Planner', 'Transport Manager', 'Customer Ops Manager', 'CEO']) {
      await myCard.locator('.rolechip', { hasText: role }).first().click();
      await myCard.locator('.rolechip.mine', { hasText: role }).waitFor();
    }
    step(`${name} joined in own tab, created ${team}, claimed all 5 roles`);
  }

  await admin.locator('.card', { hasText: 'Facilitator controls' }).waitFor();
  await admin.screenshot({ path: `${SHOTS}/1-lobby-admin.png`, fullPage: true });
  await admin.getByRole('button', { name: /Start game/ }).click();
  await admin.getByText('Demand Forecast — month 1', { exact: false }).waitFor();
  step('Game started');

  // ---- month 1: explicit decisions
  for (const page of [alice, bob]) {
    await page.getByRole('heading', { name: /Demand forecast — month 1/ }).waitFor();
    await clickConfirm(page, /Submit forecast/);
    await page.getByText('✓ Submitted', { exact: false }).first().waitFor();
  }
  step('Both teams forecast');
  await clickConfirm(admin, /Advance phase/);

  for (const [page, which] of [[alice, 0], [bob, 1]]) {
    await page.getByRole('heading', { name: /Production plan/ }).waitFor();
    const inputs = page.locator('.card:has(h2:text("Production plan")) input.num');
    await inputs.nth(which).fill('100');
    await clickConfirm(page, /Submit plan/);
    await page.getByText('✓ Submitted').first().waitFor();
  }
  step('Both teams planned production (specialized SKUs)');
  await clickConfirm(admin, /Advance phase/);

  // Alice SPLITS her 100 units: 60 truckload (sell now) + 40 interplant (next month)
  await alice.getByRole('heading', { name: /Transport plan/ }).waitFor();
  const tCard = alice.locator('.card:has(h2:text("Transport plan"))');
  const tIn = tCard.locator('input.num');
  await tIn.nth(0).fill('60'); // SKU1 truckload
  await tIn.nth(1).fill('40'); // SKU1 interplant
  await clickConfirm(alice, /Submit transport/);
  await alice.getByText('✓ Submitted').first().waitFor();
  await alice.screenshot({ path: `${SHOTS}/2-transport-split.png`, fullPage: true });
  step('Alice split shipment: 60 truckload + 40 interplant');
  await bob.getByRole('heading', { name: /Transport plan/ }).waitFor();
  await clickConfirm(bob, /Submit transport/);
  step('Bob submitted transport (all truckload)');
  await clickConfirm(admin, /Advance phase/);

  for (const page of [alice, bob]) {
    await page.getByRole('heading', { name: /Set selling prices/ }).waitFor();
    await clickConfirm(page, /Submit prices/);
  }
  step('Prices submitted');
  await clickConfirm(admin, /Advance phase/);

  await alice.getByRole('heading', { name: /Price board/ }).waitFor();
  await alice.screenshot({ path: `${SHOTS}/3-priceboard.png`, fullPage: true });
  step('Price board revealed to teams');
  await clickConfirm(admin, /Advance phase/);

  // orders — modest, so Alpha keeps leftover stock to trade in month 2
  await admin.getByRole('heading', { name: /Customer orders/ }).waitFor();
  // allocation grid: one input per SKU x team (2 SKUs x 2 teams = 4 cells)
  const orderInputs = admin.locator('.card:has(h2:text("Customer orders")) input.num');
  for (let i = 0; i < 4; i++) await orderInputs.nth(i).fill('50');
  await admin.screenshot({ path: `${SHOTS}/3b-orders-allocation.png`, fullPage: true });
  await clickConfirm(admin, /Set orders/);
  await admin.getByText('✓ Orders set').waitFor();
  await clickConfirm(admin, /Lock orders & resolve month/);
  await alice.getByRole('heading', { name: /Month 1 results/ }).waitFor();
  await alice.screenshot({ path: `${SHOTS}/4-results-month1.png`, fullPage: true });
  step('Month 1 resolved — results shown');
  await clickConfirm(admin, /Start month 2/);

  // ---- month 2: Alice's 40 interplant units must have arrived
  await admin.getByText('Demand Forecast — month 2', { exact: false }).waitFor();
  for (const re of [/Advance phase/, /Advance phase/, /Advance phase/, /Advance phase/]) {
    await clickConfirm(admin, re); // forecast, production, transport, pricing -> TRADING
  }
  await bob.getByRole('heading', { name: /Price reveal & trading/ }).waitFor();
  const qtyIn = bob.getByLabel('Quantity');
  await qtyIn.click();
  await qtyIn.fill('10');
  // prove the form really holds qty 10 before proposing (10 × $15.50 ref price).
  // Alpha has exactly 10 on hand now: 100 made − 40 still in transit − 50 sold.
  await bob.getByRole('button', { name: /Propose — \$155/ }).waitFor();
  await clickConfirm(bob, /Propose —/);
  await bob.getByText('pending').first().waitFor(); // offer registered server-side
  step('Beta proposed to buy 10 units from Alpha');
  await alice.getByText(/wants your/).waitFor(); // reached Alice via realtime
  await alice.getByRole('button', { name: 'Accept' }).click();
  await alice.getByText('accepted').first().waitFor();
  await bob.getByText('accepted').first().waitFor();
  await bob.screenshot({ path: `${SHOTS}/5-trade-accepted.png`, fullPage: true });
  step('Trade: Beta bought 10 units from Alpha, accepted live across tabs');
  await clickConfirm(admin, /Advance phase/); // -> ORDERS
  await clickConfirm(admin, /Lock orders & resolve month/);
  await clickConfirm(admin, /Start month 3/);
  step('Month 2 resolved (engine-proposed orders confirmed)');

  // ---- month 3: all defaults
  for (const re of [/Advance phase/, /Advance phase/, /Advance phase/, /Advance phase/, /Advance phase/]) {
    await clickConfirm(admin, re);
  }
  await clickConfirm(admin, /Lock orders & resolve month/);
  await clickConfirm(admin, /Finish game/);

  for (const [page, who] of [[admin, 'admin'], [alice, 'alice'], [bob, 'bob']]) {
    await page.getByText(/wins with/).waitFor();
    await page.getByRole('heading', { name: 'Final leaderboard' }).waitFor();
    if (who !== 'admin') await page.getByText(/Cumulative profit by month/).waitFor();
  }
  await admin.screenshot({ path: `${SHOTS}/6-final-leaderboard.png`, fullPage: true });
  step('Game over — final leaderboard rendered in every tab');

  await browser.close();
  console.log(`\nLIVE E2E PASSED — ${steps.length} steps against ${BASE}, screenshots in ${SHOTS}/`);
}

main().catch(async (e) => {
  console.error('\nLIVE E2E FAILED:', e.message.split('\n')[0]);
  let i = 0;
  for (const p of ctx.pages()) {
    try {
      i += 1;
      await p.screenshot({ path: `${SHOTS}/fail-tab${i}.png`, fullPage: true });
      console.error(`--- tab ${i}: ${p.url()} ---`);
      console.error((await p.locator('body').innerText()).slice(0, 1800));
    } catch {}
  }
  await browser.close();
  process.exit(1);
});
