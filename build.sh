#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

BASE_HREF="${1:-./}"

cd "$(dirname "$0")/web"
npm ci
npx tsc -b
npx vite build --base="$BASE_HREF"
