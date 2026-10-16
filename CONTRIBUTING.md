# Development guide

## Setup

Use Node.js 24 and npm on the operating system and architecture you intend to package.

```sh
npm ci
npm run prepare:browser
npm run build
```

Browser downloads happen during preparation, never during export. Press F5 in VS Code after building to open an Extension Development Host.

### Linux preparation

On Ubuntu 22.04 or 24.04 x64, install Chromium’s OS libraries before running tests or going offline:

```sh
node node_modules/playwright-core/cli.js install-deps chromium
```

This step requires network access and may request administrator privileges. The VSIX includes Chromium, but not these system libraries. End-user machines need equivalent libraries provisioned before offline use.

## Code layout

| Path                 | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `src/extension.ts`   | Commands, diagnostics, preview and save flow           |
| `src/markdown.ts`    | Markdown parsing, highlighting, math and local images  |
| `src/alerts.ts`      | GitHub-style alert parsing                             |
| `src/pdf.ts`         | Offline Chromium rendering and safe output replacement |
| `src/preview.ts`     | PDF.js Webview and confirmation                        |
| `assets/`            | Print CSS and controlled browser rendering code        |
| `fixtures/`          | Sample documents and error cases                       |
| `tests/`, `scripts/` | Unit and integration checks, build tools               |
| `docs/images/`       | Actual VS Code screenshots used by both READMEs        |

## Formatting and tests

```sh
npm run format
npm run format:check
npm run check
npm test
npm run build
npm run smoke
node scripts/bundle-check.cjs
node scripts/preview-check.mjs
```

The smoke test renders complete documents and checks cancellation preserves existing output. The bundle check verifies preview confirmation precedes the save dialog, cancellation, and command aliases. The preview check verifies the local worker, first-page rendering, lazy pages, confirmation, and cancellation.

Review PDFs in `output/pdf/` visually as well. File creation alone does not verify layout; the manual checks are in `ACCEPTANCE.md`.

## UI checks and screenshots

On macOS with VS Code installed in `/Applications`:

```sh
node scripts/vscode-preview-check.mjs
CAPTURE_SCREENSHOTS=1 node scripts/vscode-preview-check.mjs
```

Set `VSCODE_EXECUTABLE` for a different executable path. The script uses an isolated profile in `.vendor/`, Quiet Light, and disabled Chat features. Screenshot mode opens `fixtures/quick-start.md` and writes `docs/images/context-menu.png`, `docs/images/pdf-preview.png`, and `docs/images/pdf-features.png`. Review these images before committing them. The script does not change your regular VS Code profile. Its native UI automation has only been tested on macOS.

## Packaging

```sh
npm run package
```

This builds once, verifies bundled Chromium can launch, then creates `markdown-to-pdf-<platform>-<architecture>.vsix`. Use this command instead of invoking `vsce` directly. Supported package targets are `darwin-arm64`, `darwin-x64`, `win32-x64`, and `linux-x64`; prepare the browser on each target machine.

The **Package** GitHub Actions workflow can be triggered manually after uploading the repository. Each native runner prepares Chromium, checks code, renders sample PDFs, exercises export/preview, and uploads artifacts. CI is not a replacement for installing the VSIX and testing native save dialogs and offline use on actual target devices.

## Preparing a GitHub repository

- Commit sources, the lockfile, configuration, fixtures, documentation, and `docs/images/`.
- Generated folders (`node_modules/`, `dist/`, `.vendor/`, `tmp/`, `output/`), test coverage, caches, local environment files, personal editor settings, and VSIX files are ignored. Shared `.vscode/launch.json`, the lockfile, fixtures, and README screenshots belong in Git. Distribute VSIX files through GitHub Release assets or workflow artifacts instead of committing large binaries.
- `package.json` points to `maggie62755/markdown-to-pdf`. Keep `repository`, `bugs`, `homepage`, and README clone commands synchronized if the repository moves.
- Keep relative links in the source README for GitHub. VSIX packaging rewrites them to public GitHub URLs on the `main` branch (raw URLs for images, blob URLs for documents). Push referenced images and documents before distributing a VSIX; the extension Details page needs network access to display these remote images. PDF preview and export remain local and offline.
- Keep platform validation status accurate; Windows, Ubuntu and Intel Mac native acceptance is still pending.
- This project currently uses the local publisher identifier `local-tools`; Marketplace publication requires a separately configured publisher and release process.
