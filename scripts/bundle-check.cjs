const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const commands = new Map();
let scenario, folder, filename, defaultOutput, chosenOutput;
const uri = (p) => ({ path: p, fsPath: p, scheme: 'file' });
const vscode = {
  workspace: {
    getConfiguration: () => ({
      get: () => process.env.TEST_CODE_THEME || 'one-light',
    }),
  },
  Uri: {
    file: uri,
    joinPath: (base, ...parts) => uri(path.join(base.path, ...parts)),
  },
  ViewColumn: { Beside: 2 },
  ProgressLocation: { Notification: 1 },
  DiagnosticSeverity: { Warning: 1 },
  languages: { createDiagnosticCollection: () => ({ delete() {}, set() {} }) },
  commands: {
    registerCommand: (id, fn) => {
      commands.set(id, fn);
      return { dispose() {} };
    },
  },
  env: { openExternal: async () => true },
  window: {
    get activeTextEditor() {
      return {
        document: {
          languageId: 'markdown',
          isUntitled: false,
          uri: uri(filename),
          lineCount: 3,
          getText: () => '# Bundle test\n\n繁體中文 **PDF** $x^2$',
        },
      };
    },
    showWarningMessage: async () => {
      scenario.events.push('warning');
      throw new Error('Unexpected pre-save overwrite prompt');
    },
    showErrorMessage: async (e) => scenario.errors.push(e),
    showInformationMessage: async () => {
      scenario.events.push('success');
    },
    showSaveDialog: async (options) => {
      scenario.events.push('save');
      assert.equal(scenario.events[0], 'preview-confirm');
      assert.equal(options.defaultUri.fsPath, defaultOutput);
      assert.equal(
        await fs.readFile(defaultOutput, 'utf8'),
        'original default',
      );
      assert.equal(await fs.readFile(chosenOutput, 'utf8'), 'original chosen');
      return scenario.cancelSave ? undefined : uri(chosenOutput);
    },
    withProgress: async (options, fn) =>
      fn(
        { report() {} },
        { onCancellationRequested: () => ({ dispose() {} }) },
      ),
    createWebviewPanel: () => {
      let close;
      const panel = {
        webview: {
          html: '',
          cspSource: 'https://preview.invalid',
          asWebviewUri: (x) => ({
            toString: () => `https://preview.invalid${x.path}`,
          }),
          onDidReceiveMessage: (fn) => {
            setTimeout(async () => {
              try {
                assert.deepEqual(scenario.events, []);
                assert.equal(
                  await fs.readFile(defaultOutput, 'utf8'),
                  'original default',
                );
                scenario.pdf = Buffer.from(
                  panel.webview.html.match(
                    /const raw=atob\("([A-Za-z0-9+/=]+)"\)/,
                  )[1],
                  'base64',
                );
                scenario.events.push(
                  scenario.cancelPreview ? 'preview-cancel' : 'preview-confirm',
                );
                fn({ type: scenario.cancelPreview ? 'cancel' : 'confirm' });
              } catch (e) {
                scenario.errors.push(String(e));
                fn({ type: 'cancel' });
              }
            }, 0);
            return { dispose() {} };
          },
        },
        onDidDispose: (fn) => {
          close = fn;
          return { dispose() {} };
        },
        dispose: () => close?.(),
      };
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
    require('../dist/extension.cjs').activate({
      extensionPath: process.cwd(),
      extensionUri: uri(process.cwd()),
      subscriptions: [],
    });
    for (const config of [
      {},
      { cancelPreview: true },
      { cancelSave: true },
      { command: 'localMarkdownPdf.exportAs' },
    ]) {
      scenario = { ...config, events: [], errors: [] };
      await fs.writeFile(defaultOutput, 'original default');
      await fs.writeFile(chosenOutput, 'original chosen');
      await commands.get(config.command || 'localMarkdownPdf.export')();
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
      assert.deepEqual(
        scenario.events,
        config.cancelPreview
          ? ['preview-cancel']
          : config.cancelSave
            ? ['preview-confirm', 'save']
            : ['preview-confirm', 'save', 'success'],
      );
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
