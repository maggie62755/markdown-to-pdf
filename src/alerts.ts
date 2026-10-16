import type MarkdownIt from 'markdown-it';

const alerts = {
  NOTE: {
    title: 'Note',
    icon: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7v4M8 4.5v.5"/>',
  },
  TIP: {
    title: 'Tip',
    icon: '<path d="M5.5 11C5.5 9 3.5 8.5 3.5 6a4.5 4.5 0 0 1 9 0c0 2.5-2 3-2 5M5.5 11h5M6 13h4M7 15h2"/>',
  },
  IMPORTANT: {
    title: 'Important',
    icon: '<path d="M2 2h12v9H7l-4 3v-3H2zM8 4v3M8 8.5v.5"/>',
  },
  WARNING: {
    title: 'Warning',
    icon: '<path d="M8 1.5 15 14H1zM8 6v4M8 11.5v.5"/>',
  },
  CAUTION: {
    title: 'Caution',
    icon: '<path d="M5 1h6l4 4v6l-4 4H5l-4-4V5zM8 4v5M8 11v1"/>',
  },
} as const;
type AlertKind = keyof typeof alerts;

/** Transform block tokens before inline parsing, preserving body source locations. */
export function githubAlerts(md: InstanceType<typeof MarkdownIt>) {
  md.core.ruler.after('block', 'github_alerts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      const inline = tokens[i + 2];
      if (
        open.type !== 'blockquote_open' ||
        open.level !== 0 ||
        tokens[i + 1]?.type !== 'paragraph_open' ||
        inline?.type !== 'inline'
      )
        continue;
      const match = inline.content.match(
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/,
      );
      if (!match) continue;
      let end = i + 1;
      while (
        end < tokens.length &&
        !(
          tokens[end].type === 'blockquote_close' &&
          tokens[end].level === open.level
        )
      )
        end++;
      if (end === tokens.length) continue;
      open.type = 'alert_open';
      open.tag = 'div';
      open.meta = { kind: match[1] };
      tokens[end].type = 'alert_close';
      tokens[end].tag = 'div';
      inline.content = inline.content.slice(match[0].length);
      if (inline.content) {
        if (inline.map) inline.map = [inline.map[0] + 1, inline.map[1]];
      } else tokens.splice(i + 1, 3);
    }
  });
  md.renderer.rules.alert_open = (tokens, i) => {
    const kind = tokens[i].meta?.kind as AlertKind;
    const alert = alerts[kind];
    return `<div class="markdown-alert markdown-alert-${kind.toLowerCase()}"><p class="markdown-alert-title"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${alert.icon}</svg>${alert.title}</p>\n`;
  };
  md.renderer.rules.alert_close = () => '</div>\n';
}
