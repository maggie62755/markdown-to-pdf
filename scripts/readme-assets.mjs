import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('dist/browsers');
const { chromium } = await import('../dist/playwright/index.mjs');
await mkdir('docs/images/badges', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(
    `<style>body{margin:0}div{display:inline-flex;overflow:hidden;border-radius:4px;font:12px/24px Arial,sans-serif;color:white}span{padding:0 8px;background:#424b58}.value{background:var(--color)}</style>`,
  );
  for (const [file, label, value, color] of [
    ['vscode', 'VS Code', 'Extension', '#007acc'],
    ['local', 'Rendering', 'Local', '#276749'],
    ['license', 'License', 'MIT', '#2463a5'],
  ]) {
    await page.evaluate(
      ({ label, value, color }) => {
        document.querySelector('div')?.remove();
        const badge = document.createElement('div');
        badge.style.setProperty('--color', color);
        for (const [text, cls] of [
          [label, ''],
          [value, 'value'],
        ]) {
          const span = document.createElement('span');
          span.textContent = text;
          span.className = cls;
          badge.append(span);
        }
        document.body.append(badge);
      },
      { label, value, color },
    );
    await page.locator('div').screenshot({
      path: `docs/images/badges/${file}.png`,
      omitBackground: true,
    });
  }
  const icon = await readFile('assets/icon.png');
  await page.setContent(
    `<style>body{margin:0}img{width:96px;height:96px}</style><img src="data:image/png;base64,${icon.toString('base64')}">`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  await page
    .locator('img')
    .screenshot({ path: 'docs/images/logo.png', omitBackground: true });
} finally {
  await browser.close();
}
