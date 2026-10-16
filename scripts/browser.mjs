import { spawnSync } from 'node:child_process';
import path from 'node:path';
const result = spawnSync(
  process.execPath,
  [
    'node_modules/playwright-core/cli.js',
    'install',
    'chromium',
    '--only-shell',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: path.resolve('.vendor/browsers'),
    },
  },
);
process.exit(result.status ?? 1);
