#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_TAG:?Release tag is required}"
: "${GH_REPO:?Repository is required}"
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Expected a stable version tag such as v0.2.4." >&2
  exit 1
}

# Ubuntu 22.04 provides the Linux installer; Ubuntu 24.04 is an extra test runner.
assets=()
for target in darwin-arm64 darwin-x64 win32-x64 linux-x64; do
  asset="release-assets/markdown-to-pdf-${target}.vsix"
  [[ -s "$asset" ]] || { echo "Missing installer: $asset" >&2; exit 1; }
  assets+=("$asset")
done

if draft=$(gh release view "$RELEASE_TAG" --json isDraft --jq '.isDraft'); then
  if [[ "$draft" != true ]]; then
    echo "Release $RELEASE_TAG is already published; its assets will not be replaced." >&2
    exit 1
  fi
else
  gh release create "$RELEASE_TAG" --verify-tag --draft --generate-notes \
    --title "Easy Markdown to PDF $RELEASE_TAG"
fi

# Keep partial uploads in a draft. A failed upload can be retried by rerunning the job.
gh release upload "$RELEASE_TAG" "${assets[@]}" --clobber
gh release edit "$RELEASE_TAG" --draft=false
