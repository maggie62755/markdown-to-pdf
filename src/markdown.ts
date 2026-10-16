import { resolveCodeTheme, type CodeTheme } from './themes';
import { githubAlerts } from './alerts';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import sanitizeHtml from 'sanitize-html';
import { codeToHtml } from 'shiki';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export interface Issue {
  kind: string;
  line?: number;
  message: string;
}
export interface Rendered {
  html: string;
  codeTheme: CodeTheme;
  issues: Issue[];
  resources: Map<string, { body: Buffer; type: string }>;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function placeholder(issue: Issue) {
  return `<div class="issue">[${escape(issue.kind)}${issue.line ? `, line ${issue.line}` : ''}] ${escape(issue.message)}</div>`;
}
export async function renderMarkdown(
  source: string,
  filename: string,
  selectedTheme?: CodeTheme,
): Promise<Rendered> {
  const codeTheme = resolveCodeTheme(selectedTheme);
  const issues: Issue[] = [];
  const resources: Rendered['resources'] = new Map();
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  md.use(githubAlerts);
  const clean = (html: string) =>
    sanitizeHtml(html, {
      allowedTags: [
        'p',
        'br',
        'hr',
        'strong',
        'em',
        'del',
        's',
        'sup',
        'sub',
        'kbd',
        'mark',
        'details',
        'summary',
        'div',
        'span',
      ],
      allowedAttributes: {},
      disallowedTagsMode: 'discard',
    });
  md.renderer.rules.html_block = (ts, i) => clean(ts[i].content);
  md.renderer.rules.html_inline = (ts, i) => clean(ts[i].content);
  md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    const first = state.src.slice(
      state.bMarks[start] + state.tShift[start],
      state.eMarks[start],
    );
    if (!first.startsWith('$$')) return false;
    if (silent) return true;
    let next = start;
    let body = first.slice(2);
    let closed = false;
    if (body.trimEnd().endsWith('$$')) {
      body = body.trimEnd().slice(0, -2);
      closed = true;
    } else {
      const lines = [body];
      while (++next < end) {
        const line = state.src.slice(state.bMarks[next], state.eMarks[next]);
        if (line.trimEnd().endsWith('$$')) {
          lines.push(line.trimEnd().slice(0, -2));
          closed = true;
          break;
        }
        lines.push(line);
      }
      body = lines.join('\n');
    }
    const token = state.push('math_block', '', 0);
    token.content = body;
    token.map = [start, Math.min(next + 1, end)];
    token.meta = { closed };
    state.line = Math.min(next + 1, end);
    return true;
  });
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$')
      return false;
    let end = state.pos + 1;
    while (
      (end = state.src.indexOf('$', end)) >= 0 &&
      state.src[end - 1] === '\\'
    )
      end++;
    if (end < 0 || state.src.slice(state.pos + 1, end).includes('\n'))
      return false;
    if (!silent) {
      const token = state.push('math_inline', '', 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  const tokens = md.parse(source, {});
  let imageId = 0;
  let diagramId = 0;
  async function walk(list: typeof tokens, inherited?: number) {
    for (const token of list) {
      const line = token.map ? token.map[0] + 1 : inherited;
      if (token.type === 'inline' && token.children) {
        // markdown-it inline children lack source maps; use the containing block's start.
        await walk(token.children, line);
      }
      if (token.type === 'math_block' || token.type === 'math_inline') {
        try {
          if (token.meta?.closed === false)
            throw new Error('Missing closing $$ delimiter');
          token.meta = {
            html: katex.renderToString(token.content, {
              displayMode: token.type === 'math_block',
              throwOnError: true,
              trust: false,
              strict: 'error',
              maxExpand: 1000,
            }),
          };
        } catch (e) {
          const issue = { kind: 'Math error', line, message: String(e) };
          issues.push(issue);
          token.meta = { html: placeholder(issue) };
        }
      }
      if (token.type === 'fence') {
        const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid')
          token.meta = {
            html: `<div class="mermaid" data-line="${line ?? ''}" id="diagram-${diagramId++}">${escape(token.content)}</div>`,
          };
        else {
          try {
            token.meta = {
              html: await codeToHtml(token.content, {
                lang: lang || 'text',
                theme: codeTheme,
              }),
            };
          } catch {
            token.meta = {
              html: `<pre><code>${escape(token.content)}</code></pre>`,
            };
          }
        }
      }
      if (token.type === 'image') {
        const src = String(token.attrGet('src') || '');
        try {
          if (/^https?:|^\/\//i.test(src))
            throw new Error(
              'Remote images are not downloaded. Save the image locally and update its reference.',
            );
          if (
            /^[a-z][a-z0-9+.-]*:/i.test(src) &&
            !/^file:/i.test(src) &&
            !/^[a-z]:[\\/]/i.test(src)
          )
            throw new Error('Unsupported image URI');
          const local = /^file:/i.test(src)
            ? fileURLToPath(src)
            : path.resolve(path.dirname(filename), decodeURIComponent(src));
          const ext = path.extname(local).toLowerCase();
          const type: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
          };
          if (!type[ext])
            throw new Error(
              'Supported image formats: PNG, JPEG, GIF and WebP. Convert SVG images to PNG.',
            );
          const body = await readFile(local);
          if (body.length > 30 * 1024 * 1024)
            throw new Error('Image exceeds the 30 MB limit');
          const url = `/images/${imageId++}`;
          resources.set(url, { body, type: type[ext] });
          token.attrSet('src', url);
          token.attrSet('data-line', String(line || ''));
        } catch (e) {
          const issue = {
            kind: 'Image error',
            line,
            message: `${src}: ${e instanceof Error ? e.message : String(e)}`,
          };
          issues.push(issue);
          token.meta = { html: placeholder(issue) };
        }
      }
    }
  }
  await walk(tokens);
  const imageRule = md.renderer.rules.image!;
  md.renderer.rules.image = (ts, i, o, env, self) =>
    typeof ts[i].meta?.html === 'string'
      ? String(ts[i].meta?.html)
      : imageRule(ts, i, o, env, self);
  for (const type of ['math_block', 'math_inline', 'fence'])
    md.renderer.rules[type] = (ts, i) => String(ts[i].meta?.html || '');
  return {
    html: md.renderer.render(tokens, md.options, {}),
    codeTheme,
    issues,
    resources,
  };
}
