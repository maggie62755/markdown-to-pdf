export const panels: any[] = [];
export const ViewColumn = { Beside: 2 };
export const Uri = {
  joinPath: (base: any, ...parts: string[]) => ({
    path: base.path + '/' + parts.join('/'),
  }),
};
export const window = {
  createWebviewPanel: () => {
    const listeners: any = {};
    const panel = {
      webview: {
        html: '',
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
