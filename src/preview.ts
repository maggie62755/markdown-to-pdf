import { openPdfSettings } from './settings';
import * as vscode from 'vscode';
import type { Issue } from './markdown';
import { randomBytes } from 'node:crypto';
export function createPreview(
  context: vscode.ExtensionContext,
  signal: AbortSignal,
  confirm: (revision: number) => void,
  showIssues?: () => void,
  sourceUri?: vscode.Uri,
) {
  const base = vscode.Uri.joinPath(context.extensionUri, 'dist/assets/pdfjs');
  const panel = vscode.window.createWebviewPanel(
    'localMarkdownPdf.preview',
    'PDF Preview',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [base],
    },
  );
  const resource = (file: string) =>
    panel.webview.asWebviewUri(vscode.Uri.joinPath(base, file)).toString();
  const nonce = randomBytes(18).toString('hex');
  let disposed = false;
  let ready = false;
  let latest: object = { type: 'busy', message: 'Generating preview…' };
  let close!: () => void;
  const closed = new Promise<void>((resolve) => {
    close = resolve;
  });
  const send = (message: object) => {
    latest = message;
    if (ready && !disposed) void panel.webview.postMessage(message);
  };
  const abort = () => panel.dispose();
  const messages = panel.webview.onDidReceiveMessage((value) => {
    if (value?.type === 'ready') {
      ready = true;
      void panel.webview.postMessage(latest);
    } else if (value?.type === 'confirm' && Number.isInteger(value.revision))
      confirm(value.revision);
    else if (value?.type === 'issues') showIssues?.();
    else if (value?.type === 'settings') {
      openPdfSettings(context, sourceUri);
    } else if (value?.type === 'cancel') panel.dispose();
  });
  const disposal = panel.onDidDispose(() => {
    disposed = true;
    latest = {};
    signal.removeEventListener('abort', abort);
    messages.dispose();
    disposal.dispose();
    close();
  });
  panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; worker-src blob:; style-src 'unsafe-inline' ${panel.webview.cspSource}; img-src data: blob:; font-src ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource};"><link rel="stylesheet" href="${resource('pdf_viewer.css')}"><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;display:flex;flex-direction:column;background:var(--vscode-editor-background,#eceef1);color:var(--vscode-foreground,#343941);font:12px var(--vscode-font-family,system-ui)}header{flex-shrink:0;position:sticky;top:6px;left:8px;width:max-content;max-width:calc(100vw - 16px);min-height:36px;margin:6px auto;padding:4px 8px;border-radius:8px;box-shadow:0 1px 5px #0001;background:var(--vscode-sideBar-background,#f8f9fb);border:1px solid var(--vscode-panel-border,#dde1e7);z-index:10;display:flex;gap:6px;align-items:center;white-space:nowrap}button,input,select,summary{font:inherit;color:inherit;border:1px solid transparent;border-radius:5px;height:26px;background:transparent}button,summary{cursor:pointer}button:hover,summary:hover{background:var(--vscode-toolbar-hoverBackground,#e5e8ee)}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder,#3978c6);outline-offset:1px}.icon{width:26px;padding:4px;display:inline-flex;align-items:center;justify-content:center}.icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}#confirm{background:var(--vscode-button-background,#2769ad);color:var(--vscode-button-foreground,#fff);padding:0 12px;font-weight:500}#confirm:hover{background:var(--vscode-button-hoverBackground,#205b98)}#page{width:34px;text-align:center;appearance:textfield;background:var(--vscode-input-background,#fff);border-color:var(--vscode-input-border,#d9dee6)}#page::-webkit-inner-spin-button{appearance:none}#total{color:var(--vscode-descriptionForeground,#717986);min-width:22px}#zoom{width:85px;padding:0 4px;color-scheme:normal;background:var(--vscode-dropdown-background,#f8f9fb);color:var(--vscode-dropdown-foreground,#343941)}.divider{height:16px;border-left:1px solid var(--vscode-panel-border,#dde1e7);margin:0 2px}details>summary{list-style:none}summary::-webkit-details-marker{display:none}.popover{position:absolute;top:44px;right:8px;width:min(300px,calc(100vw - 16px));padding:12px;background:var(--vscode-editorWidget-background,#fff);border:1px solid var(--vscode-widget-border,#d9dee6);border-radius:8px;box-shadow:0 6px 24px #0002;white-space:normal}.search-row{display:flex;gap:6px}#search{width:100%;min-width:0;background:var(--vscode-input-background,#f4f6f9);border-color:var(--vscode-input-border,#d9dee6);padding:0 8px}#find{flex:none;border-color:var(--vscode-panel-border,#dde1e7)}#find-status{display:block;font-size:11px;margin-top:8px;color:var(--vscode-descriptionForeground,#717986)}#cancel{width:100%;text-align:left;margin-top:10px;border-top:1px solid var(--vscode-panel-border,#dde1e7);border-radius:0;padding-top:8px;height:34px}#status{display:block;margin-top:8px;font-size:11px;overflow-wrap:anywhere;color:var(--vscode-descriptionForeground,#717986)}#activity,#issues{flex:none}#issues{color:var(--vscode-editorWarning-foreground,#986900);padding:0 5px}#activity{width:20px;color:var(--vscode-descriptionForeground,#717986)}[hidden]{display:none!important}body[data-state=ready] #activity{display:none}body[data-state=error] #activity{color:var(--vscode-errorForeground,#bd4444)}@media(max-width:420px){#previous,#next{display:none}}main{padding:10px;flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}section{position:relative;margin:0 auto 12px;background:white;box-shadow:0 1px 5px #0002;scroll-margin-top:10px}canvas{position:absolute;inset:0;width:100%;height:100%}.textLayer{z-index:1}.textLayer .match{background:#ffda66;color:transparent}@media(max-width:360px){header{padding:4px;gap:3px}.divider{display:none}#confirm{padding:0 8px}#zoom{width:76px}}
  </style></head><body><header aria-label="PDF preview tools">
  <button id="previous" class="icon" aria-label="Previous page" title="Previous page">‹</button><input id="page" aria-label="Page number" type="number" min="1" value="1"><span id="total"></span><button id="next" class="icon" aria-label="Next page" title="Next page">›</button><span class="divider"></span>
  <select id="zoom" aria-label="Zoom" title="Zoom"><option value="fit">Fit width</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select>
  <button id="activity" title="Preview status" aria-label="Preview status">…</button><button id="issues" hidden title="Show document issues" aria-label="Show document issues"></button><button id="confirm" disabled title="Save the previewed PDF">Export</button>
  <button id="settings" class="icon" aria-label="PDF layout settings" title="Paper, margins, fonts and colors"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/></svg></button>
  <details id="more"><summary class="icon" aria-label="Search and more" title="Search and more"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></summary><div class="popover"><div class="search-row"><input id="search" type="search" aria-label="Search PDF" placeholder="Search PDF"><button id="find">Find next</button></div><span id="find-status" role="status"></span><span id="status" role="status">Loading preview engine…</span><button id="cancel">Close preview</button></div></details>
  </header><main id="pages"></main>
  <script type="module" nonce="${nonce}">import {start} from ${JSON.stringify(resource('viewer.mjs'))};start(${JSON.stringify(resource('').replace(/\/?$/, '/'))});</script></body></html>`;
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return {
    closed,
    dispose: abort,
    update: (pdf: Buffer, revision: number, issues: Issue[] = []) =>
      send({
        type: 'pdf',
        data: pdf.toString('base64'),
        revision,
        issues: issues.length,
      }),
    busy: (message = 'Document changed — updating preview…') =>
      send({ type: 'busy', message }),
    error: (message: string) => send({ type: 'error', message }),
  };
}
/** Compatibility helper for one-shot previews and smoke tests. */
export async function confirmPdf(
  context: vscode.ExtensionContext,
  pdf: Buffer,
  signal: AbortSignal,
): Promise<boolean> {
  let confirmed = false;
  const preview = createPreview(context, signal, () => {
    confirmed = true;
    preview.dispose();
  });
  preview.update(pdf, 1);
  await preview.closed;
  return confirmed;
}
