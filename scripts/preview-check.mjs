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
  await page.addInitScript(() => {
    window.acquireVsCodeApi = () => ({
      postMessage: (msg) => window.sendPreviewMessage(msg),
    });
  });
  const started = performance.now();
  await page.goto('https://preview.invalid/');
  if (process.env.TEST_PREVIEW_FAIL) {
    await page.waitForFunction(() =>
      document.getElementById('status').textContent.includes('預覽失敗'),
    );
    if (await page.locator('#confirm').isEnabled())
      throw new Error('Export enabled after preview failure');
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
  }
} finally {
  await browser.close();
}
