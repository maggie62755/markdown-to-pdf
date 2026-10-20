import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { defaultLayout, resolveLayout } from './layout';
import { resolveCodeTheme } from './themes';

const defaults = { codeTheme: 'one-light', ...defaultLayout };
type Key = keyof typeof defaults;
const labels: Record<Key, string> = {
  codeTheme: 'Code block theme',
  paperSize: 'Paper size',
  orientation: 'Orientation',
  fontSize: 'Body font size (pt)',
  marginTop: 'Top margin (mm)',
  marginBottom: 'Bottom margin (mm)',
  marginLeft: 'Left margin (mm)',
  marginRight: 'Right margin (mm)',
  pageNumbers: 'Show page numbers',
  pageNumberStyle: 'Page number style',
  inlineCodeBackground: 'Inline code background',
  inlineCodeColor: 'Inline code text',
};
const choices: Partial<Record<Key, string[]>> = {
  codeTheme: ['one-light', 'github-dark'],
  paperSize: ['A4', 'A5', 'Letter', 'Legal'],
  orientation: ['portrait', 'landscape'],
  pageNumberStyle: ['current-total', 'current', 'page-of-total'],
};
const display: Record<string, string> = {
  'one-light': 'One Light',
  'github-dark': 'GitHub Dark',
  portrait: 'Portrait',
  landscape: 'Landscape',
  'current-total': '1 / 10',
  current: '1',
  'page-of-total': 'Page 1 of 10',
  true: 'On',
  false: 'Off',
};
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function openPdfSettings(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri,
) {
  const panel = vscode.window.createWebviewPanel(
    'localMarkdownPdf.settings',
    'PDF Settings',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  );
  const nonce = randomBytes(18).toString('hex');
  const scopes = [{ id: 'user', label: 'User — all projects' }];
  if (vscode.workspace.workspaceFolders?.length)
    scopes.push({ id: 'workspace', label: 'Workspace — this project' });
  if (resource && (vscode.workspace.workspaceFolders?.length || 0) > 1)
    scopes.push({ id: 'folder', label: 'Folder — source document' });
  let scope = scopes.some((s) => s.id === 'workspace') ? 'workspace' : 'user';
  let disposed = false;
  const config = () =>
    vscode.workspace.getConfiguration('localMarkdownPdf', resource);
  const state = () => {
    const c = config();
    return {
      type: 'state',
      scope,
      values: {
        codeTheme: resolveCodeTheme(c.get('codeTheme')),
        ...resolveLayout((key) => c.get(key)),
      },
    };
  };
  const send = () => {
    if (!disposed) void panel.webview.postMessage(state());
  };
  const target = () =>
    scope === 'folder'
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : scope === 'workspace'
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
  let queue = Promise.resolve();
  let saving = false;
  const receiver = panel.webview.onDidReceiveMessage((message) => {
    if (message?.type === 'ready') {
      send();
      return;
    }
    if (message?.type === 'native') {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'localMarkdownPdf',
      );
      return;
    }
    if (message?.type !== 'save' || saving) return;
    if (
      !scopes.some((s) => s.id === message.scope) ||
      !message.values ||
      typeof message.values !== 'object'
    )
      return;
    scope = message.scope;
    const destination = target();
    saving = true;
    queue = queue
      .then(async () => {
        const entries = Object.entries(message.values);
        // Validate the entire draft before writing any settings.
        for (const [rawKey, value] of entries) {
          if (!Object.prototype.hasOwnProperty.call(defaults, rawKey))
            throw new Error('Unknown setting.');
          const key = rawKey as Key;
          const normalized =
            key === 'codeTheme'
              ? resolveCodeTheme(value)
              : resolveLayout((k) => (k === key ? value : defaults[k as Key]))[
                  key
                ];
          if (value !== normalized)
            throw new Error(
              'Invalid value. Use the displayed range or a six-digit hex color.',
            );
        }
        for (const [key, value] of entries)
          await config().update(key, value, destination);
        if (!disposed)
          void panel.webview.postMessage({ ...state(), type: 'saved' });
      })
      .catch((error) => {
        if (!disposed)
          void panel.webview.postMessage({
            type: 'error',
            message: String(error),
          });
      })
      .finally(() => {
        saving = false;
      });
  });
  const listener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!saving && event.affectsConfiguration('localMarkdownPdf', resource))
      send();
  });
  panel.onDidDispose(() => {
    disposed = true;
    listener.dispose();
    receiver.dispose();
  });
  const fields = (Object.keys(defaults) as Key[])
    .map((key) => {
      const value = defaults[key];
      let control: string;
      if (choices[key])
        control = `<select id="${key}" data-key="${key}">${choices[key]!.map((option) => `<option value="${option}">${display[option] || option}</option>`).join('')}</select>`;
      else if (typeof value === 'boolean')
        control = `<input id="${key}" data-key="${key}" type="checkbox">`;
      else if (typeof value === 'number')
        control = `<input id="${key}" data-key="${key}" type="number" required min="${key === 'fontSize' ? 8 : 5}" max="${key === 'fontSize' ? 24 : 40}" step="any"><span class="hint">${key === 'fontSize' ? '8–24 pt' : '5–40 mm'}</span>`;
      else
        control = `<input type="color" data-color="${key}" aria-label="Choose ${escape(labels[key])}"><input id="${key}" data-key="${key}" type="text" required pattern="#[0-9a-fA-F]{6}" maxlength="7" spellcheck="false" aria-label="${escape(labels[key])} hex color">`;
      return `<div class="field"><label for="${key}">${labels[key]}</label><span class="default">Default: ${escape(display[String(value)] || value)}</span><div class="control">${control}<button data-reset="${key}" title="Restore the default for ${escape(labels[key])}">Reset</button></div></div>`;
    })
    .join('');
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
  *{box-sizing:border-box}body{margin:0;padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px var(--vscode-font-family,system-ui)}main{max-width:760px;margin:auto}h1{font-size:20px;margin:0 0 8px}p,.default,.hint{color:var(--vscode-descriptionForeground)}.toolbar,.control{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar{margin:20px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.field{border:1px solid var(--vscode-panel-border,#8885);padding:14px;border-radius:6px}.field>label{display:block;font-weight:600}.default{display:block;margin:5px 0 12px;font-size:12px}.control button{margin-left:auto}input,select,button{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#8885);border-radius:4px;min-height:28px;padding:4px 7px}input[type=number]{width:80px}input[type=text]{width:100px}input[type=color]{width:36px;padding:2px;cursor:pointer}input[type=checkbox]{min-height:auto}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}#save{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:hover{background:var(--vscode-toolbar-hoverBackground)}input:invalid{outline:1px solid var(--vscode-errorForeground)}.sample{padding:16px 0}.sample code{font:14px monospace;padding:6px 10px;border-radius:4px}#notice{min-height:20px}#notice.error{color:var(--vscode-errorForeground)}
  </style></head><body><main><h1>PDF Settings</h1><p>Edit settings below, then click Save to apply them to the PDF. Reset and color choices remain unsaved until you save. Closing this tab discards unsaved changes.</p><div class="toolbar"><label for="scope">Save to</label><select id="scope">${scopes.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select><button id="save" disabled>Save</button><button id="discard" disabled>Discard</button><button id="reset-all">Reset all to defaults</button><button id="native">VS Code settings</button></div><p class="hint">Fields show the effective settings for the source document. Workspace or folder settings can override user settings.</p><div class="grid">${fields}</div><div class="sample">Inline code preview: <code id="sample">const greeting = "Hello 世界";</code></div><p id="notice" role="status"></p></main><script nonce="${nonce}">
  const vscode=acquireVsCodeApi();
  const send=value=>vscode.postMessage(value);
  const defaults=${JSON.stringify(defaults)};
  const notice=document.getElementById('notice');
  const controls=[...document.querySelectorAll('[data-key]')];
  let baseline={}, latest={}, dirty=new Set(), saving=false;
  const valueOf=input=>input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
  const paint=()=>{const sample=document.getElementById('sample');sample.style.backgroundColor=document.getElementById('inlineCodeBackground').value;sample.style.color=document.getElementById('inlineCodeColor').value;};
  const buttons=()=>{document.getElementById('save').disabled=saving||!dirty.size;document.getElementById('discard').disabled=saving||!dirty.size;};
  const setValue=(key,value)=>{const input=document.getElementById(key);if(input.type==='checkbox')input.checked=value;else input.value=value;const picker=document.querySelector('[data-color="'+key+'"]');if(picker)picker.value=value;};
  const edit=input=>{const key=input.dataset.key;if(valueOf(input)===baseline[key])dirty.delete(key);else dirty.add(key);const picker=document.querySelector('[data-color="'+key+'"]');if(picker&&input.checkValidity())picker.value=input.value;paint();notice.className='';notice.textContent=dirty.size?'Unsaved changes — click Save to apply.':'';buttons();};
  const load=values=>{baseline={...values};latest={...values};dirty.clear();for(const [key,value] of Object.entries(values))setValue(key,value);paint();buttons();};
  const lock=value=>{saving=value;document.querySelectorAll('input,select,button').forEach(input=>input.disabled=value);buttons();};
  controls.forEach(input=>input.addEventListener('input',()=>edit(input)));
  document.querySelectorAll('[data-color]').forEach(input=>input.addEventListener('input',()=>{const field=document.getElementById(input.dataset.color);field.value=input.value;edit(field);}));
  document.querySelectorAll('[data-reset]').forEach(button=>button.onclick=()=>{const key=button.dataset.reset;setValue(key,defaults[key]);edit(document.getElementById(key));});
  document.getElementById('reset-all').onclick=()=>{for(const [key,value] of Object.entries(defaults)){setValue(key,value);edit(document.getElementById(key));}};
  document.getElementById('discard').onclick=()=>{load(latest);notice.className='';notice.textContent='Unsaved changes discarded.';};
  document.getElementById('save').onclick=()=>{
    for(const input of controls)if(!input.checkValidity()){input.reportValidity();return;}
    const values=Object.fromEntries([...dirty].map(key=>[key,valueOf(document.getElementById(key))]));
    lock(true);notice.textContent='Saving…';send({type:'save',scope:document.getElementById('scope').value,values});
  };
  document.getElementById('native').onclick=()=>send({type:'native'});
  window.addEventListener('message',event=>{
    const message=event.data;
    if(message.type==='state'){
      latest={...message.values};
      if(!dirty.size&&!saving){load(message.values);document.getElementById('scope').value=message.scope;}
      else if(!saving)notice.textContent='Settings changed elsewhere. Your draft is preserved; Save applies edited fields, Discard loads the latest settings.';
    }else if(message.type==='saved'){
      lock(false);load(message.values);notice.className='';notice.textContent='Saved. The PDF preview is updating.';
    }else if(message.type==='error'){
      lock(false);notice.className='error';notice.textContent=message.message+' Your draft is retained; check settings before retrying.';
    }
  });
  send({type:'ready'});
  </script></body></html>`;
}
