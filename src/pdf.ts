import type { CodeTheme } from './themes';
import path from 'node:path';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { renderMarkdown, type Issue } from './markdown';
export interface ExportOptions {
  source: string;
  codeTheme?: CodeTheme;
  filename: string;
  output: string | (() => Promise<string | undefined>);
  root: string;
  signal?: AbortSignal;
  onIssues: (issues: Issue[]) => Promise<boolean>;
  onPreview?: (pdf: Buffer) => Promise<boolean>;
  progress?: (message: string) => void;
  timeout?: number;
}
export async function exportPdf(options: ExportOptions) {
  const { source, filename, root, signal } = options;
  signal?.throwIfAborted();
  options.progress?.('Parsing Markdown and highlighting code');
  const rendered = await renderMarkdown(source, filename, options.codeTheme);
  options.progress?.('Starting local Chromium');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'dist/browsers');
  const require = createRequire(path.join(root, 'dist/extension.cjs'));
  const { chromium } =
    require('./playwright/index.js') as typeof import('playwright-core');
  const browser = await chromium
    .launch({ headless: true, timeout: 30000 })
    .catch((error: Error) => {
      const hint =
        process.platform === 'linux'
          ? ' Ensure Chromium system libraries are installed (see the Ubuntu installation notes).'
          : '';
      throw new Error(
        `Bundled Chromium could not start. Install the VSIX matching your OS and architecture.${hint} ${error.message}`,
      );
    });
  options.progress?.('Loading local fonts and document');
  let expired = false;
  const cancel = () => {
    void browser.close();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    cancel();
  }, options.timeout ?? 120000);
  let temp: string | undefined;
  try {
    signal?.throwIfAborted();
    const context = await browser.newContext({
      offline: true,
      serviceWorkers: 'block',
    });
    const origin = 'https://markdown-pdf.invalid';
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/document')
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="/assets/print.css"></head><body data-code-theme="${rendered.codeTheme}">${rendered.html}</body></html>`,
        });
      const resource = rendered.resources.get(url.pathname);
      if (resource)
        return route.fulfill({
          body: resource.body,
          contentType: resource.type,
        });
      if (!url.pathname.startsWith('/assets/')) return route.abort();
      const asset = path.resolve(
        root,
        'dist',
        `.${decodeURIComponent(url.pathname)}`,
      );
      const base = path.resolve(root, 'dist/assets') + path.sep;
      if (!asset.startsWith(base)) return route.abort();
      try {
        const types: Record<string, string> = {
          '.css': 'text/css',
          '.js': 'text/javascript',
          '.mjs': 'text/javascript',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
          '.ttf': 'font/ttf',
        };
        await route.fulfill({
          body: await readFile(asset),
          contentType: types[path.extname(asset)] || 'application/octet-stream',
        });
      } catch {
        await route.abort();
      }
    });
    const page = await context.newPage();
    await page.goto(`${origin}/document`);
    options.progress?.('Rendering math, images and Mermaid diagrams');
    const runtimeIssues: Issue[] = await page.evaluate(async () => {
      const url = '/assets/render.mjs';
      return (await import(url)).render();
    });
    const issues = [...rendered.issues, ...runtimeIssues];
    clearTimeout(timer); // User decision time does not consume rendering timeout.
    if (issues.length && !(await options.onIssues(issues)))
      throw new Error('Export cancelled. Fix the document and try again.');
    signal?.throwIfAborted();
    options.progress?.('Generating PDF');
    const printTimer = setTimeout(cancel, 30000);
    let pdf: Buffer;
    try {
      pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '22mm', bottom: '24mm', left: '18mm', right: '18mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;text-align:center;font-size:9px;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    } finally {
      clearTimeout(printTimer);
    }
    signal?.throwIfAborted();
    await browser.close();
    if (options.onPreview && !(await options.onPreview(pdf)))
      throw new Error('Export cancelled');
    signal?.throwIfAborted();
    const output =
      typeof options.output === 'function'
        ? await options.output()
        : options.output;
    signal?.throwIfAborted();
    if (!output) return { issues, output: undefined };
    temp = path.join(
      path.dirname(output),
      `.${path.basename(output)}.${randomUUID()}.tmp`,
    );
    await writeFile(temp, pdf, { flag: 'wx' });
    signal?.throwIfAborted();
    // Same-directory rename: a failed render never truncates an existing PDF.
    await rename(temp, output);
    return { issues, output };
  } catch (e) {
    if (signal?.aborted) throw new Error('Export cancelled');
    if (expired) throw new Error('PDF rendering timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await browser.close();
    if (temp) await unlink(temp).catch(() => {});
  }
}
