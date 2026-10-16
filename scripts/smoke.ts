import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { exportPdf } from '../src/pdf';
async function main() {
  const root = process.cwd();
  await mkdir(path.join(root, 'output/pdf'), { recursive: true });
  const filename = path.join(root, 'fixtures/完整範例.md');
  await exportPdf({
    source: await readFile(filename, 'utf8'),
    filename,
    output: path.join(root, 'output/pdf/完整範例.pdf'),
    root,
    onIssues: async (issues) => {
      if (issues.length) throw new Error(JSON.stringify(issues));
      return true;
    },
    progress: console.log,
  });
  const errors = path.join(root, 'fixtures/錯誤範例.md');
  await exportPdf({
    source: await readFile(errors, 'utf8'),
    filename: errors,
    output: path.join(root, 'output/pdf/錯誤範例.pdf'),
    root,
    onIssues: async (issues) => {
      console.log('Expected issues:', issues.length);
      if (issues.length !== 4) throw new Error('Expected four issues');
      return true;
    },
  });
  const alerts = path.join(root, 'fixtures/提示區塊.md');
  await exportPdf({
    source: await readFile(alerts, 'utf8'),
    filename: alerts,
    output: path.join(root, 'output/pdf/提示區塊.pdf'),
    root,
    onIssues: async (issues) => {
      if (issues.length) throw new Error(JSON.stringify(issues));
      return true;
    },
  });
  const preserve = path.join(root, '.vendor/preserve.pdf');
  await writeFile(preserve, 'existing PDF');
  try {
    await exportPdf({
      source: '# Preview cancel test',
      filename,
      output: preserve,
      root,
      onIssues: async () => true,
      onPreview: async (pdf) => {
        if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF')))
          throw new Error('Invalid preview bytes');
        if ((await readFile(preserve, 'utf8')) !== 'existing PDF')
          throw new Error('Overwritten before preview');
        return false;
      },
    });
    throw new Error('Cancellation should reject');
  } catch (e) {
    if (!String(e).includes('Export cancelled')) throw e;
  }
  if ((await readFile(preserve, 'utf8')) !== 'existing PDF')
    throw new Error('Existing PDF changed');
  await unlink(preserve);
  console.log(
    'PDF smoke test passed; preview cancellation preserves existing file',
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
