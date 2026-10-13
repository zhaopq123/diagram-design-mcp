#!/data/data/com.termux/files/usr/bin/bash
# Launch the diagram MCP server. Sources config.env next to the project root.
#
# Deliberately a foreground `exec`: under proot/Termux there is no init system,
# so the supervisor (tmux loop, runit, whatever the host uses) owns restarts.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

# `set -a` (allexport) matters: a bare `. config.env` assigns *shell* variables,
# which never reach the node child. That silently dropped every knob except the
# three that were exported by hand — DIAGRAM_MCP_IDLE_MS and
# DIAGRAM_MCP_MAX_SESSIONS sat in config.env doing nothing while /health reported
# the compiled-in defaults. Export everything the file defines, then turn it off.
if [ -f "$DIR/config.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$DIR/config.env"
  set +a
fi

if [ -z "${DIAGRAM_MCP_TOKEN:-}" ]; then
  echo "DIAGRAM_MCP_TOKEN 未设置——请在 $DIR/config.env 里配置后重试。" >&2
  exit 2
fi

export DIAGRAM_MCP_PORT="${DIAGRAM_MCP_PORT:-8400}"
export DIAGRAM_MCP_BIND="${DIAGRAM_MCP_BIND:-0.0.0.0}"
export DIAGRAM_MCP_TOKEN

exec node "$DIR/src/server.mjs"
