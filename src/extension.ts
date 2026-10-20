import * as vscode from 'vscode';
import path from 'node:path';
import { exportPdf, ExportCancelled, savePdf } from './pdf';
import { resolveCodeTheme } from './themes';
import { resolveLayout } from './layout';
import { createPreview } from './preview';
import type { Issue } from './markdown';
let busy = false;
export function activate(context: vscode.ExtensionContext) {
  const diagnostics =
    vscode.languages.createDiagnosticCollection('local-markdown-pdf');
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(
    vscode.commands.registerCommand('localMarkdownPdf.export', async () => {
      if (busy) {
        void vscode.window.showWarningMessage(
          'A PDF preview is already open. Close it before opening another.',
        );
        return;
      }
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        void vscode.window.showWarningMessage(
          'Open a Markdown document to export.',
        );
        return;
      }
      if (doc.isUntitled) {
        void vscode.window.showWarningMessage(
          'Save this document as a .md file first so relative image paths can be resolved.',
        );
        return;
      }
      if (
        !['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(
          `${process.platform}-${process.arch}`,
        )
      ) {
        void vscode.window.showErrorMessage(
          'Supported platforms: macOS (Apple Silicon or Intel), Windows x64 and Ubuntu x64.',
        );
        return;
      }
      if (vscode.env.remoteName || doc.uri.scheme !== 'file') {
        void vscode.window.showErrorMessage(
          'Only local Markdown documents are supported.',
        );
        return;
      }
      busy = true;
      const lifetime = new AbortController();
      let render: AbortController | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let revision = 0;
      let latest:
        { pdf: Buffer; revision: number; issues: Issue[] } | undefined;
      let saving = false;
      const filename = doc.uri.fsPath;
      const defaultUri = vscode.Uri.file(
        path.join(
          path.dirname(filename),
          path.basename(filename, path.extname(filename)) + '.pdf',
        ),
      );
      const preview = createPreview(
        context,
        lifetime.signal,
        async (requested) => {
          const snapshot = latest;
          if (
            saving ||
            !snapshot ||
            requested !== revision ||
            snapshot.revision !== revision
          )
            return;
          saving = true;
          try {
            if (snapshot.issues.length) {
              const choice = await vscode.window.showWarningMessage(
                `Found ${snapshot.issues.length} issue(s). Export with visible placeholders?`,
                {
                  modal: true,
                  detail: 'See the Problems panel for source locations.',
                },
                'Export with Placeholders',
              );
              if (choice !== 'Export with Placeholders') return;
            }
            const target = await vscode.window.showSaveDialog({
              defaultUri,
              filters: { PDF: ['pdf'] },
              saveLabel: 'Export PDF',
              title: 'Save PDF',
            });
            if (!target || lifetime.signal.aborted) return;
            if (snapshot.revision !== revision) {
              void vscode.window.showInformationMessage(
                'The document changed. Review the updated preview before exporting.',
              );
              return;
            }
            if (target.scheme !== 'file')
              throw new Error('Choose a local save location.');
            if (path.resolve(target.fsPath) === path.resolve(filename))
              throw new Error(
                'The output file must not replace the source Markdown document.',
              );
            if (path.extname(target.fsPath).toLowerCase() !== '.pdf')
              throw new Error('The output file must use the .pdf extension.');
            // Edits also cancel an in-flight save before its atomic rename.
            await savePdf(snapshot.pdf, target.fsPath, render?.signal);
            preview.dispose();
            if (
              (await vscode.window.showInformationMessage(
                `PDF exported: ${target.fsPath}`,
                'Open PDF',
              )) === 'Open PDF'
            )
              await vscode.env.openExternal(target);
          } catch (e) {
            if (!(e instanceof ExportCancelled))
              void vscode.window.showErrorMessage(
                `PDF export failed: ${e instanceof Error ? e.message : String(e)}`,
              );
          } finally {
            saving = false;
            if (!lifetime.signal.aborted && latest?.revision === revision)
              preview.update(latest.pdf, revision, latest.issues);
          }
        },
        () => {
          void (async () => {
            const snapshot = latest;
            if (!snapshot || snapshot.revision !== revision) return;
            const selected = await vscode.window.showQuickPick(
              snapshot.issues.map((issue) => ({
                label: `${issue.line ? `Line ${issue.line}` : 'Document'} · ${issue.kind}`,
                detail: issue.message,
                issue,
              })),
              {
                title: 'PDF issues — select to reveal the Markdown source',
                matchOnDetail: true,
              },
            );
            if (!selected || snapshot.revision !== revision) return;
            const line = Math.max(
              0,
              Math.min((selected.issue.line || 1) - 1, doc.lineCount - 1),
            );
            const editor = await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.One,
              selection: new vscode.Range(line, 0, line, 0),
            });
            editor.revealRange(
              new vscode.Range(line, 0, line, 0),
              vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
          })();
        },
        doc.uri,
      );
      async function generate(expected: number) {
        if (lifetime.signal.aborted || expected !== revision) return;
        const controller = new AbortController();
        render = controller;
        const config = vscode.workspace.getConfiguration(
          'localMarkdownPdf',
          doc!.uri,
        );
        let issues: Issue[] = [];
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Updating PDF preview',
              cancellable: true,
            },
            async (progress, token) => {
              const listener = token.onCancellationRequested(() => {
                controller.abort();
                preview.dispose();
              });
              try {
                await exportPdf({
                  source: doc!.getText(),
                  filename,
                  root: context.extensionPath,
                  signal: controller.signal,
                  codeTheme: resolveCodeTheme(config.get('codeTheme')),
                  layout: resolveLayout((key) => config.get(key)),
                  output: async () => undefined,
                  progress: (message) => progress.report({ message }),
                  onIssues: async (found) => {
                    issues = found;
                    return true;
                  },
                  onPreview: async (pdf) => {
                    if (expected !== revision || controller.signal.aborted)
                      return false;
                    latest = { pdf, revision: expected, issues };
                    diagnostics.set(
                      doc!.uri,
                      issues.map(
                        (issue) =>
                          new vscode.Diagnostic(
                            new vscode.Range(
                              Math.max(
                                0,
                                Math.min(
                                  (issue.line || 1) - 1,
                                  doc!.lineCount - 1,
                                ),
                              ),
                              0,
                              Math.max(
                                0,
                                Math.min(
                                  (issue.line || 1) - 1,
                                  doc!.lineCount - 1,
                                ),
                              ),
                              1,
                            ),
                            `${issue.kind}: ${issue.message}`,
                            vscode.DiagnosticSeverity.Warning,
                          ),
                      ),
                    );
                    preview.update(pdf, expected, issues);
                    return true;
                  },
                });
              } finally {
                listener.dispose();
              }
            },
          );
        } catch (e) {
          if (
            expected !== revision ||
            controller.signal.aborted ||
            lifetime.signal.aborted ||
            e instanceof ExportCancelled
          )
            return;
          preview.error(e instanceof Error ? e.message : String(e));
        }
      }
      // Serialize generations; a superseded job is cancelled before the next starts.
      let work = Promise.resolve();
      function refresh(delay = 500) {
        revision++;
        latest = undefined;
        render?.abort();
        clearTimeout(timer);
        diagnostics.delete(doc!.uri);
        preview.busy();
        const expected = revision;
        timer = setTimeout(() => {
          work = work.then(() => generate(expected));
        }, delay);
      }
      const edits = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === doc) refresh();
      });
      const settings = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('localMarkdownPdf', doc!.uri)) refresh();
      });
      const closing = vscode.workspace.onDidCloseTextDocument((document) => {
        if (document === doc) preview.dispose();
      });
      const shutdown = { dispose: () => preview.dispose() };
      context.subscriptions.push(shutdown);
      refresh(0);
      try {
        await preview.closed;
      } finally {
        lifetime.abort();
        render?.abort();
        clearTimeout(timer);
        latest = undefined;
        edits.dispose();
        settings.dispose();
        closing.dispose();
        diagnostics.delete(doc.uri);
        const index = context.subscriptions.indexOf(shutdown);
        if (index >= 0) context.subscriptions.splice(index, 1);
        busy = false;
      }
    }),
  );
}
