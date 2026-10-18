// End-to-end test for solo mode: one browser plays a 3-month game as Demand
// Planner + CEO while the game plays the other roles and two rival teams.
// Checks that strangers are turned away, automated roles never ask for input,
// the orders step is skipped, and the final leaderboard lists the rivals.
// Usage: node scripts/e2e-solo.mjs [--headed]
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
    return ctx.newPage();
  };

  // ---- host a solo game: Demand Planner + CEO, two rivals, three months
  const sam = await mk();
  await sam.goto('http://localhost:5173/');
  await sam.getByRole('button', { name: 'Solo practice' }).click();
  await sam.getByPlaceholder('e.g. Vijay').fill('Sam');
  await sam.getByPlaceholder('e.g. Sam Co').fill('Sam Co');
  await sam.locator('input.num[min="3"][max="24"]').fill('3');
  for (const role of ['Production Planner', 'Transport Manager', 'Customer Ops Manager']) {
    await sam.locator('.rolechip', { hasText: role }).click();
  }
  await sam.getByRole('button', { name: 'Start solo game' }).click();
  await sam.getByRole('heading', { name: 'Solo game — set up your roles' }).waitFor();
  const code = (await sam.locator('.gamecode').textContent()).trim();
  await sam.screenshot({ path: `${SHOTS}/1-solo-lobby.png`, fullPage: true });
  step(`Solo game ${code} created with Demand Planner + CEO picked`);

  // ---- a stranger with the code is turned away
  const stranger = await mk();
  await stranger.goto('http://localhost:5173/');
  await stranger.getByPlaceholder('e.g. Priya').fill('Stu');
  await stranger.getByPlaceholder('e.g. K7M2QX').fill(code);
  await stranger.getByRole('button', { name: 'Join game' }).click();
  await stranger.getByText('This is a solo game').waitFor();
  step('A stranger joining with the code is refused');

  // ---- start and play three months
  await sam.getByRole('button', { name: 'Start solo game' }).click();
  await sam.getByText('You play: Demand Planner, CEO').waitFor();
  step('Game started: Sam plays Demand Planner and CEO; the game plays the rest');

  for (let m = 1; m <= 3; m++) {
    await sam.getByRole('heading', { name: `Demand Forecast — month ${m}`, exact: true }).waitFor();
    if (m === 1) await sam.screenshot({ path: `${SHOTS}/2-solo-forecast.png`, fullPage: true });
    await clickConfirm(sam, /Submit forecast/);
    await sam.getByText('✓ Submitted — you can still revise until the phase ends').waitFor();
    await clickConfirm(sam, /^Advance phase$/); // -> PRODUCTION (automated)

    await sam.getByText('the game plays Production Planner').waitFor();
    await clickConfirm(sam, /^Advance phase$/); // -> TRANSPORT (automated)

    await sam.getByText('the game plays Transport Manager').waitFor();
    await clickConfirm(sam, /^Advance phase$/); // -> PRICING (automated)

    await sam.getByText('the game plays Customer Ops Manager').waitFor();
    await clickConfirm(sam, /Lock prices & resolve month/); // no trading, no orders step

    await sam.getByRole('button', { name: m < 3 ? `Start month ${m + 1}` : 'Finish game' }).waitFor();
    if (await sam.getByText('Customer orders — you are the market').count()) {
      throw new Error('Solo month showed the facilitator orders step');
    }
    step(`Month ${m} resolved without a facilitator, orders split across the market`);
    await clickConfirm(sam, m < 3 ? /Start month/ : /Finish game/);
  }

  // ---- final leaderboard lists the player and both rivals
  await sam.getByText(/wins with/).waitFor();
  await sam.getByRole('heading', { name: 'Final leaderboard' }).waitFor();
  await sam.getByText('Sam Co (you)').waitFor();
  await sam.getByRole('cell', { name: 'Rival 1', exact: true }).waitFor();
  await sam.getByRole('cell', { name: 'Rival 2', exact: true }).waitFor();
  await sam.screenshot({ path: `${SHOTS}/3-solo-final.png`, fullPage: true });
  step('Game over — leaderboard shows Sam Co against Rival 1 and Rival 2');

  await browser.close();
  console.log(`\nE2E SOLO PASSED — ${steps.length} steps, screenshots in ${SHOTS}/`);
}

main()
  .catch((e) => {
    console.error('\nE2E SOLO FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const p of procs) p.kill('SIGTERM');
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });
