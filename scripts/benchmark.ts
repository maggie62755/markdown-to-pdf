import { exportPdf } from '../src/pdf';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
async function main() {
  const label = process.argv[2] || 'current';
  const results = [];
  const sources = [
    [
      'simple',
      '# 技術筆記\n\n中文 English text.\n\n```bash\nconda create --name document_demo python=3.11.14\npip install -r requirements.txt\npython example.py --verbose\n```',
    ],
    ['full', await readFile('fixtures/完整範例.md', 'utf8')],
  ];
  for (const [name, source] of sources)
    for (let run = 1; run <= 3; run++) {
      const started = performance.now();
      const stages: Record<string, number> = {};
      await exportPdf({
        source,
        filename: path.resolve('fixtures/完整範例.md'),
        root: process.cwd(),
        output: async () => undefined,
        onIssues: async () => true,
        progress: (message) => {
          stages[message] = Math.round(performance.now() - started);
        },
        onPreview: async () => {
          stages.previewReady = Math.round(performance.now() - started);
          return true;
        },
      });
      results.push({ name, run, ...stages });
    }
  console.log(JSON.stringify({ label, results }, null, 2));
  await writeFile(
    `.vendor/benchmark-${label}.json`,
    JSON.stringify(results, null, 2),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
