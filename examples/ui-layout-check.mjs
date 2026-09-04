#!/usr/bin/env node
/**
 * Browser smoke check for the built-in layout modes: grid → spotlight →
 * sidebar cycling (toolbar button + handle.setLayout), tile re-homing and
 * click-to-pin. Uses two peers in one page over BroadcastChannel signaling
 * with Chromium fake media. Skips cleanly when playwright-core or a cached
 * chromium build is unavailable (so it is safe in generic CI).
 *
 * Run: node examples/ui-layout-check.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5231;
const FIXTURE = path.join(ROOT, 'examples', '.ui-layout-fixture.html');

const page = `<!doctype html><html><body style="margin:0">
<div id="a" style="width:800px;height:600px"></div>
<div id="b" style="width:800px;height:600px"></div>
<script type="module">
import { mount } from '/dist/ui/index.js';
import { createBroadcastSignalAdapter } from '/dist/index.js';
window.handles = [
  mount(document.getElementById('a'), {
    roomId: 'layout-check', peerId: 'p1', displayName: 'Ada',
    signal: createBroadcastSignalAdapter('layout-check', 'p1'),
  }),
  mount(document.getElementById('b'), {
    roomId: 'layout-check', peerId: 'p2', displayName: 'Bob',
    signal: createBroadcastSignalAdapter('layout-check', 'p2'),
  }),
];
</script></body></html>`;

function findChromium() {
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(cache, dir, sub);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function waitForServer(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`demo server not ready at ${url}`);
}

async function main() {
  let playwright;
  try {
    playwright = await import('playwright-core');
  } catch {
    console.log('skip: playwright-core not installed');
    return;
  }
  const executablePath = findChromium();
  if (!executablePath) {
    console.log('skip: no cached playwright chromium');
    return;
  }

  writeFileSync(FIXTURE, page);
  const server = spawn(process.execPath, ['demo/serve.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/dist/ui/index.js`);
    browser = await playwright.chromium.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    const pageObj = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    await pageObj.goto(`http://127.0.0.1:${PORT}/examples/.ui-layout-fixture.html`);
    await pageObj.waitForFunction(
      () => {
        const roots = document.querySelectorAll('.kapi-root');
        return (
          roots.length === 2 &&
          [...roots].every((r) => r.querySelectorAll('.kapi-tile').length === 2)
        );
      },
      undefined,
      { timeout: 20_000 },
    );

    const state = (rootIndex) =>
      pageObj.evaluate((i) => {
        const r = document.querySelectorAll('.kapi-root')[i];
        const modes = [...r.classList].filter((c) => c.startsWith('layout-'));
        const n = (s) => r.querySelectorAll(s + ' > .kapi-tile').length;
        return {
          modes,
          grid: n('.kapi-grid'),
          stage: n('.kapi-stage'),
          strip: n('.kapi-strip'),
          gridVisible: getComputedStyle(r.querySelector('.kapi-grid')).display !== 'none',
          stagePeer: r.querySelector('.kapi-stage > .kapi-tile')?.dataset.peerId ?? null,
          pinnedPeer: r.querySelector('.kapi-tile.pinned')?.dataset.peerId ?? null,
          layoutButton: !!r.querySelector('button[data-id="layout"]'),
        };
      }, rootIndex);

    // 1. default grid: all tiles in .kapi-grid, no mode class
    let s = await state(0);
    assert.equal(s.layoutButton, true, 'layout button present by default');
    assert.deepEqual(s.modes, [], 'no layout mode class initially');
    assert.equal(s.grid, 2, 'grid holds both tiles');
    assert.equal(s.gridVisible, true, 'grid visible in grid mode');

    // 2. toolbar button cycles grid → spotlight → sidebar → grid
    const clickLayout = () =>
      pageObj.evaluate(() => {
        document
          .querySelectorAll('.kapi-root')[0]
          .querySelector('button[data-id="layout"]')
          .click();
      });
    await clickLayout();
    s = await state(0);
    assert.deepEqual(s.modes, ['layout-spotlight'], 'spotlight class after first cycle');
    assert.equal(s.grid, 0, 'grid emptied in spotlight');
    assert.equal(s.stage, 1, 'one featured tile on stage');
    assert.equal(s.strip, 1, 'one tile in filmstrip');
    // Filmstrip thumbs keep 16:9 (Zoom/Meet style) instead of stretching
    // to fill the strip.
    const stripRatio = await pageObj.evaluate(() => {
      const t = document
        .querySelectorAll('.kapi-root')[0]
        .querySelector('.kapi-strip > .kapi-tile');
      const r = t.getBoundingClientRect();
      return r.height > 0 ? r.width / r.height : 0;
    });
    assert.ok(
      Math.abs(stripRatio - 16 / 9) < 0.05,
      `spotlight filmstrip thumb is 16:9 (got ${stripRatio.toFixed(2)})`,
    );

    await clickLayout();
    s = await state(0);
    assert.deepEqual(s.modes, ['layout-sidebar'], 'sidebar class after second cycle');
    assert.equal(s.stage, 1, 'one featured tile on stage (sidebar)');
    assert.equal(s.strip, 1, 'one tile in side strip');
    const sideRatio = await pageObj.evaluate(() => {
      const t = document
        .querySelectorAll('.kapi-root')[0]
        .querySelector('.kapi-strip > .kapi-tile');
      const r = t.getBoundingClientRect();
      return r.height > 0 ? r.width / r.height : 0;
    });
    assert.ok(
      Math.abs(sideRatio - 16 / 9) < 0.05,
      `sidebar strip thumb is 16:9 (got ${sideRatio.toFixed(2)})`,
    );

    await clickLayout();
    s = await state(0);
    assert.deepEqual(s.modes, [], 'back to grid after third cycle');
    assert.equal(s.grid, 2, 'tiles re-homed into grid');

    // 3. click-to-pin: pinning the strip tile promotes it to the stage
    await clickLayout(); // spotlight again
    await pageObj.evaluate(() => {
      const r = document.querySelectorAll('.kapi-root')[0];
      const remote = [...r.querySelectorAll('.kapi-strip > .kapi-tile')][0];
      remote.click();
    });
    s = await state(0);
    assert.equal(s.pinnedPeer, 'p2', 'clicked tile is pinned');
    assert.equal(s.stagePeer, 'p2', 'pinned tile promoted to stage');
    await pageObj.evaluate(() => {
      document
        .querySelectorAll('.kapi-root')[0]
        .querySelector('.kapi-tile.pinned')
        .click();
    });
    s = await state(0);
    assert.equal(s.pinnedPeer, null, 'second click unpins');
    assert.equal(s.stagePeer, 'p1', 'stage falls back to local tile');

    // 4. programmatic setLayout + handle.layout
    await pageObj.evaluate(() => window.handles[0].setLayout('sidebar'));
    s = await state(0);
    assert.deepEqual(s.modes, ['layout-sidebar'], 'setLayout switches mode');
    const layout = await pageObj.evaluate(() => window.handles[0].layout);
    assert.equal(layout, 'sidebar', 'handle.layout getter');
    // sibling mount is untouched
    const other = await state(1);
    assert.deepEqual(other.modes, [], 'second mount unaffected');

    // 5. remote mute chip: p1 mutes → both UIs show the chip on p1's tile.
    //    (Cannot infer this from remote track.muted — Chrome never fires it.)
    await pageObj.evaluate(() => {
      document
        .querySelectorAll('.kapi-root')[0]
        .querySelector('button[data-id="mic"]')
        .click();
    });
    await pageObj.waitForFunction(
      () => {
        const chip = (root, peerId) =>
          document
            .querySelectorAll('.kapi-root')
            [root].querySelector(`.kapi-tile[data-peer-id="${peerId}"] .kapi-mic-state`);
        const local = chip(0, 'p1');
        const remote = chip(1, 'p1');
        return (
          local &&
          !local.classList.contains('hidden') &&
          remote &&
          !remote.classList.contains('hidden')
        );
      },
      undefined,
      { timeout: 8000 },
    );

    // 6. narrow chrome: toolbar stays one row; extras go into ⋯ More
    const wideOverflow = await pageObj.evaluate(() => {
      const more = document.querySelectorAll('.kapi-root')[0].querySelector('button[data-id="more"]');
      return !more || more.hidden;
    });
    assert.equal(wideOverflow, true, 'more button hidden when the bar fits');

    await pageObj.evaluate(() => {
      document.getElementById('a').style.width = '260px';
    });
    await pageObj.waitForFunction(
      () => {
        const more = document.querySelectorAll('.kapi-root')[0].querySelector('button[data-id="more"]');
        return more && !more.hidden;
      },
      undefined,
      { timeout: 5000 },
    );
    const overflowState = await pageObj.evaluate(() => {
      const r = document.querySelectorAll('.kapi-root')[0];
      const bar = r.querySelector('.kapi-toolbar');
      return {
        barH: bar.offsetHeight,
        layoutInOverflow: !!r.querySelector('.kapi-overflow button[data-id="layout"]'),
        micInBar: !!r.querySelector('.kapi-toolbar button[data-id="mic"]'),
        hangupInBar: !!r.querySelector('.kapi-toolbar button[data-id="hangup"]'),
      };
    });
    assert.equal(overflowState.layoutInOverflow, true, 'layout moved into overflow');
    assert.equal(overflowState.micInBar, true, 'mic stays on the bar');
    assert.equal(overflowState.hangupInBar, true, 'hangup stays on the bar');
    assert.ok(overflowState.barH < 80, `toolbar is one row (height ${overflowState.barH})`);

    await pageObj.evaluate(() => {
      document.querySelectorAll('.kapi-root')[0].querySelector('button[data-id="more"]').click();
    });
    await pageObj.evaluate(() => {
      document
        .querySelectorAll('.kapi-root')[0]
        .querySelector('.kapi-overflow button[data-id="layout"]')
        .click();
    });
    s = await state(0);
    assert.deepEqual(s.modes, [], 'layout action from overflow still cycles');

    await pageObj.evaluate(() => {
      document.getElementById('a').style.width = '800px';
    });
    await pageObj.waitForFunction(
      () => {
        const r = document.querySelectorAll('.kapi-root')[0];
        const more = r.querySelector('button[data-id="more"]');
        return more && more.hidden && r.querySelector('.kapi-toolbar button[data-id="layout"]');
      },
      undefined,
      { timeout: 5000 },
    );

    console.log('ok: ui layouts, cycling, pinning, setLayout, remote mute, toolbar overflow');
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill();
    rmSync(FIXTURE, { force: true });
  }
}

main().catch((err) => {
  rmSync(FIXTURE, { force: true });
  console.error(err);
  process.exit(1);
});