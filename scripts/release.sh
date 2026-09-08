#!/bin/bash
# Usage: ./scripts/release.sh 1.4.0
# Does: bump version → commit → tag → push → triggers GitHub Actions release

set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.4.0"
  exit 1
fi

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must be semver (e.g. 1.4.0)"
  exit 1
fi

# Check clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

CURRENT=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT"
echo "New version:     $VERSION"
echo ""

# Confirm
read -p "Release v$VERSION? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# 1. Bump package.json
npm version "$VERSION" --no-git-tag-version
echo "✓ package.json bumped to $VERSION"

# 2. Update Cloudflare Worker
WRANGLER="infra/cloudflare-worker/wrangler.toml"
if [ -f "$WRANGLER" ]; then
  sed -i "s/LATEST_VERSION = \".*\"/LATEST_VERSION = \"$VERSION\"/" "$WRANGLER"
  echo "✓ Cloudflare Worker LATEST_VERSION updated"
fi

# 3. Commit + tag
git add -A
git commit --no-verify -m "chore: bump version to $VERSION"
git tag "v$VERSION"
echo "✓ Committed and tagged v$VERSION"

# 4. Push
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH" --tags
echo "✓ Pushed to origin/$BRANCH with tag v$VERSION"

# 5. Deploy Cloudflare Worker
if [ -f "$WRANGLER" ]; then
  echo ""
  echo "Deploying Cloudflare Worker..."
  (cd infra/cloudflare-worker && npx wrangler deploy 2>/dev/null) && echo "✓ Worker deployed" || echo "⚠ Worker deploy failed (run manually: cd infra/cloudflare-worker && npx wrangler deploy)"
fi

echo ""
echo "Done! GitHub Actions will build installers for Windows, macOS, and Linux."
echo "Check: https://github.com/matbel91765/filarg/actions"
