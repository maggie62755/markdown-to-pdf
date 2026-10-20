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

| Path                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `src/extension.ts`   | Commands, diagnostics, preview and save flow                   |
| `src/markdown.ts`    | Markdown parsing, highlighting, math and local images          |
| `src/alerts.ts`      | GitHub-style alert parsing                                     |
| `src/pdf.ts`         | Offline Chromium rendering and safe output replacement         |
| `src/layout.ts`      | Validated layout defaults, print geometry and footer styles    |
| `src/settings.ts`    | Draft settings panel, color pickers, Save/Discard and defaults |
| `assets/viewer.mjs`  | PDF text layers, navigation, search and bounded page rendering |
| `src/preview.ts`     | PDF.js Webview and confirmation                                |
| `assets/`            | Print CSS and controlled browser rendering code                |
| `fixtures/`          | Sample documents and error cases                               |
| `tests/`, `scripts/` | Unit and integration checks, build tools                       |
| `docs/images/`       | README screenshots, static PNG badges and logo                 |

## Settings behavior

The preview toolbar opens PDF Settings. All field edits, color choices and resets stay in the form until Save; Discard restores saved values, and closing the tab does not save. Keep the color sample responsive without writing configuration during draft edits. Validate the entire submitted draft before writing changed fields to the selected User/Workspace/Folder scope. The native VS Code settings editor retains its normal immediate-save behavior.

Defaults in `package.json` and `src/layout.ts` must agree; `src/settings.ts` reuses the layout defaults. Source edits refresh the preview after a 500 ms pause. Saved configuration changes also refresh it, and an older preview must never be exported after a newer edit.

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
TEST_PREVIEW_FAIL=module node scripts/preview-check.mjs
TEST_PREVIEW_FAIL=worker node scripts/preview-check.mjs
node --import tsx scripts/readme-check.ts
```

The smoke test renders complete documents and checks cancellation preserves existing output. The bundle check verifies preview confirmation precedes the save dialog, cancellation, live document/settings changes, stale preview rejection, and the single export command. The preview check verifies the local worker, first-page rendering, bounded page retention, zoom, navigation, text layers, search, live replacement, confirmation, and cancellation.

The environment-variable commands above use POSIX shell syntax; in PowerShell set `$env:TEST_PREVIEW_FAIL` before running the script and remove it afterward.

Review PDFs in `output/pdf/` visually as well. File creation alone does not verify layout; the manual checks are in `ACCEPTANCE.md`.

## UI checks and screenshots

On macOS with VS Code installed in `/Applications`:

```sh
node scripts/vscode-preview-check.mjs
CAPTURE_SCREENSHOTS=1 node scripts/vscode-preview-check.mjs
```

Set `VSCODE_EXECUTABLE` for a different executable path. The script uses an isolated profile in `.vendor/`, Quiet Light, and disabled Chat features. Screenshot mode opens `fixtures/quick-start.md` and writes `docs/images/context-menu.png`, `docs/images/pdf-preview.png`, and `docs/images/pdf-features.png`. Review these images before committing them. The script does not change your regular VS Code profile. Normal mode also verifies the PDF Settings panel: all 12 defaults, color pickers, draft edits/resets that do not write before Save, Save applying changes, and Discard restoring saved values. Its native UI automation has only been tested on macOS.

## Packaging

```sh
npm run package
```

This builds once, verifies bundled Chromium can launch, then creates `markdown-to-pdf-<platform>-<architecture>.vsix`. Use this command instead of invoking `vsce` directly. Supported package targets are `darwin-arm64`, `darwin-x64`, `win32-x64`, and `linux-x64`; prepare the browser on each target machine.

The **Check** workflow runs on every pull request and pushes to `main`: formatting, type checks, unit tests, Chromium PDF smoke tests, export flow tests, and preview interaction/failure tests on Ubuntu.

The **Package** GitHub Actions workflow can be triggered manually after uploading the repository. Each native runner prepares Chromium, checks code, renders sample PDFs, exercises export/preview, and uploads artifacts. CI is not a replacement for installing the VSIX and testing native save dialogs and offline use on actual target devices.

## Preparing a GitHub repository

- Commit sources, the lockfile, configuration, fixtures, documentation, and `docs/images/`.
- Generated folders (`node_modules/`, `dist/`, `.vendor/`, `tmp/`, `output/`), test coverage, caches, local environment files, personal editor settings, and VSIX files are ignored. Shared `.vscode/launch.json`, the lockfile, fixtures, and README screenshots belong in Git. Distribute VSIX files through GitHub Release assets or workflow artifacts instead of committing large binaries.
- `package.json` points to `maggie62755/markdown-to-pdf`. Keep `repository`, `bugs`, `homepage`, and README clone commands synchronized if the repository moves.
- Keep relative links in the source README for GitHub. VSIX packaging rewrites them to public GitHub URLs on the `main` branch (raw URLs for images, blob URLs for documents). Push referenced images and documents before distributing a VSIX; the extension Details page needs network access to display these remote images. PDF preview and export remain local and offline.
- Keep platform validation status accurate; Windows, Ubuntu and Intel Mac native acceptance is still pending.
- This project currently uses the local publisher identifier `local-tools`; Marketplace publication requires a separately configured publisher and release process.

### README images

Both READMEs use repository-relative PNG images, including the three static badges in `docs/images/badges/` and the 96 px logo in `docs/images/logo.png`. These work with the offline Markdown renderer and avoid remote badge requests. `docs/images/` is included in the VSIX.

After building, regenerate the static badge/logo assets with `node scripts/readme-assets.mjs`. Refresh UI screenshots with `CAPTURE_SCREENSHOTS=1 node scripts/vscode-preview-check.mjs`. Validate both READMEs offline with `node --import tsx scripts/readme-check.ts`; PDFs are written to `output/pdf/`.

Keep relative image paths in the source README. Packaging uses the repository in `package.json` and `--githubBranch main` to rewrite the Marketplace README image links to HTTPS GitHub raw URLs. Commit and push the images to `main` before publishing the extension; Marketplace images still require network access, while PDF conversion from the source checkout uses local files.

### Before uploading

1. Run formatting, type and relevant integration checks above; inspect the generated PDFs and screenshots.
2. Include all changed source files, scripts, Markdown files and new `docs/images/` PNGs in the commit. Do not commit generated VSIX/PDF files or `dist/`.
3. Push documentation and image assets to `main` before publishing a Marketplace listing that references them.
4. Confirm the GitHub Check workflow passes. Keep untested platform claims marked as pending.
5. If distributing a VSIX after documentation changes, rerun `npm run package`; use a release asset for the binary. Marketplace publication additionally needs a configured publisher; uploading this Git repository does not publish the extension.
