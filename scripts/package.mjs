import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const icon = readFileSync(resolve(manifest.icon));
if (
  icon.length < 24 ||
  icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
  icon.toString('ascii', 12, 16) !== 'IHDR'
) {
  throw new Error('The extension icon must be a PNG with a valid IHDR header.');
}
const iconWidth = icon.readUInt32BE(16);
const iconHeight = icon.readUInt32BE(20);
if (!iconWidth || !iconHeight || iconWidth > 1024 || iconHeight > 1024) {
  throw new Error(
    `Extension icon is ${iconWidth} × ${iconHeight}; Marketplace allows at most 1024 × 1024 pixels.`,
  );
}
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
    '--githubBranch',
    'main',
    '--target',
    target,
    '--out',
    `markdown-to-pdf-${target}.vsix`,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
