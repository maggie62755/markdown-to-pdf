export async function start(base) {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  $('settings').onclick = () => vscode.postMessage({ type: 'settings' });
  $('issues').onclick = () => vscode.postMessage({ type: 'issues' });
  $('activity').onclick = () => {
    $('more').open = !$('more').open;
  };
  const reflectStatus = () => {
    const text = $('status').textContent;
    document.body.dataset.state = text.startsWith('Preview failed')
      ? 'error'
      : text.includes(' rendered')
        ? 'ready'
        : 'busy';
    $('activity').textContent =
      document.body.dataset.state === 'error' ? '!' : '…';
    $('activity').title = text;
  };
  new MutationObserver(reflectStatus).observe($('status'), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  document.addEventListener('click', (event) => {
    if (
      !$('more').contains(event.target) &&
      !$('activity').contains(event.target)
    )
      $('more').open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('more').open = false;
      document.querySelector('#more summary').focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      $('more').open = true;
      $('search').focus();
    }
  });

  let doc, task, worker, workerUrl, renderTask, textTask;
  let revision = 0,
    generation = 0,
    current = 1,
    scale = 1,
    busy = true;
  let sections = [],
    rendering = false,
    rerun = false,
    pending = Promise.resolve();
  let searchGeneration = 0,
    searchPage = 0,
    query = '',
    issueCount = 0;
  const fail = (message) => {
    busy = true;
    $('confirm').disabled = true;
    $('status').textContent = 'Preview failed: ' + message;
  };
  $('cancel').onclick = () => vscode.postMessage({ type: 'cancel' });
  $('confirm').onclick = () => {
    if (!busy) {
      $('confirm').disabled = true;
      vscode.postMessage({ type: 'confirm', revision });
    }
  };
  function jump(n) {
    current = Math.max(1, Math.min(sections.length, Number(n) || 1));
    $('page').value = current;
    sections[current - 1]?.scrollIntoView({ block: 'start' });
    schedule();
  }
  $('page').onchange = () => jump($('page').value);
  $('previous').onclick = () => jump(current - 1);
  $('next').onclick = () => jump(current + 1);
  function clear(section) {
    section.querySelectorAll('canvas').forEach((canvas) => {
      canvas.width = 0;
      canvas.height = 0;
    });
    section.replaceChildren();
    delete section.dataset.rendered;
  }
  function resize() {
    if (!doc) return;
    scale =
      $('zoom').value === 'fit'
        ? Math.max(
            0.2,
            Math.min(
              2,
              ($('pages').clientWidth - 20) / sections[0].originalWidth,
            ),
          )
        : Number($('zoom').value);
    generation++;
    renderTask?.cancel();
    textTask?.cancel();
    for (const section of sections) {
      clear(section);
      section.style.width = section.originalWidth * scale + 'px';
      section.style.height = section.originalHeight * scale + 'px';
      section.style.setProperty('--scale-factor', String(scale));
      section.style.setProperty('--total-scale-factor', String(scale));
    }
    jump(current);
  }
  $('zoom').onchange = resize;
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if ($('zoom').value === 'fit') resize();
    }, 150);
  });
  function highlight(section) {
    const spans = [...section.querySelectorAll('.textLayer span')];
    for (const span of spans) span.classList.remove('match');
    if (!query) return;
    const text = spans
      .map((span) => span.textContent)
      .join('')
      .toLocaleLowerCase();
    let match = text.indexOf(query),
      offset = 0;
    const ranges = [];
    while (match >= 0) {
      ranges.push([match, match + query.length]);
      match = text.indexOf(query, match + query.length);
    }
    for (const span of spans) {
      const end = offset + span.textContent.length;
      if (ranges.some(([a, b]) => offset < b && end > a))
        span.classList.add('match');
      offset = end;
    }
  }
  let api;
  function schedule() {
    rerun = true;
    if (!rendering) void drawVisible();
  }
  async function drawVisible() {
    if (!doc || !api) return;
    rendering = true;
    let drawingGeneration = generation;
    try {
      while (rerun) {
        rerun = false;
        drawingGeneration = generation;
        const run = generation,
          activeDoc = doc;
        const top = document
          .querySelector('header')
          .getBoundingClientRect().bottom;
        let nearest = 0,
          distance = Infinity;
        sections.forEach((section, i) => {
          const d = Math.abs(section.getBoundingClientRect().top - top);
          if (d < distance) {
            distance = d;
            nearest = i;
          }
        });
        current = nearest + 1;
        $('page').value = current;
        // Only the current page and two neighbors retain canvas/text layers.
        const wanted = new Set(
          [nearest - 1, nearest, nearest + 1].filter(
            (i) => i >= 0 && i < sections.length,
          ),
        );
        sections.forEach((section, i) => {
          if (!wanted.has(i)) clear(section);
        });
        for (const i of [nearest, nearest - 1, nearest + 1].filter((i) =>
          wanted.has(i),
        )) {
          const section = sections[i];
          if (section.dataset.rendered === 'true') continue;
          const page = await activeDoc.getPage(i + 1);
          if (run !== generation) break;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.ceil(viewport.width * ratio);
          canvas.height = Math.ceil(viewport.height * ratio);
          const layer = document.createElement('div');
          layer.className = 'textLayer';
          clear(section);
          section.append(canvas, layer);
          renderTask = page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
          });
          await renderTask.promise;
          if (run !== generation) break;
          textTask = new api.TextLayer({
            textContentSource: await page.getTextContent(),
            container: layer,
            viewport,
          });
          await textTask.render();
          if (run !== generation) break;
          section.dataset.rendered = 'true';
          highlight(section);
          page.cleanup();
          if (!busy) $('confirm').disabled = false;
          if (!busy)
            $('status').textContent =
              doc.numPages +
              ' pages · ' +
              sections.filter((s) => s.dataset.rendered === 'true').length +
              ' rendered' +
              (issueCount
                ? ' · ' + issueCount + ' issue(s); placeholders included'
                : '');
        }
      }
    } catch (e) {
      if (
        drawingGeneration === generation &&
        e?.name !== 'RenderingCancelledException' &&
        e?.name !== 'AbortException'
      )
        fail(String(e));
    } finally {
      rendering = false;
      if (rerun) schedule();
    }
  }
  $('pages').addEventListener('scroll', schedule, { passive: true });
  async function find() {
    const mine = ++searchGeneration,
      activeDoc = doc;
    query = $('search').value.toLocaleLowerCase();
    sections.forEach(highlight);
    if (!query || !activeDoc) {
      $('find-status').textContent = '';
      return;
    }
    $('find-status').textContent = 'Searching…';
    try {
      for (let i = 0; i < activeDoc.numPages; i++) {
        const n = (searchPage + i) % activeDoc.numPages;
        const page = await activeDoc.getPage(n + 1);
        const content = await page.getTextContent();
        if (mine !== searchGeneration || activeDoc !== doc) return;
        const found = content.items
          .map((item) => item.str || '')
          .join('')
          .toLocaleLowerCase()
          .includes(query);
        if (sections[n]?.dataset.rendered !== 'true') page.cleanup();
        if (found) {
          searchPage = (n + 1) % activeDoc.numPages;
          jump(n + 1);
          $('find-status').textContent = 'Match on page ' + (n + 1);
          return;
        }
      }
      $('find-status').textContent = 'No matches';
    } catch (e) {
      if (mine === searchGeneration)
        $('find-status').textContent = 'Search failed: ' + String(e);
    }
  }
  $('find').onclick = find;
  $('search').oninput = () => {
    searchGeneration++;
    searchPage = 0;
    query = '';
    sections.forEach(highlight);
    $('find-status').textContent = '';
  };
  $('search').onkeydown = (e) => {
    if (e.key === 'Enter') void find();
  };
  async function load(message, run) {
    if (run !== generation) return;
    renderTask?.cancel();
    textTask?.cancel();
    await task?.destroy();
    doc = undefined;
    if (run !== generation) return;
    const raw = atob(message.data);
    task = api.getDocument({
      data: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      isEvalSupported: false,
      cMapUrl: base + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
    });
    let timer;
    try {
      doc = await Promise.race([
        task.promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            void task.destroy();
            reject(new Error('Loading timed out after 20 seconds'));
          }, 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (run !== generation) return;
    revision = message.revision;
    issueCount = message.issues || 0;
    $('issues').hidden = !issueCount;
    $('issues').textContent = '⚠ ' + issueCount;
    $('issues').title =
      issueCount + ' issue(s) — show details and source locations';
    const page = await doc.getPage(1),
      viewport = page.getViewport({ scale: 1 });
    if (run !== generation) return;
    sections.forEach(clear);
    $('pages').replaceChildren();
    sections = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const section = document.createElement('section');
      section.dataset.page = n;
      section.setAttribute('aria-label', 'Page ' + n);
      section.originalWidth = viewport.width;
      section.originalHeight = viewport.height;
      sections.push(section);
      $('pages').append(section);
    }
    $('total').textContent = '/ ' + doc.numPages;
    $('page').max = doc.numPages;
    current = Math.min(current, doc.numPages);
    busy = false;
    resize();
  }
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!['busy', 'error', 'pdf'].includes(message?.type)) return;
    busy = true;
    $('confirm').disabled = true;
    generation++;
    searchGeneration++;
    renderTask?.cancel();
    textTask?.cancel();
    if (message.type === 'busy') {
      $('issues').hidden = true;
      $('status').textContent = message.message;
    } else if (message.type === 'error') fail(message.message);
    else {
      const run = generation;
      pending = pending
        .then(() => load(message, run))
        .catch((e) => {
          if (run === generation) fail(String(e));
        });
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      generation++;
      searchGeneration++;
      renderTask?.cancel();
      textTask?.cancel();
      void task?.destroy();
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    },
    { once: true },
  );
  try {
    const init = Promise.all([
      import(base + 'pdf.mjs'),
      fetch(base + 'pdf.worker.mjs'),
    ]);
    let timer;
    let response;
    try {
      [api, response] = await Promise.race([
        init,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Preview engine loading timed out')),
            20000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok)
      throw new Error('Could not load PDF worker (' + response.status + ')');
    workerUrl = URL.createObjectURL(
      new Blob([await response.text()], { type: 'text/javascript' }),
    );
    worker = new Worker(workerUrl, { type: 'module' });
    api.GlobalWorkerOptions.workerPort = worker;
    vscode.postMessage({ type: 'ready' });
  } catch (e) {
    fail(String(e));
  }
}
