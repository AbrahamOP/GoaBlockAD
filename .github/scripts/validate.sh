#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for f in *.js .github/scripts/*.js tests/*.cjs; do node --check "$f"; done
node .github/scripts/check-i18n.js
node .github/scripts/validate-manifest.js
node --test tests/*.test.cjs
