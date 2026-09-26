#!/usr/bin/env bash

# ==============================================================================
# CIVIL-LEX Dedicated Hardware & LLM Concurrency Queue Monitor
# ==============================================================================
# Usage:
#   ./monitor.sh          (Live interactive dashboard in current terminal)
#   ./monitor.sh -t       (Open in dedicated tmux window)
#   ./monitor.sh -1       (Print single status snapshot and exit)

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/scripts/system_monitor.sh" "$@"
