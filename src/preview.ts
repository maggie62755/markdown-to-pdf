import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
/** Preview the exact bytes to be committed, never a second rendering. */
export function confirmPdf(
  context: vscode.ExtensionContext,
  pdf: Buffer,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const base = vscode.Uri.joinPath(context.extensionUri, 'dist/assets/pdfjs');
  const panel = vscode.window.createWebviewPanel(
    'localMarkdownPdf.preview',
    'PDF Preview — Confirm to Export',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [base],
    },
  );
  const webview = panel.webview;
  const resource = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(base, file)).toString();
  const nonce = randomBytes(18).toString('hex');
  webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src ${webview.cspSource} blob:; style-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; connect-src ${webview.cspSource};"><style nonce="${nonce}">
 body{margin:0;background:#ddd;color:#222;font-family:system-ui}header{position:sticky;top:0;padding:12px 16px;background:#fff;border-bottom:1px solid #bbb;z-index:1;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button{padding:8px 14px;cursor:pointer;border:1px solid #999;border-radius:4px}#confirm{background:#1769aa;color:white}button:disabled{opacity:.5;cursor:wait}main{padding:16px}section{margin:0 auto 20px;max-width:850px}canvas{display:block;width:100%;height:auto;background:white;box-shadow:0 2px 8px #aaa}p{font-size:12px;text-align:center}
 </style></head><body><header><strong>PDF Preview</strong><span id="status">Loading pages…</span><button id="confirm" disabled>Confirm and Export</button><button id="cancel">Cancel</button></header><main id="pages"></main><script type="module" nonce="${nonce}">
 const vscode=acquireVsCodeApi();
 document.getElementById('confirm').onclick=()=>{document.getElementById('confirm').disabled=true;vscode.postMessage({type:'confirm'});};
 document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});
 let worker;let workerUrl;let loadingTask;let failed=false;
 const cleanup=()=>{worker?.terminate();if(workerUrl)URL.revokeObjectURL(workerUrl);};
 const fail=message=>{failed=true;document.getElementById('status').textContent='Preview failed: '+message;document.getElementById('confirm').disabled=true;cleanup();};
 window.addEventListener('pagehide',cleanup,{once:true});
 const timeout=setTimeout(()=>{void loadingTask?.destroy();fail('Loading timed out after 20 seconds. Cancel and try again.');},20000);
 try {
 document.getElementById('status').textContent='Loading the preview engine…';
 const [{getDocument,GlobalWorkerOptions},response]=await Promise.all([
  import(${JSON.stringify(resource('pdf.mjs'))}),
  fetch(${JSON.stringify(resource('pdf.worker.mjs'))})
 ]);
 if(!response.ok)throw new Error('Could not load the PDF worker ('+response.status+')');
 // VS Code workers cannot import extension resources. Fetch the single-file worker in
 // the document and start it directly from a blob, bypassing PDF.js's import wrapper.
 const workerSource=await response.text();if(failed)throw new Error('Preview loading timed out');
 workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
 worker=new Worker(workerUrl,{type:'module'});GlobalWorkerOptions.workerPort=worker;
 document.getElementById('status').textContent='Reading PDF…';
 const raw=atob(${JSON.stringify(pdf.toString('base64'))});const data=Uint8Array.from(raw,c=>c.charCodeAt(0));
 loadingTask=getDocument({data,isEvalSupported:false,cMapUrl:${JSON.stringify(resource('cmaps/'))},cMapPacked:true,standardFontDataUrl:${JSON.stringify(resource('standard_fonts/'))}});
 const doc=await loadingTask.promise;
 if(failed)throw new Error('Preview loading timed out');
 document.getElementById('status').textContent='Rendering the first page…';
 const first=await doc.getPage(1);const initial=first.getViewport({scale:1.5});
 const sections=[];const scheduled=new Set();let rendered=0;let queue=Promise.resolve();
 for(let n=1;n<=doc.numPages;n++) {
  const section=document.createElement('section');section.dataset.page=String(n);
  const canvas=document.createElement('canvas');canvas.width=initial.width;canvas.height=initial.height;section.append(canvas);
  const label=document.createElement('p');label.textContent='Page '+n+' of '+doc.numPages;section.append(label);document.getElementById('pages').append(section);sections.push(section);
 }
 async function draw(n) {
  const page=n===1?first:await doc.getPage(n);const viewport=page.getViewport({scale:1.5});
  const section=sections[n-1];const canvas=section.querySelector('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;page.cleanup();section.dataset.rendered='true';rendered++;
  document.getElementById('status').textContent=doc.numPages+' pages · '+rendered+' rendered';
 }
 // PDF generation is complete. Display page one immediately; render other pages near the viewport.
 scheduled.add(1);await draw(1);if(failed)throw new Error('Preview loading timed out');clearTimeout(timeout);document.getElementById('confirm').disabled=false;
 const observer=new IntersectionObserver(entries=>{
  for(const entry of entries) if(entry.isIntersecting) {
   const n=Number(entry.target.dataset.page);if(scheduled.has(n))continue;scheduled.add(n);
   queue=queue.then(()=>draw(n)).catch(e=>{document.getElementById('status').textContent='Preview failed: '+String(e);document.getElementById('confirm').disabled=true;});
  }
 },{rootMargin:'600px'});
 for(const section of sections)observer.observe(section);
 }catch(e){clearTimeout(timeout);fail(String(e));}
 </script></body></html>`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      message.dispose();
      closed.dispose();
      panel.dispose();
      resolve(confirmed);
    };
    const abort = () => finish(false);
    const message = webview.onDidReceiveMessage((value) => {
      if (value?.type === 'confirm') finish(true);
      else if (value?.type === 'cancel') finish(false);
    });
    const closed = panel.onDidDispose(() => finish(false));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) finish(false);
  });
}
