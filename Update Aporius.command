#!/bin/bash
# Kept for muscle memory. `npm run build` now refreshes the Dock app by itself,
# so this just runs a full build + sync from source.
cd "$(dirname "$0")/Aporius Actual Code Files" || exit 1
npm run build && echo "Aporius updated. You can close this window."
