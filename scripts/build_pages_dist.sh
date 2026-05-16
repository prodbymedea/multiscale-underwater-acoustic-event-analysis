#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DIST_DIR="pages-dist"
LIST_FILE="scripts/pages_output_files.txt"

if [[ ! -f "$LIST_FILE" ]]; then
  echo "Missing $LIST_FILE" >&2
  exit 1
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Copy static site shell (no runtime outputs yet).
rsync -a --delete --exclude='output' --exclude='output_samples' site/ "$DIST_DIR/"

# Keep fallback samples for graceful degraded mode.
if [[ -d "output_samples" ]]; then
  rsync -a output_samples/ "$DIST_DIR/output_samples/"
fi

mkdir -p "$DIST_DIR/output"

shopt -s nullglob
missing_count=0
copied_count=0

while IFS= read -r raw || [[ -n "$raw" ]]; do
  line="${raw%%#*}"
  line="${line%$'\r'}"
  line="${line## }"
  line="${line%% }"
  [[ -z "$line" ]] && continue

  matches=( $line )
  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "[warn] No matches for: $line" >&2
    missing_count=$((missing_count + 1))
    continue
  fi

  for path in "${matches[@]}"; do
    if [[ -f "$path" ]]; then
      rsync -aR "$path" "$DIST_DIR/"
      copied_count=$((copied_count + 1))
    fi
  done
done < "$LIST_FILE"

required=(
  "$DIST_DIR/output/viewer_index.json"
  "$DIST_DIR/output/shots/whales_humpback/viewer_manifest.json"
  "$DIST_DIR/output/shots/whales_orca/viewer_manifest.json"
  "$DIST_DIR/output/environmental/environmental_map_fields.npz"
)

for req in "${required[@]}"; do
  if [[ ! -f "$req" ]]; then
    echo "Missing required artifact: $req" >&2
    exit 2
  fi
done

bytes=$(du -sk "$DIST_DIR" | awk '{print $1}')
echo "pages-dist built successfully"
echo "copied files: $copied_count"
echo "missing patterns: $missing_count"
echo "size: ${bytes} KiB"
