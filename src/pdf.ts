import {
  defaultLayout,
  layoutCss,
  footer,
  contentSize,
  type Layout,
} from './layout';
import type { CodeTheme } from './themes';
import path from 'node:path';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { renderMarkdown, type Issue } from './markdown';
export interface ExportOptions {
  source: string;
  layout?: Layout;
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
  checkCancelled(signal);
  const layout = options.layout ?? defaultLayout;
  options.progress?.('Parsing Markdown and highlighting code');
  const rendered = await abortable(
    renderMarkdown(source, filename, options.codeTheme, signal),
    signal,
  );
  checkCancelled(signal);
  options.progress?.('Starting local Chromium');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'dist/browsers');
  const require = createRequire(path.join(root, 'dist/extension.cjs'));
  const { chromium } =
    require('./playwright/index.js') as typeof import('playwright-core');
  const launch = chromium
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
  // A cancelled launch is closed as soon as it completes, even if the caller has returned.
  const browser = await abortable(launch, signal, (browser) => {
    void browser.close();
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
  try {
    checkCancelled(signal);
    const context = await browser.newContext({
      viewport: {
        width: Math.ceil((contentSize(layout).width * 96) / 25.4),
        height: Math.ceil((contentSize(layout).height * 96) / 25.4),
      },
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
          body: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="/assets/print.css"><style>${layoutCss(layout)}</style></head><body data-code-theme="${rendered.codeTheme}">${rendered.html}</body></html>`,
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
    await page.emulateMedia({ media: 'print' });
    await page.goto(`${origin}/document`);
    options.progress?.('Rendering math, images and Mermaid diagrams');
    const runtimeIssues: Issue[] = await page.evaluate(async () => {
      const url = '/assets/render.mjs';
      return (await import(url)).render();
    });
    const issues = [...rendered.issues, ...runtimeIssues];
    clearTimeout(timer); // User decision time does not consume rendering timeout.
    if (issues.length && !(await options.onIssues(issues)))
      throw new ExportCancelled();
    checkCancelled(signal);
    options.progress?.('Generating PDF');
    const printTimer = setTimeout(() => {
      expired = true;
      cancel();
    }, 30000);
    let pdf: Buffer;
    try {
      pdf = await page.pdf({
        format: layout.paperSize,
        landscape: layout.orientation === 'landscape',
        printBackground: true,
        margin: {
          top: `${layout.marginTop}mm`,
          bottom: `${layout.marginBottom}mm`,
          left: `${layout.marginLeft}mm`,
          right: `${layout.marginRight}mm`,
        },
        displayHeaderFooter: layout.pageNumbers,
        headerTemplate: '<span></span>',
        footerTemplate: footer(layout),
      });
    } finally {
      clearTimeout(printTimer);
    }
    checkCancelled(signal);
    await browser.close();
    if (options.onPreview && !(await options.onPreview(pdf)))
      throw new ExportCancelled();
    checkCancelled(signal);
    const output =
      typeof options.output === 'function'
        ? await options.output()
        : options.output;
    checkCancelled(signal);
    if (!output) return { issues, output: undefined };
    await savePdf(pdf, output, signal);
    return { issues, output };
  } catch (e) {
    if (signal?.aborted) throw new ExportCancelled();
    if (expired) throw new Error('PDF rendering timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await browser.close();
  }
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}
export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new ExportCancelled();
}
export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const abort = () => {
      cancelled = true;
      reject(new ExportCancelled());
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    promise
      .then((value) => {
        if (cancelled) late?.(value);
        else resolve(value);
      }, reject)
      .finally(() => signal?.removeEventListener('abort', abort));
  });
}
export async function savePdf(
  pdf: Buffer,
  output: string,
  signal?: AbortSignal,
) {
  checkCancelled(signal);
  const temp = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temp, pdf, { flag: 'wx' });
    checkCancelled(signal);
    await rename(temp, output);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
