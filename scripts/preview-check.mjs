import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('dist/browsers');
const { chromium } = await import('../dist/playwright/index.mjs');
await build({
  stdin: {
    contents:
      "export {confirmPdf} from './src/preview'; export {panels} from './tests/vscode-stub';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { vscode: path.resolve('tests/vscode-stub.ts') },
  outfile: '.vendor/preview-harness.cjs',
});
const { confirmPdf, panels } = createRequire(import.meta.url)(
  '../.vendor/preview-harness.cjs',
);
const decision = confirmPdf(
  { extensionUri: { path: '' } },
  await readFile('output/pdf/完整範例.pdf'),
  new AbortController().signal,
);
const panel = panels[0];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ offline: true });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      process.env.TEST_PREVIEW_FAIL &&
      url.pathname.endsWith(
        process.env.TEST_PREVIEW_FAIL === 'module'
          ? '/pdf.mjs'
          : '/pdf.worker.mjs',
      )
    )
      return route.fulfill({ status: 503, body: 'Test resource load failure' });
    if (url.origin !== 'https://preview.invalid') return route.abort();
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: panel.webview.html,
      });
    try {
      const file = path.resolve('.' + url.pathname);
      if (!file.startsWith(path.resolve('dist/assets') + path.sep))
        return route.abort();
      await route.fulfill({
        body: await readFile(file),
        contentType: file.endsWith('.mjs')
          ? 'text/javascript'
          : 'application/octet-stream',
      });
    } catch {
      await route.abort();
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('Preview page error:', e));
  await page.exposeFunction('sendPreviewMessage', (msg) => panel.message(msg));
  panel.outgoing = (message) => {
    void page.evaluate(
      (message) =>
        window.dispatchEvent(new MessageEvent('message', { data: message })),
      message,
    );
  };
  await page.addInitScript(() => {
    window.acquireVsCodeApi = () => ({
      postMessage: (msg) => window.sendPreviewMessage(msg),
    });
  });
  const started = performance.now();
  await page.goto('https://preview.invalid/');
  if (process.env.TEST_PREVIEW_FAIL) {
    await page.waitForFunction(() =>
      document.getElementById('status').textContent.includes('Preview failed'),
    );
    if (await page.locator('#confirm').isEnabled())
      throw new Error('Export enabled after preview failure');
    await page.locator('#more summary').click();
    await page.locator('#cancel').click();
    if (await decision) throw new Error('Failed preview confirmed');
    console.log(
      'Resource failure reported and cancellation works:',
      process.env.TEST_PREVIEW_FAIL,
    );
  } else {
    await page.locator('#confirm:enabled').waitFor({ timeout: 60000 });
    console.log('First page ms:', Math.round(performance.now() - started));
    console.log('Preview:', await page.locator('#status').innerText());
    await page.screenshot({ path: '.vendor/preview.png', fullPage: false });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(250);
    const toolbar = await page.locator('header').boundingBox();
    if (toolbar.height > 40)
      throw new Error('Toolbar should remain a single compact row');
    await page.screenshot({ path: '.vendor/preview-compact.png' });
    await page.locator('#zoom').selectOption('2');
    await page.evaluate(() =>
      document.getElementById('pages').scrollTo(500, 0),
    );
    const pinned = await page.locator('header').boundingBox();
    if (pinned.x < 0 || pinned.x + pinned.width > 360)
      throw new Error('Toolbar scrolled out of view horizontally');
    await page.evaluate(() => document.getElementById('pages').scrollTo(0, 0));
    await page.locator('#zoom').selectOption('fit');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(250);
    const wideToolbar = await page.locator('header').boundingBox();
    if (wideToolbar.width > 550)
      throw new Error(
        'Toolbar should fit its controls instead of spanning the viewport',
      );
    const total = await page.locator('section').count();
    const initial = await page.locator('section[data-rendered="true"]').count();
    if (total > 3 && initial >= total)
      throw new Error('Preview eagerly rendered every page');
    await page.locator('section').last().scrollIntoViewIfNeeded();
    await page.locator('section').last().locator('canvas').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('section:last-child')?.dataset.rendered ===
        'true',
    );
    console.log(
      'Lazy preview:',
      initial,
      'initially rendered of',
      total,
      'pages; last page rendered after scrolling',
    );
    await page.locator('#zoom').selectOption('1.25');
    await page.waitForFunction(
      () =>
        document.querySelector('section:last-child')?.dataset.rendered ===
        'true',
    );
    if ((await page.locator('canvas').count()) > 3)
      throw new Error('Canvas cache exceeded three pages');
    if (!(await page.locator('.textLayer span').count()))
      throw new Error('Missing selectable text');
    await page.locator('#page').fill('1');
    await page.locator('#page').press('Enter');
    await page.locator('#page').blur();
    await page.waitForFunction(
      () => document.querySelector('section')?.dataset.rendered === 'true',
    );
    await page.locator('#more summary').click();
    await page.locator('#search').fill('Markdown');
    await page.locator('#find').click();
    await page.waitForFunction(() =>
      document
        .getElementById('find-status')
        .textContent.startsWith('Match on page'),
    );
    console.log(
      'Zoom, jump, selectable text, search, and bounded canvas cache passed',
    );
    // Updates invalidate confirmation immediately; a replacement preserves the current page.
    await panel.outgoing({
      type: 'busy',
      message: 'Document changed — updating preview…',
    });
    await page.waitForFunction(
      () => document.getElementById('confirm').disabled,
    );
    const rememberedPage = await page.locator('#page').inputValue();
    await panel.outgoing({
      type: 'pdf',
      data: (await readFile('output/pdf/完整範例.pdf')).toString('base64'),
      revision: 2,
      issues: 0,
    });
    await page.locator('#confirm:enabled').waitFor();
    if ((await page.locator('#page').inputValue()) !== rememberedPage)
      throw new Error('Update lost page position');
    await panel.outgoing({
      type: 'pdf',
      data: (await readFile('output/pdf/完整範例.pdf')).toString('base64'),
      revision: 3,
      issues: 0,
    });
    await panel.outgoing({ type: 'busy', message: 'Newer edit pending…' });
    await page.waitForTimeout(100);
    if (await page.locator('#confirm').isEnabled())
      throw new Error('Stale update enabled export');
    await panel.outgoing({
      type: 'pdf',
      data: (await readFile('output/pdf/完整範例.pdf')).toString('base64'),
      revision: 4,
      issues: 0,
    });
    await page.locator('#confirm:enabled').waitFor();
    console.log(
      'Live replacement preserves position; superseded previews cannot export',
    );
    await panel.outgoing({
      type: 'pdf',
      data: (await readFile('output/pdf/完整範例.pdf')).toString('base64'),
      revision: 5,
      issues: 3,
    });
    await page.locator('#confirm:enabled').waitFor();
    await page.locator('#issues').waitFor({ state: 'visible' });
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    if (await page.locator('#status').isVisible())
      throw new Error('Issue status obstructs preview');
    if ((await page.locator('#issues').innerText()) !== '⚠ 3')
      throw new Error('Missing issue badge');
    await page.screenshot({ path: '.vendor/preview-issues.png' });
    await page.locator('#confirm').click();
    if (!(await decision)) throw new Error('Confirmation did not resolve true');
    const controller = new AbortController();
    const canceled = confirmPdf(
      { extensionUri: { path: '' } },
      Buffer.from(''),
      controller.signal,
    );
    controller.abort();
    if (await canceled) throw new Error('Cancellation failed');
    console.log('Preview confirmation and cancellation passed');
    const landscape = (
      await readFile('output/pdf/layout-landscape.pdf')
    ).toString('base64');
    const a5 = (await readFile('output/pdf/layout-a5.pdf')).toString('base64');
    const layouts = await page.evaluate(
      async ({ landscape, a5 }) => {
        const { getDocument } = await import('/dist/assets/pdfjs/pdf.mjs');
        const results = [];
        for (const data of [landscape, a5]) {
          const task = getDocument({
            data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
            isEvalSupported: false,
          });
          const pdf = await task.promise;
          const p = await pdf.getPage(1);
          const viewport = p.getViewport({ scale: 1 });
          const content = await p.getTextContent();
          results.push({
            width: viewport.width,
            height: viewport.height,
            text: content.items.map((i) => i.str).join(''),
            body: content.items.find((i) => i.str.includes('Layout body')),
          });
          await task.destroy();
        }
        return results;
      },
      { landscape, a5 },
    );
    if (
      Math.abs(layouts[0].width - 792) > 1 ||
      Math.abs(layouts[0].height - 612) > 1
    )
      throw new Error('Letter landscape dimensions incorrect');
    if (
      Math.abs(layouts[0].body.height - 16) > 1 ||
      Math.abs(layouts[0].body.transform[4] - (30 * 72) / 25.4) > 2
    )
      throw new Error('Body font size or left margin incorrect');
    if (layouts[0].text.includes('1 / 1'))
      throw new Error('Page numbers were not disabled');
    if (
      Math.abs(layouts[1].width - (148 * 72) / 25.4) > 1 ||
      Math.abs(layouts[1].height - (210 * 72) / 25.4) > 1
    )
      throw new Error('A5 dimensions incorrect');
    if (!layouts[1].text.includes('Page 1 of 1'))
      throw new Error('Page number style incorrect');
    console.log(
      'Paper size, orientation, font size, margin and footer settings verified in PDF bytes',
    );
  }
} finally {
  await browser.close();
}
