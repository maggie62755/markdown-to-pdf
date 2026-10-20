import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { abortable, ExportCancelled, savePdf } from '../src/pdf';
import { defaultLayout, resolveLayout, layoutCss, footer } from '../src/layout';

test('layout rejects malformed config and CSS injection while keeping valid overrides', () => {
  const values: Record<string, unknown> = {
    paperSize: 'Letter',
    orientation: 'landscape',
    fontSize: NaN,
    marginTop: -1,
    marginBottom: 41,
    pageNumbers: false,
    inlineCodeColor: '#123abc',
    inlineCodeBackground: 'red;}</style><script>',
    pageNumberStyle: 'current',
  };
  const layout = resolveLayout((key) => values[key]);
  assert.equal(layout.paperSize, 'Letter');
  assert.equal(layout.orientation, 'landscape');
  assert.equal(layout.fontSize, 11);
  assert.equal(layout.marginTop, 22);
  assert.equal(layout.marginBottom, 24);
  assert.equal(layout.pageNumbers, false);
  assert.equal(layout.inlineCodeColor, '#123abc');
  assert.equal(layout.inlineCodeBackground, defaultLayout.inlineCodeBackground);
  assert.ok(!layoutCss(layout).includes('<script>'));
  assert.ok(!footer(layout).includes('totalPages'));
  assert.match(footer(defaultLayout), /totalPages/);
});
test('cancelled asynchronous startup disposes a late resource without waiting for startup', async () => {
  let finish!: (value: string) => void;
  const promise = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const controller = new AbortController();
  const disposed: string[] = [];
  const result = abortable(promise, controller.signal, (value) => {
    disposed.push(value);
  });
  controller.abort();
  await assert.rejects(result, ExportCancelled);
  finish('browser');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disposed, ['browser']);
});
test('atomic save replaces exact bytes and cancellation preserves existing file without temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'markdown-pdf-test-'));
  try {
    const output = path.join(dir, 'existing.pdf');
    await writeFile(output, 'original');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      savePdf(Buffer.from('new'), output, controller.signal),
      ExportCancelled,
    );
    assert.equal(await readFile(output, 'utf8'), 'original');
    await savePdf(Buffer.from('%PDF exact preview bytes'), output);
    assert.equal(await readFile(output, 'utf8'), '%PDF exact preview bytes');
    assert.deepEqual(await readdir(dir), ['existing.pdf']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
