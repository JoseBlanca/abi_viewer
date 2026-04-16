#!/usr/bin/env bash
# Build the ABI Viewer for deployment to GitHub Pages.
#
# Runs the full check (types + lint + tests) then builds the production
# bundle into dist/. The output can be copied to a GitHub Pages repo.
#
# Usage:
#   ./scripts/build-ghpages.sh
#   # Then copy dist/ contents to your GitHub Pages repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==> Installing dependencies"
npm ci

echo "==> Running checks (types + lint + tests)"
npm run check

echo "==> Building for production"
npm run build

echo ""
echo "Build complete. Output in: $PROJECT_DIR/dist/"
echo ""
echo "To deploy to GitHub Pages:"
echo "  cp -r dist/* /path/to/bioinfcomav.github.io/abi-viewer/"
echo "  cd /path/to/bioinfcomav.github.io && git add abi-viewer/ && git commit && git push"
