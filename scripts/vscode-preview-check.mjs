import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const screenshots = process.env.CAPTURE_SCREENSHOTS === '1';
if (screenshots) await mkdir('docs/images', { recursive: true });
const profile = path.resolve(
  screenshots
    ? `.vendor/vscode-screenshot-profile-${process.pid}`
    : '.vendor/vscode-test-profile',
);
await mkdir(path.join(profile, 'User'), { recursive: true });
await writeFile(
  path.join(profile, 'User/settings.json'),
  JSON.stringify({
    'workbench.colorTheme': 'Quiet Light',
    'breadcrumbs.enabled': false,
    'editor.minimap.enabled': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'chat.disableAIFeatures': true,
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none',
    'window.menuStyle': 'custom',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'telemetry.telemetryLevel': 'off',
  }),
);
const app = await electron.launch({
  executablePath:
    process.env.VSCODE_EXECUTABLE ||
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  args: [
    '--user-data-dir',
    profile,
    '--extensions-dir',
    path.resolve('.vendor/vscode-test-extensions'),
    '--extensionDevelopmentPath=' + process.cwd(),
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--new-window',
    path.resolve(
      screenshots ? 'fixtures/quick-start.md' : 'fixtures/完整範例.md',
    ),
  ],
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      !msg.text().includes('proposals') &&
      !msg.text().includes('product.json')
    )
      console.log('CONSOLE', msg.text());
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.waitForTimeout(3000);
  async function command(label) {
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P',
    );
    await page.locator('.quick-input-widget input').fill('>' + label);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  if (await page.locator('.part.auxiliarybar').isVisible()) {
    await command('View: Toggle Secondary Side Bar Visibility');
  }
  if (screenshots) await command('Notifications: Toggle Do Not Disturb Mode');

  page.on('request', (r) => {
    if (r.url().includes('pdf.')) console.log('REQUEST', r.url());
  });
  page.on('requestfinished', (r) => {
    if (r.url().includes('pdf.')) console.log('FINISH', r.url(), r.timing());
  });
  page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()));
  const started = performance.now();
  await page
    .locator('.monaco-editor .view-lines')
    .first()
    .click({ button: 'right', position: { x: 80, y: 40 } });
  console.log(
    'Context menu:',
    await page.locator('.context-view .action-label').allInnerTexts(),
  );
  if (screenshots)
    await page.screenshot({ path: 'docs/images/context-menu.png' });
  await page
    .getByText('Markdown: Export to PDF', { exact: true })
    .click({ timeout: 5000 });
  let ready = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    const state = await Promise.all(
      page.frames().map(async (frame) => ({
        url: frame.url(),
        text:
          (await frame
            .locator('body')
            .innerText({ timeout: 1000 })
            .catch(() => '')) +
          (await frame
            .locator('#status')
            .textContent({ timeout: 100 })
            .catch(() => '')),
      })),
    );
    const preview = state.find(
      (s) =>
        s.text.includes('Fit width') &&
        (s.text.includes('Loading pages') ||
          s.text.includes(' rendered') ||
          s.text.includes('Preview failed')),
    );
    if (i % 15 === 0) {
      const frame = page.frames().find((f) => f.url().includes('/fake.html'));
      console.log(
        JSON.stringify({
          ms: Math.round(performance.now() - started),
          preview: preview?.text,
          resources: frame
            ? await frame.evaluate(() =>
                performance.getEntriesByType('resource').map((e) => ({
                  name: e.name,
                  start: e.startTime,
                  duration: e.duration,
                  responseEnd: e.responseEnd,
                })),
              )
            : [],
        }),
      );
    }
    if (
      preview?.text.includes(' rendered') ||
      preview?.text.includes('Preview failed')
    ) {
      if (preview.text.includes('Preview failed'))
        throw new Error(preview.text);
      ready = true;
      const f = page.frames().find((f) => f.url().includes('/fake.html'));
      console.log(
        'Preview ready:',
        JSON.stringify({
          commandToPageMs: Math.round(performance.now() - started),
          webviewAgeMs: Math.round(await f.evaluate(() => performance.now())),
        }),
      );
      break;
    }
  }
  if (!ready) throw new Error('Preview did not become ready within 45 seconds');
  await page.screenshot({
    path: screenshots
      ? 'docs/images/pdf-preview.png'
      : '.vendor/vscode-preview.png',
  });
  if (screenshots) {
    const frame = page.frames().find((f) => f.url().includes('/fake.html'));
    const second = frame.locator('main section').nth(1);
    await second.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'docs/images/pdf-features.png' });
  }
  if (!screenshots) {
    const previewFrame = page
      .frames()
      .find((f) => f.url().includes('/fake.html'));
    await previewFrame.locator('#settings').click();
    let settingsFrame;
    for (let attempt = 0; attempt < 30; attempt++) {
      settingsFrame = page
        .frames()
        .find(
          (frame) =>
            frame !== previewFrame && frame.url().includes('/fake.html'),
        );
      if (
        settingsFrame &&
        (await settingsFrame.locator('#inlineCodeColor').count())
      )
        break;
      await page.waitForTimeout(200);
    }
    if (!settingsFrame) throw new Error('PDF Settings panel did not open');
    await settingsFrame.locator('#inlineCodeColor').waitFor();
    if ((await settingsFrame.locator('.default').count()) !== 12)
      throw new Error('Missing default labels');
    if ((await settingsFrame.locator('input[type=color]').count()) !== 2)
      throw new Error('Missing color pickers');
    await settingsFrame.locator('#inlineCodeColor').fill('#cc2244');
    await settingsFrame.locator('#inlineCodeColor').press('Tab');
    await settingsFrame.waitForFunction(
      () =>
        document.getElementById('sample').style.color === 'rgb(204, 34, 68)',
    );
    const readSettings = async () =>
      JSON.parse(
        await readFile(path.join(profile, 'User/settings.json'), 'utf8'),
      );
    await page.waitForTimeout(700);
    if (
      (await readSettings())['localMarkdownPdf.inlineCodeColor'] !== undefined
    )
      throw new Error('Editing applied before Save');
    await settingsFrame.locator('#save').click();
    await settingsFrame.waitForFunction(() =>
      document.getElementById('notice').textContent.startsWith('Saved.'),
    );
    if (
      (await readSettings())['localMarkdownPdf.inlineCodeColor'] !== '#cc2244'
    )
      throw new Error('Save did not apply color');
    await settingsFrame.locator('[data-reset="inlineCodeColor"]').click();
    await settingsFrame.waitForFunction(
      () => document.getElementById('inlineCodeColor').value === '#172b4d',
    );
    if (
      (await readSettings())['localMarkdownPdf.inlineCodeColor'] !== '#cc2244'
    )
      throw new Error('Reset applied before Save');
    await settingsFrame.locator('#discard').click();
    await settingsFrame.waitForFunction(
      () => document.getElementById('inlineCodeColor').value === '#cc2244',
    );
    await settingsFrame.locator('#fontSize').fill('18');
    await settingsFrame.locator('#fontSize').press('Tab');
    await settingsFrame.locator('#reset-all').click();
    await settingsFrame.waitForFunction(
      () => document.getElementById('fontSize').value === '11',
    );
    if (
      (await readSettings())['localMarkdownPdf.inlineCodeColor'] !== '#cc2244'
    )
      throw new Error('Reset-all applied before Save');
    await settingsFrame.locator('#save').click();
    await settingsFrame.waitForFunction(() =>
      document.getElementById('notice').textContent.startsWith('Saved.'),
    );
    if (
      (await readSettings())['localMarkdownPdf.inlineCodeColor'] !== '#172b4d'
    )
      throw new Error('Save did not apply reset');
    console.log(
      'Draft edits and resets do not write settings; Save applies and Discard restores saved values',
    );
    await page.screenshot({ path: '.vendor/settings-check.png' });
    await settingsFrame.locator('#native').click();
    await page
      .locator('.settings-count-widget')
      .filter({ hasText: '12 Settings Found' })
      .waitFor({ timeout: 15000 });
  }
  const logs = await app.evaluate(() => process.versions);
  console.log('Electron versions', logs);
} catch (e) {
  const page = await app.firstWindow();
  console.log('UI failure state:', await page.locator('body').innerText());
  await page.screenshot({ path: '.vendor/vscode-context-failure.png' });
  throw e;
} finally {
  await app
    .firstWindow()
    .then((p) => p.keyboard.press('Escape'))
    .catch(() => {});
  await app.close();
}
