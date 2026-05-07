#!/usr/bin/env bash
set -euo pipefail

# Build the full local viewer bundle for both Whales shots.
# Default mode is dry-run to avoid accidental long jobs.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=1
INCLUDE_ENV=1
SERVE=0
PORT=8000
RAW_DIR=""
ENV_NC=""
ENV_ALSO_NC=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/build_viewer_all.sh [--run] [--raw-dir DIR] [--serve] [--port PORT] [--skip-env]

Options:
  --run          Execute commands (default is dry-run preview only).
  --with-env     Export environmental artifacts (default; kept for compatibility).
  --skip-env     Do not export environmental artifacts.
  --raw-dir DIR  Raw data directory (default: data/raw, or raw if data/raw is absent).
  --env-nc FILE  Primary environmental NetCDF file (default: auto-detect under raw/environment).
  --serve        After a successful --run build, start the static viewer server.
  --port PORT    Port for --serve (default: 8000).
  -h, --help     Show this help.

Examples:
  bash scripts/build_viewer_all.sh
  bash scripts/build_viewer_all.sh --run
  bash scripts/build_viewer_all.sh --run --raw-dir raw
  bash scripts/build_viewer_all.sh --run --raw-dir raw --serve
  bash scripts/build_viewer_all.sh --run --raw-dir raw --skip-env --serve
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) DRY_RUN=0 ;;
    --with-env) INCLUDE_ENV=1 ;;
    --skip-env) INCLUDE_ENV=0 ;;
    --serve) SERVE=1 ;;
    --raw-dir)
      if [[ $# -lt 2 ]]; then
        echo "--raw-dir requires a directory path" >&2
        exit 2
      fi
      RAW_DIR="$2"
      shift
      ;;
    --env-nc)
      if [[ $# -lt 2 ]]; then
        echo "--env-nc requires a file path" >&2
        exit 2
      fi
      ENV_NC="$2"
      shift
      ;;
    --port)
      if [[ $# -lt 2 ]]; then
        echo "--port requires a value" >&2
        exit 2
      fi
      PORT="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

run_cmd() {
  local cmd="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] $cmd"
  else
    echo "[run] $cmd"
    eval "$cmd"
  fi
}

echo "Repo: $REPO_ROOT"
echo "Mode: $([[ "$DRY_RUN" -eq 1 ]] && echo "dry-run" || echo "execute")"
echo "Serve after build: $([[ "$SERVE" -eq 1 ]] && echo "yes (port $PORT)" || echo "no")"
echo "Environmental export: $([[ "$INCLUDE_ENV" -eq 1 ]] && echo "yes" || echo "no")"

if [[ ! -f "requirements.txt" ]]; then
  echo "requirements.txt not found. Run this script from the project repository." >&2
  exit 1
fi

if [[ ! -d "src" ]]; then
  echo "src/ directory not found. Repository layout is unexpected." >&2
  exit 1
fi

if [[ -z "$RAW_DIR" ]]; then
  if [[ -d "data/raw" ]]; then
    RAW_DIR="data/raw"
  elif [[ -d "raw" ]]; then
    RAW_DIR="raw"
  else
    RAW_DIR="data/raw"
  fi
fi

RAW_DIR="${RAW_DIR%/}"
export RAW_DATA_DIR="$RAW_DIR"
SHOT_SUBDIR="$RAW_DIR/2022-01-26--04--Whales"
HUMPBACK_H5="$SHOT_SUBDIR/2022-01-26--04-46-16--Humpback.h5"
ORCA_H5="$SHOT_SUBDIR/2022-01-26--04-47-42--Orca.h5"
SITUATION_H5="$RAW_DIR/Situation.h5"

echo "Raw data dir: $RAW_DIR"

if [[ ! -f "$HUMPBACK_H5" ]]; then
  if [[ -f "$RAW_DIR/2022-01-26--04-46-16--Humpback.h5" ]]; then
    HUMPBACK_H5="$RAW_DIR/2022-01-26--04-46-16--Humpback.h5"
  elif [[ -f "data/raw/2022-01-26--04-46-16--Humpback.h5" ]]; then
    HUMPBACK_H5="data/raw/2022-01-26--04-46-16--Humpback.h5"
  elif [[ -f "raw/2022-01-26--04-46-16--Humpback.h5" ]]; then
    HUMPBACK_H5="raw/2022-01-26--04-46-16--Humpback.h5"
  else
    echo "Missing Humpback H5. Tried:" >&2
    echo "  $SHOT_SUBDIR/2022-01-26--04-46-16--Humpback.h5" >&2
    echo "  $RAW_DIR/2022-01-26--04-46-16--Humpback.h5" >&2
    exit 1
  fi
fi

if [[ ! -f "$ORCA_H5" ]]; then
  if [[ -f "$RAW_DIR/2022-01-26--04-47-42--Orca.h5" ]]; then
    ORCA_H5="$RAW_DIR/2022-01-26--04-47-42--Orca.h5"
  elif [[ -f "data/raw/2022-01-26--04-47-42--Orca.h5" ]]; then
    ORCA_H5="data/raw/2022-01-26--04-47-42--Orca.h5"
  elif [[ -f "raw/2022-01-26--04-47-42--Orca.h5" ]]; then
    ORCA_H5="raw/2022-01-26--04-47-42--Orca.h5"
  else
    echo "Missing Orca H5. Tried:" >&2
    echo "  $SHOT_SUBDIR/2022-01-26--04-47-42--Orca.h5" >&2
    echo "  $RAW_DIR/2022-01-26--04-47-42--Orca.h5" >&2
    exit 1
  fi
fi

if [[ ! -f "$SITUATION_H5" ]]; then
  if [[ -f "Situation.h5" ]]; then
    SITUATION_H5="Situation.h5"
  elif [[ -f "data/raw/Situation.h5" ]]; then
    SITUATION_H5="data/raw/Situation.h5"
  elif [[ -f "raw/Situation.h5" ]]; then
    SITUATION_H5="raw/Situation.h5"
  else
    echo "Missing Situation.h5. Tried:" >&2
    echo "  $RAW_DIR/Situation.h5" >&2
    echo "  data/raw/Situation.h5" >&2
    echo "  raw/Situation.h5" >&2
    exit 1
  fi
fi

echo "Humpback H5: $HUMPBACK_H5"
echo "Orca H5: $ORCA_H5"
echo "Situation H5: $SITUATION_H5"

if [[ "$INCLUDE_ENV" -eq 1 ]]; then
  if [[ -z "$ENV_NC" ]]; then
    for cand in \
      "$RAW_DIR/environment/Models.delft3dflow_zurich_20220123.nc" \
      "$RAW_DIR/environment/Models.delft3dflow_zurich_20220130.nc" \
      "$RAW_DIR/Models.delft3dflow_zurich_20220123.nc" \
      "$RAW_DIR/Models.delft3dflow_zurich_20220130.nc" \
      "data/raw/environment/Models.delft3dflow_zurich_20220123.nc" \
      "data/raw/environment/Models.delft3dflow_zurich_20220130.nc" \
      "raw/environment/Models.delft3dflow_zurich_20220123.nc" \
      "raw/environment/Models.delft3dflow_zurich_20220130.nc"
    do
      if [[ -f "$cand" ]]; then
        ENV_NC="$cand"
        break
      fi
    done
  fi

  if [[ -z "$ENV_NC" || ! -f "$ENV_NC" ]]; then
    echo "Missing environmental NetCDF. Tried raw/environment/*.nc defaults." >&2
    echo "Expected one of:" >&2
    echo "  $RAW_DIR/environment/Models.delft3dflow_zurich_20220123.nc" >&2
    echo "  $RAW_DIR/environment/Models.delft3dflow_zurich_20220130.nc" >&2
    echo "Use --env-nc FILE, or --skip-env if you intentionally want the viewer without environment." >&2
    exit 1
  fi

  for cand in \
    "$RAW_DIR/environment/Models.delft3dflow_zurich_20220123.nc" \
    "$RAW_DIR/environment/Models.delft3dflow_zurich_20220130.nc" \
    "$RAW_DIR/Models.delft3dflow_zurich_20220123.nc" \
    "$RAW_DIR/Models.delft3dflow_zurich_20220130.nc"
  do
    if [[ -f "$cand" && "$cand" != "$ENV_NC" ]]; then
      ENV_ALSO_NC="--also-nc \"$cand\""
      break
    fi
  done
  echo "Environmental NetCDF: $ENV_NC"
fi

echo
echo "== 1) Install/refresh Python dependencies =="
run_cmd "python3 -m pip install -r requirements.txt"

echo
echo "== 2) Build base exports for whales shots (zip-free mode) =="
run_cmd "python3 src/ingest_prototype.py \"$HUMPBACK_H5\" output/shots/whales_humpback --situation \"$SITUATION_H5\""
run_cmd "python3 src/ingest_prototype.py \"$ORCA_H5\" output/shots/whales_orca --situation \"$SITUATION_H5\""
run_cmd "python3 src/visualize_export.py output/shots/whales_humpback figures/shots/whales_humpback"
run_cmd "python3 src/visualize_export.py output/shots/whales_orca figures/shots/whales_orca"

echo
echo "== 3) Build baseline events for each shot =="
run_cmd "python3 src/extract_events_baseline.py --shot-dir output/shots/whales_humpback"
run_cmd "python3 src/extract_events_baseline.py --shot-dir output/shots/whales_orca"

echo
echo "== 4) Preprocess DAS and build activity maps =="
run_cmd "python3 src/preprocess_das.py --shot whales_humpback --shot-path \"$HUMPBACK_H5\""
run_cmd "python3 src/preprocess_das.py --shot whales_orca --shot-path \"$ORCA_H5\""
run_cmd "python3 src/build_das_activity_map.py --shot whales_humpback"
run_cmd "python3 src/build_das_activity_map.py --shot whales_orca"

echo
echo "== 5) Assemble viewer manifests =="
run_cmd "python3 src/build_viewer_bundle.py"

echo
echo "== 6) Build selected-channel bundles for viewer =="
run_cmd "python3 src/build_selected_channel_bundle.py --shot whales_humpback"
run_cmd "python3 src/build_selected_channel_bundle.py --shot whales_orca"

echo
echo "== 7) Refresh viewer index after selected-channel patching =="
run_cmd "python3 src/build_viewer_bundle.py"

if [[ "$INCLUDE_ENV" -eq 1 ]]; then
  echo
  echo "== 8) Export environmental MVP artifacts =="
  run_cmd "python3 src/export_environmental_mvp.py --nc \"$ENV_NC\" $ENV_ALSO_NC"
fi

echo
echo "== Final readiness check =="
run_cmd "python3 src/check_viewer_ready.py"

echo
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run complete. Re-run with --run to execute."
else
  echo "Build pipeline complete."
  if [[ "$SERVE" -eq 1 ]]; then
    echo "Starting viewer from repo root:"
    echo "  http://localhost:$PORT/"
    python3 -m http.server "$PORT" --directory site
  else
    echo "Start viewer from repo root:"
    echo "  python3 -m http.server 8000 --directory site"
    echo "Open: http://localhost:8000/"
  fi
fi
