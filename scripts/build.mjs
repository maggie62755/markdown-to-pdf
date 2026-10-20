import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
await rm('dist/assets', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode', './playwright/index.js'],
});
await cp('node_modules/playwright-core', 'dist/playwright', {
  recursive: true,
});
await cp('node_modules/mermaid/dist', 'dist/assets/mermaid', {
  recursive: true,
  filter: (src) => !src.endsWith('.map') && !src.endsWith('.ts'),
});
await cp('node_modules/katex/dist', 'dist/assets/katex', { recursive: true });
for (const font of ['noto-sans-tc', 'jetbrains-mono']) {
  await cp(
    `node_modules/@fontsource/${font}/files`,
    `dist/assets/${font}/files`,
    {
      recursive: true,
      filter: (src) =>
        (!src.endsWith('.woff2') && !src.endsWith('.woff')) ||
        /-(400|700)-normal\.woff2?$/.test(src),
    },
  );
  let css = await readFile(`node_modules/@fontsource/${font}/400.css`, 'utf8');
  if (font === 'noto-sans-tc')
    css += await readFile(`node_modules/@fontsource/${font}/700.css`, 'utf8');
  await writeFile(`dist/assets/${font}/font.css`, css);
  await cp(
    `node_modules/@fontsource/${font}/LICENSE`,
    `dist/assets/${font}/LICENSE`,
  );
}
await cp('node_modules/pdfjs-dist/build', 'dist/assets/pdfjs', {
  recursive: true,
});
await cp(
  'node_modules/pdfjs-dist/standard_fonts',
  'dist/assets/pdfjs/standard_fonts',
  { recursive: true },
);
await cp('node_modules/pdfjs-dist/cmaps', 'dist/assets/pdfjs/cmaps', {
  recursive: true,
});
await cp('assets/render.mjs', 'dist/assets/render.mjs');
await cp('assets/print.css', 'dist/assets/print.css');
await rm('dist/browsers', { recursive: true, force: true });
try {
  await cp('.vendor/browsers', 'dist/browsers', { recursive: true });
} catch {
  console.warn(
    'Bundled Chromium is missing. Run npm run prepare:browser and rebuild.',
  );
}
const packages = await readdir('node_modules');
let licenses = '';
for (const name of packages.filter((n) => !n.startsWith('.'))) {
  const names = name.startsWith('@')
    ? (await readdir(`node_modules/${name}`)).map((n) => `${name}/${n}`)
    : [name];
  for (const n of names)
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
      try {
        licenses +=
          `\n\n=== ${n} ===\n` +
          (await readFile(`node_modules/${n}/${file}`, 'utf8'));
        break;
      } catch {}
    }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', licenses);

await cp('assets/viewer.mjs', 'dist/assets/pdfjs/viewer.mjs');
await cp(
  'node_modules/pdfjs-dist/web/pdf_viewer.css',
  'dist/assets/pdfjs/pdf_viewer.css',
);
