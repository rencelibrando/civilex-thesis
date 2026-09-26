#!/usr/bin/env bash

# CIVIL-LEX Multi-Service Unified Controller & Process Manager
# Manages Frontend (Next.js), Backend (Node.js), and Python RAG Service (FastAPI)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env" 2>/dev/null || true
  set +a
fi
LOG_DIR="${ROOT_DIR}/.logs"
mkdir -p "${LOG_DIR}"

FRONTEND_LOG="${LOG_DIR}/frontend.log"
BACKEND_LOG="${LOG_DIR}/backend.log"
PYTHON_LOG="${LOG_DIR}/python-rag.log"
TUNNEL_LOG="${LOG_DIR}/tunnel.log"

FRONTEND_PID_FILE="${LOG_DIR}/frontend.pid"
BACKEND_PID_FILE="${LOG_DIR}/backend.pid"
PYTHON_PID_FILE="${LOG_DIR}/python-rag.pid"
TUNNEL_PID_FILE="${LOG_DIR}/tunnel.pid"


SESSION="civilex"

# ANSI Colors & Style Tokens
BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
MAGENTA="\033[35m"
RESET="\033[0m"
DIM="\033[2m"
HIDE_CURSOR="\033[?25l"
SHOW_CURSOR="\033[?25h"
CLEAR_SCREEN="\033[2J\033[H"
HOME_CURSOR="\033[H"
CLEAR_LINE="\033[K"

# Terminal Restoration Handler
restore_terminal() {
  printf "${SHOW_CURSOR}" 2>/dev/null || true
  stty echo 2>/dev/null || true
}

# Pre-flight Requirements & Environment Verification
validate_environment() {
  local errors=0

  echo -e "${CYAN}[i] Checking environment requirements...${RESET}"

  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[✘] Error: Node.js is not installed or not in PATH.${RESET}"
    errors=$((errors + 1))
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}[✘] Error: npm is not installed or not in PATH.${RESET}"
    errors=$((errors + 1))
  fi

  if [ ! -d "${ROOT_DIR}/frontend" ]; then
    echo -e "${RED}[✘] Error: Directory 'frontend' not found in ${ROOT_DIR}.${RESET}"
    errors=$((errors + 1))
  elif [ ! -f "${ROOT_DIR}/frontend/package.json" ]; then
    echo -e "${RED}[✘] Error: 'frontend/package.json' missing.${RESET}"
    errors=$((errors + 1))
  fi

  if [ ! -d "${ROOT_DIR}/backend-node" ]; then
    echo -e "${RED}[✘] Error: Directory 'backend-node' not found in ${ROOT_DIR}.${RESET}"
    errors=$((errors + 1))
  elif [ ! -f "${ROOT_DIR}/backend-node/package.json" ]; then
    echo -e "${RED}[✘] Error: 'backend-node/package.json' missing.${RESET}"
    errors=$((errors + 1))
  fi

  if [ ! -d "${ROOT_DIR}/service-rag-python" ]; then
    echo -e "${RED}[✘] Error: Directory 'service-rag-python' not found in ${ROOT_DIR}.${RESET}"
    errors=$((errors + 1))
  else
    if [ ! -d "${ROOT_DIR}/service-rag-python/.venv" ] && [ ! -d "${ROOT_DIR}/service-rag-python/venv" ]; then
      echo -e "${YELLOW}[!] Warning: Virtualenv (.venv or venv) missing in 'service-rag-python'.${RESET}"
      echo -e "${YELLOW}    Please run: cd service-rag-python && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt${RESET}"
    fi
  fi

  if [ $errors -gt 0 ]; then
    echo -e "${RED}[✘] Pre-flight checks failed with ${errors} error(s). Aborting.${RESET}"
    exit 1
  fi

  echo -e "${GREEN}[✔] Pre-flight checks passed.${RESET}"
}

# PID Helper Functions (Persistent across subshells and tmux panes)
read_service_pid() {
  local pid_file=$1
  if [ -f "$pid_file" ]; then
    cat "$pid_file" 2>/dev/null || true
  fi
}

is_pid_alive() {
  local pid=$1
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

# Port Checking
check_port_raw() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" 2>/dev/null
  else
    (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

check_port() {
  local port=$1
  if check_port_raw "$port"; then
    echo "ONLINE"
  else
    echo "OFFLINE"
  fi
}

# Safe Port & Process Release
free_port_if_needed() {
  local port=$1
  local name=$2
  local attempts=0

  while [ $attempts -lt 5 ]; do
    if ! check_port_raw "$port"; then
      break
    fi

    # Strategy 1: lsof
    if command -v lsof >/dev/null 2>&1; then
      local pids
      pids=$(lsof -t -i:"${port}" 2>/dev/null || true)
      for pid in $pids; do
        if [ -n "$pid" ] && is_pid_alive "$pid"; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
    fi

    # Strategy 2: fuser
    if command -v fuser >/dev/null 2>&1; then
      fuser -k -9 "${port}/tcp" >/dev/null 2>&1 || true
    fi

    # Strategy 3: ss / socket statistics
    if command -v ss >/dev/null 2>&1; then
      local ss_pids
      ss_pids=$(ss -tulpn 2>/dev/null | grep -E "(:${port}\b)" | grep -o -E "pid=[0-9]+" | cut -d= -f2 || true)
      for pid in $ss_pids; do
        if [ -n "$pid" ] && is_pid_alive "$pid"; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
    fi

    sleep 0.3
    attempts=$((attempts + 1))
  done
}

kill_existing_processes() {
  echo -e "${CYAN}[+] Stopping any stray or existing service instances...${RESET}"

  # Terminate processes by recorded PID files first
  for pid_file in "${FRONTEND_PID_FILE}" "${BACKEND_PID_FILE}" "${PYTHON_PID_FILE}" "${TUNNEL_PID_FILE}"; do
    local pid
    pid=$(read_service_pid "$pid_file")
    if [ -n "$pid" ] && is_pid_alive "$pid"; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  done

  # Terminate stray dev processes matching command patterns
  pkill -9 -f "next dev" 2>/dev/null || true
  pkill -9 -f "nodemon index.js" 2>/dev/null || true
  pkill -9 -f "uvicorn.*8000" 2>/dev/null || true
  pkill -9 -f "uvicorn main:app" 2>/dev/null || true
  pkill -9 -f "devtunnel host" 2>/dev/null || true
  pkill -9 -f "start-azure-tunnel.sh" 2>/dev/null || true

  # Release ports cleanly
  free_port_if_needed 3000 "Frontend"
  free_port_if_needed 4000 "Backend Node"
  free_port_if_needed 8000 "Python RAG"
}

# Service Launchers
start_frontend() {
  free_port_if_needed 3000 "Frontend"
  echo -e "${CYAN}[+] Starting Frontend (Next.js)...${RESET}"
  echo -e "\n=== [STARTED: $(date '+%Y-%m-%d %H:%M:%S')] ===" >> "${FRONTEND_LOG}"
  (
    cd "${ROOT_DIR}/frontend" || exit 1
    export FORCE_COLOR=1
    export COLORTERM=truecolor
    export NEXT_TELEMETRY_DISABLED=1
    exec npm run dev >> "${FRONTEND_LOG}" 2>&1
  ) &
  local pid=$!
  echo "$pid" > "${FRONTEND_PID_FILE}"
}

start_backend() {
  free_port_if_needed 4000 "Backend"
  echo -e "${GREEN}[+] Starting Backend (Node.js Express)...${RESET}"
  echo -e "\n=== [STARTED: $(date '+%Y-%m-%d %H:%M:%S')] ===" >> "${BACKEND_LOG}"
  (
    cd "${ROOT_DIR}/backend-node" || exit 1
    export FORCE_COLOR=1
    export COLORTERM=truecolor
    exec npm run dev >> "${BACKEND_LOG}" 2>&1
  ) &
  local pid=$!
  echo "$pid" > "${BACKEND_PID_FILE}"
}

start_python() {
  free_port_if_needed 8000 "Python RAG"
  echo -e "${MAGENTA}[+] Starting RAG Service (Python FastAPI/Uvicorn)...${RESET}"
  echo -e "\n=== [STARTED: $(date '+%Y-%m-%d %H:%M:%S')] ===" >> "${PYTHON_LOG}"
  (
    cd "${ROOT_DIR}/service-rag-python" || exit 1
    if [ -d ".venv" ]; then
      source .venv/bin/activate
    elif [ -d "venv" ]; then
      source venv/bin/activate
    fi

    export PYTHONUNBUFFERED=1
    export FORCE_COLOR=1
    export CLICOLOR_FORCE=1
    export PYTHONIOENCODING=utf-8

    if command -v uvicorn >/dev/null 2>&1; then
      exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload --use-colors >> "${PYTHON_LOG}" 2>&1
    elif [ -f ".venv/bin/uvicorn" ]; then
      exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload --use-colors >> "${PYTHON_LOG}" 2>&1
    elif [ -f "venv/bin/uvicorn" ]; then
      exec venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload --use-colors >> "${PYTHON_LOG}" 2>&1
    else
      echo "Error: uvicorn executable not found in PATH or virtualenv!" >> "${PYTHON_LOG}" 2>&1
      exit 1
    fi
  ) &
  local pid=$!
  echo "$pid" > "${PYTHON_PID_FILE}"
}

start_tunnel() {
  echo -e "${YELLOW}[+] Starting Azure Dev Tunnel (civilex-tunnel)...${RESET}"
  echo -e "\n=== [STARTED: $(date '+%Y-%m-%d %H:%M:%S')] ===" >> "${TUNNEL_LOG}"
  (
    exec "${ROOT_DIR}/scripts/start-azure-tunnel.sh" >> "${TUNNEL_LOG}" 2>&1
  ) &
  local pid=$!
  echo "$pid" > "${TUNNEL_PID_FILE}"
}

start_all_services() {
  start_frontend
  start_backend
  start_python
  start_tunnel
}

# Service Stoppers
stop_service() {
  local target=$1
  case "$target" in
    "frontend")
      local pid
      pid=$(read_service_pid "${FRONTEND_PID_FILE}")
      if [ -n "$pid" ] && is_pid_alive "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
        kill -- "-$pid" 2>/dev/null || true
      fi
      pkill -9 -f "next dev" 2>/dev/null || true
      rm -f "${FRONTEND_PID_FILE}"
      free_port_if_needed 3000 "Frontend"
      last_action_msg="${YELLOW}[!] Stopped Frontend (Next.js)${RESET}"
      ;;
    "backend")
      local pid
      pid=$(read_service_pid "${BACKEND_PID_FILE}")
      if [ -n "$pid" ] && is_pid_alive "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
        kill -- "-$pid" 2>/dev/null || true
      fi
      pkill -9 -f "nodemon index.js" 2>/dev/null || true
      rm -f "${BACKEND_PID_FILE}"
      free_port_if_needed 4000 "Backend"
      last_action_msg="${YELLOW}[!] Stopped Backend Node.js${RESET}"
      ;;
    "python")
      local pid
      pid=$(read_service_pid "${PYTHON_PID_FILE}")
      if [ -n "$pid" ] && is_pid_alive "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
        kill -- "-$pid" 2>/dev/null || true
      fi
      pkill -9 -f "uvicorn.*8000" 2>/dev/null || true
      pkill -9 -f "uvicorn main:app" 2>/dev/null || true
      rm -f "${PYTHON_PID_FILE}"
      free_port_if_needed 8000 "Python RAG"
      last_action_msg="${YELLOW}[!] Stopped Python RAG Service${RESET}"
      ;;
    "tunnel")
      local pid
      pid=$(read_service_pid "${TUNNEL_PID_FILE}")
      if [ -n "$pid" ] && is_pid_alive "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
        kill -- "-$pid" 2>/dev/null || true
      fi
      pkill -9 -f "devtunnel host" 2>/dev/null || true
      pkill -9 -f "start-azure-tunnel.sh" 2>/dev/null || true
      rm -f "${TUNNEL_PID_FILE}"
      last_action_msg="${YELLOW}[!] Stopped Azure Dev Tunnel${RESET}"
      ;;
    "all")
      stop_service "frontend"
      stop_service "backend"
      stop_service "python"
      stop_service "tunnel"
      last_action_msg="${YELLOW}[!] Stopped all background services${RESET}"
      ;;
  esac
}

stop_all_services() {
  stop_service "all"
}

# Status Badges
get_status_badge() {
  local status=$1
  local pid_file=$2
  local log_file=$3

  local recorded_pid
  recorded_pid=$(read_service_pid "$pid_file")

  if [ "$status" == "ONLINE" ]; then
    if [ -n "$recorded_pid" ] && is_pid_alive "$recorded_pid"; then
      echo -e "${GREEN}● ONLINE ${DIM}(PID ${recorded_pid})${RESET}"
    else
      echo -e "${GREEN}● ONLINE${RESET}"
    fi
  elif [ -n "$recorded_pid" ] && ! is_pid_alive "$recorded_pid"; then
    echo -e "${RED}● CRASHED (check ${log_file})${RESET}"
  elif [ -n "$recorded_pid" ]; then
    echo -e "${YELLOW}○ STARTING / CONNECTING ${DIM}(PID ${recorded_pid})${RESET}"
  else
    echo -e "${DIM}○ STOPPED${RESET}"
  fi
}

get_tunnel_badge() {
  local pid
  pid=$(read_service_pid "${TUNNEL_PID_FILE}")
  if [ -z "$pid" ]; then
    pid=$(pgrep -f "devtunnel host" | head -n 1)
  fi

  if [ -n "$pid" ] && is_pid_alive "$pid"; then
    echo -e "${GREEN}● ONLINE ${DIM}(civilex-tunnel, PID ${pid})${RESET}"
  else
    echo -e "${DIM}○ STOPPED${RESET}"
  fi
}

# Utility Actions
clear_logs() {
  > "${FRONTEND_LOG}"
  > "${BACKEND_LOG}"
  > "${PYTHON_LOG}"
  > "${TUNNEL_LOG}"
  last_action_msg="${GREEN}[✔] All log files truncated successfully.${RESET}"
}

copy_active_log_to_clipboard() {
  local target_log=""
  case "$active_view" in
    "frontend") target_log="${FRONTEND_LOG}" ;;
    "backend") target_log="${BACKEND_LOG}" ;;
    "python") target_log="${PYTHON_LOG}" ;;
    "tunnel") target_log="${TUNNEL_LOG}" ;;
    *) target_log="${FRONTEND_LOG}" ;;
  esac

  if [ -f "$target_log" ]; then
    if command -v wl-copy >/dev/null 2>&1; then
      tail -n 100 "$target_log" | wl-copy 2>/dev/null || true
      last_action_msg="${GREEN}[✔] Copied last 100 log lines to system clipboard (Wayland)!${RESET}"
    elif command -v xclip >/dev/null 2>&1; then
      tail -n 100 "$target_log" | xclip -selection clipboard -i 2>/dev/null || true
      last_action_msg="${GREEN}[✔] Copied last 100 log lines to system clipboard (X11)!${RESET}"
    elif command -v xsel >/dev/null 2>&1; then
      tail -n 100 "$target_log" | xsel -i -b 2>/dev/null || true
      last_action_msg="${GREEN}[✔] Copied last 100 log lines to system clipboard!${RESET}"
    else
      last_action_msg="${YELLOW}[!] No clipboard utility (wl-copy/xclip/xsel) found on system.${RESET}"
    fi
  fi
}

open_url() {
  local url=$1
  local name=$2
  last_action_msg="${CYAN}[🌐] Opening ${name} (${url}) in browser...${RESET}"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "$url" >/dev/null 2>&1 &
  fi
}

# Non-interactive CLI Status Output
print_cli_status() {
  local fe_st
  local be_st
  local py_st
  fe_st=$(check_port 3000)
  be_st=$(check_port 4000)
  py_st=$(check_port 8000)

  local fe_pid
  local be_pid
  local py_pid
  fe_pid=$(read_service_pid "${FRONTEND_PID_FILE}")
  be_pid=$(read_service_pid "${BACKEND_PID_FILE}")
  py_pid=$(read_service_pid "${PYTHON_PID_FILE}")

  echo -e "${BOLD}CIVIL-LEX Service Status:${RESET}"
  echo -e "  Frontend (Next.js)    : Port 3000 | PID: ${fe_pid:-OFF} | Status: $(get_status_badge "$fe_st" "${FRONTEND_PID_FILE}" "${FRONTEND_LOG}")"
  echo -e "  Backend (Node Express): Port 4000 | PID: ${be_pid:-OFF} | Status: $(get_status_badge "$be_st" "${BACKEND_PID_FILE}" "${BACKEND_LOG}")"
  echo -e "  Python RAG (FastAPI)  : Port 8000 | PID: ${py_pid:-OFF} | Status: $(get_status_badge "$py_st" "${PYTHON_PID_FILE}" "${PYTHON_LOG}")"
  local tu_badge
  tu_badge=$(get_tunnel_badge)
  echo -e "  Azure Dev Tunnel      : civilex-tunnel | Status: ${tu_badge}"
  if [[ "$tu_badge" == *"ONLINE"* ]]; then
    echo -e "    ↳ Backend API  (Port 4000) : https://w21xbn22-4000.asse.devtunnels.ms"
    echo -e "    ↳ Python RAG   (Port 8000) : https://w21xbn22-8000.asse.devtunnels.ms"
    echo -e "    ↳ Supabase API (Port 54321): https://w21xbn22-54321.asse.devtunnels.ms"
  fi
}

# CLI Help Usage
show_usage() {
  echo -e "${BOLD}CIVIL-LEX Service Manager${RESET}"
  echo -e "Usage: ./start.sh [OPTION]"
  echo -e ""
  echo -e "Options:"
  echo -e "  ${BOLD}(no args)${RESET}         Start services and open interactive terminal controller"
  echo -e "  ${BOLD}-t, --tmux${RESET}        Launch or attach to 4-pane tmux dashboard"
  echo -e "  ${BOLD}-s, --status${RESET}      Print current service statuses and exit"
  echo -e "  ${BOLD}-k, --stop${RESET}        Stop all running services and free ports"
  echo -e "  ${BOLD}-c, --controller${RESET}  Open interactive controller without restarting services"
  echo -e "  ${BOLD}-h, --help${RESET}        Show this help message"
  echo -e ""
  echo -e "Interactive Controller Keybindings:"
  echo -e "  [1-4] Stream Service Logs   [5] Stream Combined Logs   [s] Status Screen"
  echo -e "  [f] Restart Frontend        [b] Restart Backend        [p] Restart Python RAG"
  echo -e "  [u] Restart Azure Tunnel    [a] Restart All Services   [k] Stop All Services"
  echo -e "  [c] Clear Logs              [t] Open Tmux Dashboard    [y] Copy Log to Clipboard"
  echo -e "  [o] Open Web App            [d] Open FastAPI Docs      [h] Help Legend"
  echo -e "  [q] Quit & Shutdown"
}

# Tmux Mode (4-Pane Split with Live Interactive Controller)
launch_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo -e "${RED}[!] tmux is not installed on this system. Falling back to standard interactive menu.${RESET}"
    sleep 2
    run_controller
    return
  fi

  # Start background services if any are stopped
  touch "${FRONTEND_LOG}" "${BACKEND_LOG}" "${PYTHON_LOG}" "${TUNNEL_LOG}"
  local fe_pid
  local be_pid
  local py_pid
  local tu_pid
  fe_pid=$(read_service_pid "${FRONTEND_PID_FILE}")
  be_pid=$(read_service_pid "${BACKEND_PID_FILE}")
  py_pid=$(read_service_pid "${PYTHON_PID_FILE}")
  tu_pid=$(read_service_pid "${TUNNEL_PID_FILE}")

  [ -z "$fe_pid" ] || ! is_pid_alive "$fe_pid" && start_frontend
  [ -z "$be_pid" ] || ! is_pid_alive "$be_pid" && start_backend
  [ -z "$py_pid" ] || ! is_pid_alive "$py_pid" && start_python
  [ -z "$tu_pid" ] || ! is_pid_alive "$tu_pid" && start_tunnel

  # Check if tmux session already exists
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    if [ -n "${TMUX:-}" ]; then
      echo -e "${GREEN}[✔] Already inside tmux. Switching to session '${SESSION}'...${RESET}"
      tmux switch-client -t "$SESSION" 2>/dev/null || true
      return
    else
      echo -e "${GREEN}[✔] Existing tmux session '${SESSION}' found. Attaching...${RESET}"
      echo -e "${DIM}(Press Ctrl+b d to detach without stopping services)${RESET}"
      tmux attach-session -t "$SESSION"
      echo -e "${GREEN}[✔] Detached from tmux session '${SESSION}'. Services remain running.${RESET}"
      return
    fi
  fi

  # Create a brand new tmux session and split into 4 balanced panes (0, 1, 2, 3)
  # Pane 0: Frontend Log stream (Top-Left)
  local P_FE
  P_FE=$(tmux new-session -d -P -F "#{pane_id}" -s "$SESSION" -n "CIVIL-LEX" "tail -F '${FRONTEND_LOG}'")

  # Tmux Ergonomics & Visual Configuration
  tmux set-option -t "$SESSION" -g mouse on
  tmux set-option -t "$SESSION" -g history-limit 20000
  tmux set-option -t "$SESSION" -g set-clipboard on
  tmux set-option -t "$SESSION" pane-border-status top
  tmux set-option -t "$SESSION" pane-border-format " #[bold]#{pane_index}: #{pane_title}#[default] "

  # Clipboard bindings (Wayland & X11)
  if command -v wl-copy >/dev/null 2>&1; then
    tmux bind-key -T copy-mode C-c send-keys -X copy-pipe "wl-copy"
    tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe "wl-copy"
    tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe "wl-copy"
  elif command -v xclip >/dev/null 2>&1; then
    tmux bind-key -T copy-mode C-c send-keys -X copy-pipe "xclip -selection clipboard -i"
    tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe "xclip -selection clipboard -i"
    tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe "xclip -selection clipboard -i"
  elif command -v xsel >/dev/null 2>&1; then
    tmux bind-key -T copy-mode C-c send-keys -X copy-pipe "xsel -i -b"
    tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe "xsel -i -b"
    tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe "xsel -i -b"
  fi

  # Pane 1: Backend Logs (Top-Right)
  local P_BE
  P_BE=$(tmux split-window -P -F "#{pane_id}" -t "$P_FE" "tail -F '${BACKEND_LOG}'")

  # Pane 2: Python RAG Logs (Mid-Left)
  local P_PY
  P_PY=$(tmux split-window -P -F "#{pane_id}" -t "$P_BE" "tail -F '${PYTHON_LOG}'")

  # Pane 3: Azure Dev Tunnel Logs (Mid-Right)
  local P_TU
  P_TU=$(tmux split-window -P -F "#{pane_id}" -t "$P_PY" "tail -F '${TUNNEL_LOG}'")

  # Pane 4: Interactive Controller (Bottom)
  local P_CTRL
  P_CTRL=$(tmux split-window -P -F "#{pane_id}" -t "$P_TU" "bash '${ROOT_DIR}/start.sh' --controller")

  # Arrange in a clean, perfectly balanced tiled grid
  tmux select-layout -t "$SESSION" tiled

  # Tag each pane accurately by its immutable pane ID
  tmux select-pane -t "$P_FE" -T "Frontend Logs (Port 3000)"
  tmux select-pane -t "$P_BE" -T "Backend Logs (Port 4000)"
  tmux select-pane -t "$P_PY" -T "Python RAG Logs (Port 8000)"
  tmux select-pane -t "$P_TU" -T "Azure Dev Tunnel Logs (w21xbn22)"
  tmux select-pane -t "$P_CTRL" -T "CIVIL-LEX Controller (Active Menu)"

  # Focus the interactive controller pane
  tmux select-pane -t "$P_CTRL"

  # Handle nesting vs standalone attach
  if [ -n "${TMUX:-}" ]; then
    echo -e "${GREEN}[✔] Created tmux session '${SESSION}'.${RESET}"
    tmux switch-client -t "$SESSION" 2>/dev/null || {
      echo -e "${YELLOW}[!] Nested inside tmux. Switch to session '${SESSION}' with: tmux switch-client -t ${SESSION}${RESET}"
    }
  else
    echo -e "${GREEN}[✔] Attaching to tmux session '${SESSION}'...${RESET}"
    echo -e "${DIM}(Press Ctrl+b d to detach without stopping services)${RESET}"
    tmux attach-session -t "$SESSION"
    echo -e "${GREEN}[✔] Detached from tmux session '${SESSION}'. Services remain running.${RESET}"
  fi
}

# Log Tail & Colorizer
tail_pid=""

stop_tail() {
  if [ -n "$tail_pid" ] && is_pid_alive "$tail_pid"; then
    kill "$tail_pid" 2>/dev/null || true
    tail_pid=""
  fi
}

colorize_logs() {
  sed -u \
    -e "s/\(▲ Next.js[^\x1b]*\)/\x1b[36m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(✓ Compiled[^\x1b]*\)/\x1b[32m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(✓[[:space:]]\+\)/\x1b[32m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(○ Compiling[^\x1b]*\)/\x1b[33m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(○[[:space:]]\+\)/\x1b[33m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(⨯[[:space:]]\+\)/\x1b[31m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(Failed to compile[^\x1b]*\)/\x1b[31m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(⚠[[:space:]]\+\)/\x1b[33m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(Fast Refresh[^\x1b]*\)/\x1b[35m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(INFO:\?[[:space:]]\+\)/\x1b[32m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(\[INFO\]\)/\x1b[32m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(WARNING:\?[[:space:]]\+\)/\x1b[33m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(\[WARNING\]\)/\x1b[33m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(WARN:\?[[:space:]]\+\)/\x1b[33m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(ERROR:\?[[:space:]]\+\)/\x1b[31m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(\[ERROR\]\)/\x1b[31m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(CRITICAL:\?[[:space:]]\+\)/\x1b[35m\x1b[1m\1\x1b[0m/g" \
    -e "s/\(DEBUG:\?[[:space:]]\+\)/\x1b[34m\1\x1b[0m/g" \
    -e "s/\([[:space:]]GET[[:space:]]\)/ \x1b[36m\x1b[1mGET\x1b[0m /g" \
    -e "s/\([[:space:]]POST[[:space:]]\)/ \x1b[35m\x1b[1mPOST\x1b[0m /g" \
    -e "s/\([[:space:]]PUT[[:space:]]\)/ \x1b[34m\x1b[1mPUT\x1b[0m /g" \
    -e "s/\([[:space:]]DELETE[[:space:]]\)/ \x1b[31m\x1b[1mDELETE\x1b[0m /g" \
    -e "s/\(\\"GET[^\\"]*\\"\)/\x1b[36m\1\x1b[0m/g" \
    -e "s/\(\\"POST[^\\"]*\\"\)/\x1b[35m\1\x1b[0m/g" \
    -e "s/\( 200 OK\| 200 \| 201 \| 304 \)/\x1b[32m\1\x1b[0m/g" \
    -e "s/\( 404 \| 400 \| 422 \)/\x1b[33m\1\x1b[0m/g" \
    -e "s/\( 500 \| 502 \| 503 \)/\x1b[31m\x1b[1m\1\x1b[0m/g"
}

# TUI Views & Rendering
active_view="status"
first_draw=true
last_action_msg=""

show_header() {
  if [ "$first_draw" = true ]; then
    printf "${CLEAR_SCREEN}${HIDE_CURSOR}"
    first_draw=false
  else
    printf "${HOME_CURSOR}${HIDE_CURSOR}"
  fi

  local fe_st
  local be_st
  local py_st
  fe_st=$(check_port 3000)
  be_st=$(check_port 4000)
  py_st=$(check_port 8000)

  echo -e "${BOLD}${BLUE}======================================================================${RESET}${CLEAR_LINE}"
  echo -e "${BOLD}${CYAN}                CIVIL-LEX MULTI-SERVICE CONTROLLER                   ${RESET}${CLEAR_LINE}"
  echo -e "${BOLD}${BLUE}======================================================================${RESET}${CLEAR_LINE}"
  
  echo -e " ${BOLD}1. Frontend (Next.js)${RESET}     : http://localhost:3000 | Status: $(get_status_badge "$fe_st" "${FRONTEND_PID_FILE}" "${FRONTEND_LOG}")${CLEAR_LINE}"
  echo -e " ${BOLD}2. Backend (Node.js)${RESET}     : http://localhost:4000 | Status: $(get_status_badge "$be_st" "${BACKEND_PID_FILE}" "${BACKEND_LOG}")${CLEAR_LINE}"
  echo -e " ${BOLD}3. RAG Service (Python)${RESET}  : http://localhost:8000 | Status: $(get_status_badge "$py_st" "${PYTHON_PID_FILE}" "${PYTHON_LOG}")${CLEAR_LINE}"
  local tu_badge
  tu_badge=$(get_tunnel_badge)
  echo -e " ${BOLD}4. Azure Dev Tunnel${RESET}      : civilex-tunnel | Status: ${tu_badge}${CLEAR_LINE}"
  if [[ "$tu_badge" == *"ONLINE"* ]]; then
    echo -e "    ${CYAN}↳ Backend API  (Port 4000) : https://w21xbn22-4000.asse.devtunnels.ms${RESET}${CLEAR_LINE}"
    echo -e "    ${MAGENTA}↳ Python RAG   (Port 8000) : https://w21xbn22-8000.asse.devtunnels.ms${RESET}${CLEAR_LINE}"
    echo -e "    ${GREEN}↳ Supabase API (Port 54321): https://w21xbn22-54321.asse.devtunnels.ms${RESET}${CLEAR_LINE}"
  fi
  echo -e "   ${DIM}↳ LLM Concurrency Limit :${RESET} ${YELLOW}${BOLD}${MAX_CONCURRENT_QUERIES:-1} Active Query per time${RESET} ${DIM}(Strict 6GB VRAM Queue Protection)${RESET}${CLEAR_LINE}"
  echo -e "${BLUE}----------------------------------------------------------------------${RESET}${CLEAR_LINE}"
  echo -e " ${BOLD}Controls & Hotkeys:${RESET}${CLEAR_LINE}"
  echo -e "   [${BOLD}1-4${RESET}] View Logs   [${BOLD}5${RESET}] Combined Logs   [${BOLD}s${RESET}] Status Screen   [${BOLD}c${RESET}] Clear Logs${CLEAR_LINE}"
  echo -e "   [${BOLD}f/b/p/u/a${RESET}] Restart Service (u: Tunnel)  [${BOLD}k${RESET}] Stop All${CLEAR_LINE}"
  echo -e "   [${BOLD}o${RESET}] Open App UI     [${BOLD}d${RESET}] Open API Docs    [${BOLD}m${RESET}] Monitor Screen [${BOLD}t${RESET}] Tmux Mode     [${BOLD}q${RESET}] Quit All${CLEAR_LINE}"
  echo -e "   [${BOLD}h${RESET}] Help Legend${CLEAR_LINE}"
  echo -e "${BLUE}======================================================================${RESET}${CLEAR_LINE}"
  
  if [ -n "$last_action_msg" ]; then
    echo -e " ${last_action_msg}${CLEAR_LINE}"
    echo -e "${BLUE}----------------------------------------------------------------------${RESET}${CLEAR_LINE}"
  fi
}

render_view() {
  stop_tail
  first_draw=true
  show_header

  case "$active_view" in
    "frontend")
      echo -e "${BOLD}${CYAN}--- LIVE LOGS: FRONTEND (Press 's' for Status, 'q' to Quit) ---${RESET}${CLEAR_LINE}"
      tail -n 25 -F "${FRONTEND_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "backend")
      echo -e "${BOLD}${GREEN}--- LIVE LOGS: BACKEND NODE (Press 's' for Status, 'q' to Quit) ---${RESET}${CLEAR_LINE}"
      tail -n 25 -F "${BACKEND_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "python")
      echo -e "${BOLD}${MAGENTA}--- LIVE LOGS: PYTHON RAG (Press 's' for Status, 'q' to Quit) ---${RESET}${CLEAR_LINE}"
      tail -n 25 -F "${PYTHON_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "tunnel")
      echo -e "${BOLD}${YELLOW}--- LIVE LOGS: AZURE DEV TUNNEL (Press 's' for Status, 'q' to Quit) ---${RESET}${CLEAR_LINE}"
      tail -n 25 -F "${TUNNEL_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "combined")
      echo -e "${BOLD}${YELLOW}--- LIVE COMBINED LOGS (Press 's' for Status, 'q' to Quit) ---${RESET}${CLEAR_LINE}"
      tail -n 15 -F "${FRONTEND_LOG}" "${BACKEND_LOG}" "${PYTHON_LOG}" "${TUNNEL_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "help")
      echo -e "${BOLD}${CYAN}--- CONTROL KEYBOARD SHORTCUTS HELP ---${RESET}${CLEAR_LINE}"
      echo -e "   ${BOLD}1${RESET} : Stream Frontend Logs        ${BOLD}f${RESET} : Restart Frontend${CLEAR_LINE}"
      echo -e "   ${BOLD}2${RESET} : Stream Backend Logs         ${BOLD}b${RESET} : Restart Backend${CLEAR_LINE}"
      echo -e "   ${BOLD}3${RESET} : Stream Python RAG Logs      ${BOLD}p${RESET} : Restart Python RAG${CLEAR_LINE}"
      echo -e "   ${BOLD}4${RESET} : Stream Azure Tunnel Logs    ${BOLD}u${RESET} : Restart Azure Tunnel${CLEAR_LINE}"
      echo -e "   ${BOLD}5${RESET} : Stream Combined Logs        ${BOLD}a${RESET} : Restart All Services${CLEAR_LINE}"
      echo -e "   ${BOLD}s${RESET} : View Service Status         ${BOLD}k${RESET} : Stop All Services${CLEAR_LINE}"
      echo -e "   ${BOLD}t${RESET} : Open Tmux Split Dashboard   ${BOLD}c${RESET} : Truncate / Clear Logs${CLEAR_LINE}"
      echo -e "   ${BOLD}y${RESET} : Copy Active Log to Clipboard ${BOLD}o${RESET} : Open App (localhost:3000)${CLEAR_LINE}"
      echo -e "   ${BOLD}d${RESET} : Open API Docs (localhost:8000/docs) ${BOLD}q${RESET} : Shutdown & Quit${CLEAR_LINE}"
      echo -e ""
      echo -e "  * Note: In Tmux mode or terminal, mouse drag or clipboard hotkeys copy directly.${CLEAR_LINE}"
      echo -e "  * Press 's' to return to Status view.${CLEAR_LINE}"
      ;;
    *)
      echo -e "${BOLD}${GREEN}All services managed automatically in background.${RESET}${CLEAR_LINE}"
      echo -e "${DIM}Logs directory: ${LOG_DIR}${RESET}${CLEAR_LINE}"
      echo -e "\nPress control key [1-4, s, t, f, b, p, a, c, o, d, k, q, h]...${CLEAR_LINE}"
      ;;
  esac
}

# Main Interactive Controller Loop
run_controller() {
  # Trap SIGINT/SIGTERM for clean shutdown
  trap cleanup_and_exit SIGINT SIGTERM
  # Trap EXIT only to restore cursor and echo (never kills services on normal exit)
  trap restore_terminal EXIT

  render_view

  while true; do
    local cmd=""
    # Direct non-blocking read without subshell fork overhead
    read -s -n 1 -t 2 cmd 2>/dev/null || cmd=""

    # Silent escape-sequence flush for arrow keys / mouse scroll
    if [ "$cmd" == $'\x1b' ]; then
      read -s -n 2 -t 0.05 extra 2>/dev/null || true
      cmd=""
    fi

    if [ -n "$cmd" ]; then
      case "$cmd" in
        "1") active_view="frontend"; render_view ;;
        "2") active_view="backend"; render_view ;;
        "3") active_view="python"; render_view ;;
        "4") active_view="tunnel"; render_view ;;
        "5") active_view="combined"; render_view ;;
        "s"|"S") active_view="status"; render_view ;;
        "t"|"T") launch_tmux ;;
        "m"|"M") bash "${ROOT_DIR}/scripts/system_monitor.sh" --tmux; render_view ;;
        "c"|"C") clear_logs; render_view ;;
        "y"|"Y") copy_active_log_to_clipboard; render_view ;;
        "o"|"O") open_url "http://localhost:3000" "Frontend App"; render_view ;;
        "d"|"D") open_url "http://localhost:8000/docs" "Python FastAPI Docs"; render_view ;;
        "h"|"H"|"?") active_view="help"; render_view ;;
        "k"|"K")
          stop_service "all"
          render_view
          ;;
        "f"|"F")
          stop_service "frontend"
          start_frontend
          last_action_msg="${GREEN}[✔] Restarted Frontend (Next.js)${RESET}"
          sleep 1
          render_view
          ;;
        "b"|"B")
          stop_service "backend"
          start_backend
          last_action_msg="${GREEN}[✔] Restarted Backend Node.js${RESET}"
          sleep 1
          render_view
          ;;
        "p"|"P")
          stop_service "python"
          start_python
          last_action_msg="${GREEN}[✔] Restarted Python RAG Service${RESET}"
          sleep 1
          render_view
          ;;
        "u"|"U")
          stop_service "tunnel"
          start_tunnel
          last_action_msg="${GREEN}[✔] Restarted Azure Dev Tunnel${RESET}"
          sleep 1
          render_view
          ;;
        "a"|"A")
          stop_service "all"
          start_frontend
          start_backend
          start_python
          start_tunnel
          last_action_msg="${GREEN}[✔] Restarted All Services${RESET}"
          sleep 1
          render_view
          ;;
        "q"|"Q")
          cleanup_and_exit
          ;;
        *)
          ;;
      esac
    else
      # Periodic non-blocking refresh of status screen without buffer flicker
      if [ "$active_view" == "status" ]; then
        show_header
        echo -e "${BOLD}${GREEN}All services managed automatically in background.${RESET}${CLEAR_LINE}"
        echo -e "${DIM}Logs directory: ${LOG_DIR}${RESET}${CLEAR_LINE}"
        echo -e "\nPress control key [1-4, s, t, f, b, p, a, c, o, d, k, q, h]...${CLEAR_LINE}"
      fi
    fi
  done
}

cleanup_and_exit() {
  stop_tail
  restore_terminal
  echo -e "\n${YELLOW}[!] Stopping all services...${RESET}"
  stop_all_services

  # If running inside the CIVIL-LEX tmux session, close the session too
  if [ -n "${TMUX:-}" ]; then
    local current_session
    current_session=$(tmux display-message -p '#S' 2>/dev/null || true)
    if [ "$current_session" == "$SESSION" ]; then
      echo -e "${GREEN}[✔] Closing tmux session '${SESSION}'...${RESET}"
      tmux kill-session -t "$SESSION" 2>/dev/null || true
    fi
  fi

  echo -e "${GREEN}[✔] All services stopped cleanly.${RESET}"
  exit 0
}


# Top-Level Command-Line Argument Dispatcher


case "${1:-}" in
  -h|--help)
    show_usage
    exit 0
    ;;
  -s|--status)
    print_cli_status
    exit 0
    ;;
  -k|--stop)
    echo -e "${YELLOW}[!] Stopping all running services...${RESET}"
    stop_all_services
    echo -e "${GREEN}[✔] All services stopped cleanly.${RESET}"
    exit 0
    ;;
  -t|--tmux)
    validate_environment
    launch_tmux
    exit 0
    ;;
  -m|--monitor)
    bash "${ROOT_DIR}/scripts/system_monitor.sh" --tmux
    exit 0
    ;;
  -c|--controller|--monitor-only)
    # Open controller directly without killing or restarting services
    run_controller
    exit 0
    ;;
  *)
    # Default execution: check environment, clean stale processes, start services, launch controller
    validate_environment
    kill_existing_processes
    start_all_services
    run_controller
    ;;
esac
