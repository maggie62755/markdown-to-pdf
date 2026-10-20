const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const commands = new Map();
let scenario, folder, filename, defaultOutput, chosenOutput, doc;
let changed, configured, closedDocument;
const disposable = { dispose() {} };
const uri = (p) => ({ path: p, fsPath: p, scheme: 'file' });
const vscode = {
  workspace: {
    getConfiguration: () => ({
      get: (key) =>
        key === 'codeTheme'
          ? process.env.TEST_CODE_THEME || 'one-light'
          : key === 'orientation' && scenario.landscape
            ? 'landscape'
            : undefined,
    }),
    onDidChangeTextDocument: (fn) => {
      changed = fn;
      return disposable;
    },
    onDidChangeConfiguration: (fn) => {
      configured = fn;
      return disposable;
    },
    onDidCloseTextDocument: (fn) => {
      closedDocument = fn;
      return disposable;
    },
  },
  Uri: {
    file: uri,
    joinPath: (base, ...parts) => uri(path.join(base.path, ...parts)),
  },
  ViewColumn: { Beside: 2, One: 1 },
  Range: class {
    constructor(line) {
      this.line = line;
    }
  },
  Diagnostic: class {},
  TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
  ProgressLocation: { Notification: 1 },
  DiagnosticSeverity: { Warning: 1 },
  languages: { createDiagnosticCollection: () => ({ delete() {}, set() {} }) },
  commands: {
    registerCommand: (id, fn) => {
      commands.set(id, fn);
      return disposable;
    },
  },
  env: { openExternal: async () => true },
  window: {
    get activeTextEditor() {
      return { document: doc };
    },
    showWarningMessage: async () => {
      if (scenario.issuePick) return 'Export with Placeholders';
      throw new Error('Unexpected warning');
    },
    showErrorMessage: async (e) => {
      scenario.errors.push(e);
      scenario.panel.dispose();
    },
    showInformationMessage: async (message) => {
      if (message.startsWith('PDF exported:')) scenario.events.push('success');
    },
    showQuickPick: async (items) => {
      assert.ok(items[0].label.includes('Line 3'));
      assert.ok(items[0].detail.includes('missing.png'));
      return items[0];
    },
    showTextDocument: async (document, options) => {
      assert.equal(document, doc);
      assert.equal(options.selection.line, 2);
      return {
        revealRange: (range) => {
          scenario.revealed = range.line;
        },
      };
    },
    showSaveDialog: async (options) => {
      scenario.events.push('save');
      assert.equal(options.defaultUri.fsPath, defaultOutput);
      assert.equal(
        await fs.readFile(defaultOutput, 'utf8'),
        'original default',
      );
      assert.equal(await fs.readFile(chosenOutput, 'utf8'), 'original chosen');
      if (scenario.editDuringSave && !scenario.savedEdit) {
        scenario.savedEdit = true;
        scenario.source = '# Changed during save';
        changed({ document: doc });
      }
      return scenario.cancelSave ? undefined : uri(chosenOutput);
    },
    withProgress: async (options, fn) =>
      fn({ report() {} }, { onCancellationRequested: () => disposable }),
    createWebviewPanel: () => {
      let close,
        receive,
        disposed = false;
      const panel = {
        webview: {
          html: '',
          cspSource: 'https://preview.invalid',
          asWebviewUri: (x) => ({
            toString: () => `https://preview.invalid${x.path}`,
          }),
          onDidReceiveMessage: (fn) => {
            receive = fn;
            setTimeout(() => fn({ type: 'ready' }), 0);
            return disposable;
          },
          postMessage: async (message) => {
            if (disposed || message.type !== 'pdf') return true;
            try {
              scenario.previews++;
              assert.equal(
                await fs.readFile(chosenOutput, 'utf8'),
                'original chosen',
              );
              if (
                (scenario.edit || scenario.settings) &&
                scenario.previews === 1
              ) {
                if (scenario.edit) {
                  scenario.source = '# Newest unsaved text';
                  changed({ document: doc });
                  changed({ document: doc });
                } else {
                  scenario.landscape = true;
                  configured({ affectsConfiguration: () => true });
                }
                await receive({ type: 'confirm', revision: message.revision });
                assert.ok(
                  !scenario.events.includes('save'),
                  'Stale preview opened save dialog',
                );
                return true;
              }
              if (scenario.cancelSave && scenario.previews > 1) {
                receive({ type: 'cancel' });
                return true;
              }
              if (scenario.issuePick) {
                assert.equal(message.issues, 1);
                receive({ type: 'issues' });
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(scenario.revealed, 2);
              }
              scenario.pdf = Buffer.from(message.data, 'base64');
              scenario.events.push(
                scenario.cancelPreview ? 'preview-cancel' : 'preview-confirm',
              );
              await receive({
                type: scenario.cancelPreview ? 'cancel' : 'confirm',
                revision: message.revision,
              });
            } catch (e) {
              scenario.errors.push(String(e));
              panel.dispose();
            }
            return true;
          },
        },
        onDidDispose: (fn) => {
          close = fn;
          return disposable;
        },
        dispose: () => {
          if (!disposed) {
            disposed = true;
            close?.();
          }
        },
      };
      scenario.panel = panel;
      return panel;
    },
  },
};
const original = Module._load;
Module._load = function (id, ...args) {
  return id === 'vscode' ? vscode : original.call(this, id, ...args);
};
(async () => {
  folder = await fs.mkdtemp(path.resolve('.vendor/export-flow-'));
  try {
    filename = path.join(folder, 'readme.md');
    defaultOutput = path.join(folder, 'readme.pdf');
    chosenOutput = path.join(folder, '自訂 檔名.pdf');
    doc = {
      languageId: 'markdown',
      isUntitled: false,
      uri: uri(filename),
      lineCount: 3,
      getText: () => scenario.source,
    };
    require('../dist/extension.cjs').activate({
      extensionPath: process.cwd(),
      extensionUri: uri(process.cwd()),
      subscriptions: [],
    });
    assert.deepEqual([...commands.keys()], ['localMarkdownPdf.export']);
    for (const config of [
      {},
      { cancelPreview: true },
      { cancelSave: true },
      { edit: true },
      { settings: true },
      { editDuringSave: true },
      { issuePick: true },
    ]) {
      scenario = {
        ...config,
        events: [],
        errors: [],
        previews: 0,
        source: config.issuePick
          ? '# Issues\n\n![missing](missing.png)'
          : '# Bundle test\n\n繁體中文 **PDF** $x^2$',
      };
      await fs.writeFile(defaultOutput, 'original default');
      await fs.writeFile(chosenOutput, 'original chosen');
      let timer;
      try {
        await Promise.race([
          commands.get('localMarkdownPdf.export')(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              scenario.panel?.dispose();
              reject(new Error('Export flow timed out'));
            }, 45000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.deepEqual(scenario.errors, []);
      assert.equal(
        await fs.readFile(defaultOutput, 'utf8'),
        'original default',
      );
      if (config.cancelPreview || config.cancelSave)
        assert.equal(
          await fs.readFile(chosenOutput, 'utf8'),
          'original chosen',
        );
      else assert.deepEqual(await fs.readFile(chosenOutput), scenario.pdf);
      if (config.edit || config.settings || config.editDuringSave)
        assert.equal(scenario.previews, 2);
      console.log(
        'Export flow passed:',
        JSON.stringify(config),
        scenario.events.join(' → '),
      );
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
