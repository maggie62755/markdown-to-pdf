import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown';

test('remote images and missing images produce located placeholders', async () => {
  const result = await renderMarkdown(
    '# Title\n\n![remote](https://example.com/a.png)\n\n![missing](missing.png)',
    '/tmp/sample.md',
  );
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].line, 3);
  assert.match(result.html, /Image error/);
  assert.equal(result.resources.size, 0);
});
test('raw HTML cannot execute scripts or fetch resources', async () => {
  const result = await renderMarkdown(
    '<script>alert(1)</script>\n\n<img src="https://example.com/x" onerror="alert(1)">\n\n<div style="background:url(https://example.com)">safe</div>',
    '/tmp/sample.md',
  );
  assert.doesNotMatch(result.html, /<script|<img|onerror=|style=/);
  assert.match(result.html, /safe/);
});
test('math failures are explicit; unknown code language falls back', async () => {
  const result = await renderMarkdown(
    '$\\notACommand{x}$\n\n```unknown-language\na < b\n```\n\n$$\nx+1',
    '/tmp/sample.md',
  );
  assert.equal(result.issues.length, 2);
  assert.match(result.html, /a &lt; b/);
});
test('math and Mermaid render without document scripts', async () => {
  const result = await renderMarkdown(
    '$x^2$\n\n```mermaid\ngraph TD\n A-->B\n```',
    '/tmp/sample.md',
  );
  assert.equal(result.issues.length, 0);
  assert.match(result.html, /katex/);
  assert.match(result.html, /class="mermaid" data-line="3"/);
});
test('bash highlighting and plain fences preserve commands', async () => {
  const result = await renderMarkdown(
    '```bash\necho "$HOME"\n```\n\n```\n  plain text\n```',
    '/tmp/sample.md',
  );
  assert.match(result.html, /shiki/);
  assert.match(result.html, /  plain text/);
});

test('GitHub alerts support all five types and rich content without showing markers', async () => {
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const result = await renderMarkdown(
      `> [!${kind}]\n> **Details** with $x^2$\n>\n> - First\n> - Second\n>\n> \`\`\`bash\n> echo hello\n> \`\`\``,
      '/tmp/alerts.md',
    );
    assert.match(
      result.html,
      new RegExp(`markdown-alert-${kind.toLowerCase()}`),
    );
    assert.match(result.html, /<strong>Details<\/strong>/);
    assert.match(result.html, /katex/);
    assert.match(result.html, /<ul>/);
    assert.match(result.html, /shiki/);
    assert.doesNotMatch(
      result.html,
      /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/,
    );
    assert.equal(result.issues.length, 0);
  }
});
test('unknown, inline and nested alert markers remain ordinary quotes', async () => {
  for (const source of [
    '> [!UNKNOWN]\n> text',
    '> [!NOTE] text',
    '> quote\n>\n>> [!NOTE]\n>> nested',
    '- item\n\n  > [!TIP]\n  > nested',
  ]) {
    const result = await renderMarkdown(source, '/tmp/alerts.md');
    assert.doesNotMatch(result.html, /class="markdown-alert/);
    assert.match(result.html, /<blockquote>/);
  }
});
test('alert marker removal preserves following content and error line numbers', async () => {
  const result = await renderMarkdown(
    '> [!NOTE]\n> ![missing](missing.png)\n\n> [!TIP]\n\nAfter alert',
    '/tmp/alerts.md',
  );
  assert.equal(result.issues[0].line, 2);
  assert.match(result.html, /markdown-alert-tip/);
  assert.match(result.html, /<p>After alert<\/p>/);
});
