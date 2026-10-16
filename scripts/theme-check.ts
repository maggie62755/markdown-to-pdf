import { renderMarkdown } from '../src/markdown';
import { resolveCodeTheme } from '../src/themes';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
async function main() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('dist/browsers');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  try {
    await mkdir('output/themes', { recursive: true });
    for (const codeTheme of ['one-light', 'github-dark'] as const) {
      const result = await renderMarkdown(
        '# 程式碼配色\n\nBuild the extension with `npm run build`, then run:\n\n```bash\n# Create a new Conda environment\nconda create --name document_demo python=3.11.14\nconda activate document_demo\npip install -r requirements.txt\npython example.py --verbose\n```\n\n```unknown-language\nUnknown language: <tag> & text\n```\n\n    Indented plain code\n\n```\nUnspecified language\n```',
        '/tmp/theme.md',
        codeTheme,
      );
      const page = await browser.newPage({
        viewport: { width: 850, height: 650 },
      });
      await page.emulateMedia({ media: 'print' });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://theme.invalid') return route.abort();
        if (url.pathname === '/')
          return route.fulfill({
            contentType: 'text/html',
            body: `<meta charset="utf-8"><link rel="stylesheet" href="/assets/print.css"><body style="padding:24px" data-code-theme="${result.codeTheme}">${result.html}</body>`,
          });
        try {
          await route.fulfill({
            body: await readFile(
              path.join(process.cwd(), 'dist', url.pathname),
            ),
            contentType: url.pathname.endsWith('.css')
              ? 'text/css'
              : 'font/woff2',
          });
        } catch {
          await route.abort();
        }
      });
      await page.goto('https://theme.invalid/');
      await page.evaluate(() => document.fonts.ready);
      const colors = await page.locator('pre').evaluateAll((elements) =>
        elements.map((el) => ({
          background: getComputedStyle(el).backgroundColor,
          color: getComputedStyle(el).color,
        })),
      );
      assert.equal(colors.length, 4);
      const inline = await page.locator('p code').evaluate((el) => ({
        color: getComputedStyle(el).color,
        background: getComputedStyle(el).backgroundColor,
      }));
      assert.deepEqual(inline, {
        color: 'rgb(23, 43, 77)',
        background: 'rgb(241, 243, 245)',
      });
      const plain = await page
        .locator('pre code')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
      const expected =
        codeTheme === 'one-light'
          ? { background: 'rgb(250, 250, 250)', color: 'rgb(56, 58, 66)' }
          : { background: 'rgb(36, 41, 46)', color: 'rgb(225, 228, 232)' };
      for (const color of colors) assert.deepEqual(color, expected);
      for (const color of plain) assert.equal(color, expected.color);
      assert.equal(
        await page
          .locator('body')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(255, 255, 255)',
      );
      await page.screenshot({
        path: `output/themes/actual-${codeTheme}.png`,
        fullPage: true,
      });
      console.log(
        codeTheme,
        'highlighted, unknown, indented and plain code colors passed',
      );
      await page.close();
    }
    assert.equal(resolveCodeTheme('invalid'), 'one-light');
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
