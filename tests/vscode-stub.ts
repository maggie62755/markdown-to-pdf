export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};
export const workspace = {
  getConfiguration: () => ({ inspect: () => ({ defaultValue: 'A4' }) }),
};
export const commands = { executeCommand: async () => {} };
export const panels: any[] = [];
export const ViewColumn = { Beside: 2 };
export const Uri = {
  joinPath: (base: any, ...parts: string[]) => ({
    path: (base.path + '/' + parts.join('/')).replace(/\/$/, ''),
  }),
};
export const window = {
  createWebviewPanel: () => {
    const listeners: any = {};
    const panel: any = {
      webview: {
        html: '',
        postMessage: async (message: any) => {
          panel.outgoing?.(message);
          return true;
        },
        cspSource: 'https://preview.invalid',
        asWebviewUri: (uri: any) => ({
          toString: () => `https://preview.invalid${uri.path}`,
        }),
        onDidReceiveMessage: (fn: any) => {
          listeners.message = fn;
          return { dispose() {} };
        },
      },
      onDidDispose: (fn: any) => {
        listeners.close = fn;
        return { dispose() {} };
      },
      dispose: () => listeners.close?.(),
      message: (msg: any) => listeners.message(msg),
    };
    panels.push(panel);
    return panel;
  },
};
