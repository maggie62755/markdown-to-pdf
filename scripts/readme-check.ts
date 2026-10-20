import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { exportPdf } from '../src/pdf';
async function main() {
  await mkdir('output/pdf', { recursive: true });
  for (const name of ['README.md', 'README.zh-TW.md']) {
    const filename = path.resolve(name);
    await exportPdf({
      source: await readFile(filename, 'utf8'),
      filename,
      root: process.cwd(),
      output: path.resolve('output/pdf', name.replace(/\.md$/, '.pdf')),
      onIssues: async (issues) => {
        throw new Error(`${name}: ${JSON.stringify(issues)}`);
      },
    });
    console.log(
      `${name}: offline PDF rendered without image or content issues`,
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
