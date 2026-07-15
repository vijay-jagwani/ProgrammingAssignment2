// End-to-end test: drives a full multi-browser game against the local
// harness — 1 admin + 2 single-player teams (players claim all 5 roles),
// plays month 1 with explicit decisions + a trade in month 2, then
// defaults through month 3 to the final leaderboard.
// Usage: node scripts/e2e.mjs [--headed]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });

const procs = [];
function run(cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    stdio: 'pipe',
    env: { ...process.env, ...env },
    cwd: new URL('..', import.meta.url).pathname,
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  procs.push(p);
  return p;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const steps = [];
function step(msg) {
  steps.push(msg);
  console.log(`  ✓ ${msg}`);
}

async function clickConfirm(page, nameRe) {
  await page.getByRole('button', { name: nameRe }).first().click();
  await page.getByRole('button', { name: 'Click again to confirm' }).click();
}

async function main() {
  console.log('Starting local API + web…');
  run('npx', ['tsx', 'scripts/dev-local.ts'], { PORT: '8787' });
  // force the in-memory backend even when a .env.local points at Supabase
  run('npm', ['run', 'dev', '-w', 'client'], { VITE_BACKEND: 'local' });
  await waitForHttp('http://localhost:8787/api/local/view?code=NONE');
  await waitForHttp('http://localhost:5173/');

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    // pinned browser build may differ from the installed playwright version
    executablePath: process.env.CHROMIUM_PATH ?? undefined,
  });
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto('http://localhost:5173/');
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
  step(`Admin created game ${code}`);

  for (const [page, name, team] of [[alice, 'Alice', 'Alpha'], [bob, 'Bob', 'Beta']]) {
    await page.getByPlaceholder('e.g. Priya').fill(name);
    await page.getByPlaceholder('e.g. K7M2QX').fill(code);
    await page.getByRole('button', { name: 'Join game' }).click();
    await page.getByPlaceholder('Team name').fill(team);
    await page.getByRole('button', { name: 'Create team' }).click();
    // claim all five roles (single-player team) — scoped to own team card
    const myCard = page.locator('.card', { has: page.locator('h3', { hasText: team }) });
    for (const role of ['Demand Planner', 'Production Planner', 'Transport Manager', 'Customer Ops Manager', 'CEO']) {
      await myCard.locator('.rolechip', { hasText: role }).first().click();
      await myCard.locator('.rolechip.mine', { hasText: role }).waitFor();
    }
    step(`${name} joined, created ${team}, claimed all roles`);
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
    // allocate within (tight) line capacity on the team's "own" SKU
    const inputs = page.locator('.card:has(h2:text("Production plan")) input.num');
    await inputs.nth(which).fill('100');
    await clickConfirm(page, /Submit plan/);
    await page.getByText('✓ Submitted').first().waitFor();
  }
  await alice.screenshot({ path: `${SHOTS}/2-production-alice.png`, fullPage: true });
  step('Both teams planned production (specialized)');
  await clickConfirm(admin, /Advance phase/);

  for (const page of [alice, bob]) {
    await page.getByRole('heading', { name: /Transport plan/ }).waitFor();
    await clickConfirm(page, /Submit transport/);
  }
  step('Transport submitted (truckload)');
  await clickConfirm(admin, /Advance phase/);

  for (const page of [alice, bob]) {
    await page.getByRole('heading', { name: /Set selling prices/ }).waitFor();
    await clickConfirm(page, /Submit prices/);
  }
  step('Prices submitted');
  await clickConfirm(admin, /Advance phase/);

  // trading phase: price board visible to teams
  await alice.getByRole('heading', { name: /Price board/ }).waitFor();
  await alice.screenshot({ path: `${SHOTS}/3-trading-priceboard.png`, fullPage: true });
  step('Price board revealed');
  await clickConfirm(admin, /Advance phase/);

  // orders — under-order so Alpha keeps stock to trade in month 2
  await admin.getByRole('heading', { name: /Customer orders/ }).waitFor();
  // allocation grid: one input per SKU x team (2 SKUs x 2 teams = 4 cells)
  const orderInputs = admin.locator('.card:has(h2:text("Customer orders")) input.num');
  for (let i = 0; i < 4; i++) await orderInputs.nth(i).fill('50');
  await clickConfirm(admin, /Set orders/);
  await admin.getByText('✓ Orders set').waitFor();
  await clickConfirm(admin, /Lock orders & resolve month/);
  await alice.getByRole('heading', { name: /Month 1 results/ }).waitFor();
  await alice.screenshot({ path: `${SHOTS}/4-results-month1.png`, fullPage: true });
  step('Month 1 resolved — results shown');
  await clickConfirm(admin, /Start month 2/);

  // ---- month 2: defaults + a real trade
  await admin.getByText('Demand Forecast — month 2', { exact: false }).waitFor();
  for (const re of [/Advance phase/, /Advance phase/, /Advance phase/, /Advance phase/]) {
    await clickConfirm(admin, re); // forecast, production, transport, pricing -> TRADING
  }
  // Bob's CEO buys Alice's leftover stock
  await bob.getByRole('heading', { name: /Price reveal & trading/ }).waitFor();
  await bob.getByLabel('Quantity').fill('20');
  await clickConfirm(bob, /Propose —/);
  await alice.getByRole('button', { name: 'Accept' }).click();
  await alice.getByText('accepted').first().waitFor();
  await bob.getByText('accepted').first().waitFor();
  step('Trade proposed by Beta, accepted by Alpha');
  await clickConfirm(admin, /Advance phase/); // -> ORDERS
  await clickConfirm(admin, /Lock orders & resolve month/); // proposal used as-is
  await clickConfirm(admin, /Start month 3/);
  step('Month 2 resolved (engine-proposed orders)');

  // ---- month 3: all defaults
  for (const re of [/Advance phase/, /Advance phase/, /Advance phase/, /Advance phase/, /Advance phase/]) {
    await clickConfirm(admin, re);
  }
  await clickConfirm(admin, /Lock orders & resolve month/);
  await clickConfirm(admin, /Finish game/);

  // ---- final leaderboard everywhere
  for (const [page, who] of [[admin, 'admin'], [alice, 'alice'], [bob, 'bob']]) {
    await page.getByText(/wins with/).waitFor();
    await page.getByRole('heading', { name: 'Final leaderboard' }).waitFor();
    if (who !== 'admin') await page.getByText(/Cumulative profit by month/).waitFor();
  }
  await admin.screenshot({ path: `${SHOTS}/5-final-leaderboard.png`, fullPage: true });
  step('Game over — final leaderboard rendered for admin + both teams');

  await browser.close();
  console.log(`\nE2E PASSED — ${steps.length} steps, screenshots in ${SHOTS}/`);
}

main()
  .catch((e) => {
    console.error('\nE2E FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const p of procs) p.kill('SIGTERM');
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });
