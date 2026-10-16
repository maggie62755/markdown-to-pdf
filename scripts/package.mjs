import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('dist/browsers');
const { chromium } = await import('../dist/playwright/index.mjs');
// Launch the bundled headless browser to verify the native binary and OS libraries.
try {
  const browser = await chromium.launch({ headless: true, timeout: 30000 });
  await browser.close();
} catch (error) {
  throw new Error(
    'Bundled Chromium cannot run on this machine. Run npm run prepare:browser and rebuild; Ubuntu also needs Chromium system libraries.',
    { cause: error },
  );
}
const target = `${process.platform}-${process.arch}`;
if (!['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(target))
  throw new Error(`Unsupported target: ${target}`);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@vscode/vsce/vsce',
    'package',
    '--no-dependencies',
    '--no-rewrite-relative-links',
    '--allow-missing-repository',
    '--target',
    target,
    '--out',
    `local-markdown-pdf-${target}.vsix`,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
