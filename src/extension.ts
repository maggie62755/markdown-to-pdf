import * as vscode from 'vscode';
import path from 'node:path';
import { exportPdf } from './pdf';
import { resolveCodeTheme } from './themes';
import { confirmPdf } from './preview';
let busy = false;
export function activate(context: vscode.ExtensionContext) {
  const diagnostics =
    vscode.languages.createDiagnosticCollection('local-markdown-pdf');
  context.subscriptions.push(diagnostics);
  const run = async () => {
    if (busy) {
      void vscode.window.showWarningMessage(
        'A PDF export is already in progress. Please wait.',
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
    try {
      const source = doc.getText();
      const filename = doc.uri.fsPath;
      const codeTheme = resolveCodeTheme(
        vscode.workspace
          .getConfiguration('localMarkdownPdf', doc.uri)
          .get('codeTheme'),
      );
      const defaultUri = vscode.Uri.file(
        path.join(
          path.dirname(filename),
          path.basename(filename, path.extname(filename)) + '.pdf',
        ),
      );
      diagnostics.delete(doc.uri);
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Export Markdown to PDF',
          cancellable: true,
        },
        async (progress, token) => {
          const controller = new AbortController();
          const listener = token.onCancellationRequested(() =>
            controller.abort(),
          );
          try {
            return await exportPdf({
              source,
              codeTheme,
              filename,
              output: async () => {
                if (controller.signal.aborted) return;
                progress.report({
                  message: 'Choose a PDF filename and location',
                });
                // The native save dialog handles confirmation when replacing a file.
                const target = await vscode.window.showSaveDialog({
                  defaultUri,
                  filters: { PDF: ['pdf'] },
                  saveLabel: 'Export PDF',
                  title: 'Save PDF',
                });
                if (!target) return;
                if (target.scheme !== 'file')
                  throw new Error('Choose a local save location.');
                if (path.resolve(target.fsPath) === path.resolve(filename))
                  throw new Error(
                    'The output file must not replace the source Markdown document.',
                  );
                if (path.extname(target.fsPath).toLowerCase() !== '.pdf')
                  throw new Error(
                    'The output file must use the .pdf extension.',
                  );
                return target.fsPath;
              },
              root: context.extensionPath,
              signal: controller.signal,
              onPreview: async (pdf) => {
                progress.report({
                  message: 'Review the preview, then confirm to export',
                });
                return confirmPdf(context, pdf, controller.signal);
              },
              progress: (message) => progress.report({ message }),
              onIssues: async (issues) => {
                diagnostics.set(
                  doc.uri,
                  issues.map(
                    (issue) =>
                      new vscode.Diagnostic(
                        new vscode.Range(
                          Math.min((issue.line || 1) - 1, doc.lineCount - 1),
                          0,
                          Math.min((issue.line || 1) - 1, doc.lineCount - 1),
                          1,
                        ),
                        `${issue.kind}: ${issue.message}`,
                        vscode.DiagnosticSeverity.Warning,
                      ),
                  ),
                );
                const summary = issues
                  .slice(0, 8)
                  .map(
                    (i) =>
                      `${i.kind}${i.line ? ` (line ${i.line})` : ''}: ${i.message}`,
                  )
                  .join('\n');
                return (
                  (await vscode.window.showWarningMessage(
                    `Found ${issues.length} issue(s). Continuing will include visible placeholders in the PDF.`,
                    {
                      modal: true,
                      detail:
                        summary +
                        (issues.length > 8
                          ? '\nSee the Problems panel for the complete list.'
                          : ''),
                    },
                    'Continue with Placeholders',
                  )) === 'Continue with Placeholders'
                );
              },
            });
          } finally {
            listener.dispose();
          }
        },
      );
      if (!result.output) return;
      const target = vscode.Uri.file(result.output);
      if (
        (await vscode.window.showInformationMessage(
          `PDF exported: ${target.fsPath}`,
          'Open PDF',
        )) === 'Open PDF'
      )
        await vscode.env.openExternal(target);
    } catch (e) {
      if (e instanceof Error && e.message === 'Export cancelled') return;
      void vscode.window.showErrorMessage(
        `PDF export failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      busy = false;
    }
  };
  for (const id of ['localMarkdownPdf.export', 'localMarkdownPdf.exportAs'])
    context.subscriptions.push(vscode.commands.registerCommand(id, run));
}
