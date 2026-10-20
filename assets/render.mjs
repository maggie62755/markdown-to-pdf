export async function render() {
  const issues = [];
  const mark = (el, kind, message) => {
    const issue = {
      kind,
      line: Number(el.getAttribute('data-line')) || undefined,
      message,
    };
    issues.push(issue);
    const div = document.createElement('div');
    div.className = 'issue';
    div.textContent = `[${kind}${issue.line ? `, line ${issue.line}` : ''}] ${message}`;
    el.replaceWith(div);
  };
  const diagrams = document.querySelectorAll('.mermaid');
  if (diagrams.length) {
    // Load the controlled renderer only for documents that contain diagrams.
    const moduleUrl = '/assets/mermaid/mermaid.esm.min.mjs';
    const mermaid = (await import(moduleUrl)).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: 'Noto Sans TC',
      maxTextSize: 50000,
      suppressErrorRendering: true,
    });
    for (const el of diagrams) {
      try {
        const { svg } = await mermaid.render(
          `svg-${el.id}`,
          el.textContent || '',
        );
        el.innerHTML = svg;
      } catch (e) {
        mark(el, 'Mermaid error', String(e));
      }
    }
  }
  for (const img of document.querySelectorAll('img')) {
    try {
      await img.decode();
    } catch {
      mark(img, 'Image error', 'The image could not be decoded');
    }
  }
  await document.fonts.ready;
  for (const pre of document.querySelectorAll('pre'))
    if (pre.getBoundingClientRect().height < window.innerHeight * 0.9)
      pre.classList.add('short');
  for (const el of document.querySelectorAll('.katex-display')) {
    if (el.scrollWidth > el.clientWidth)
      el.style.fontSize = `${Math.max(0.3, el.clientWidth / el.scrollWidth)}em`;
  }
  return issues;
}
