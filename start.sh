#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT_DIR}/.logs"
mkdir -p "${LOG_DIR}"

FRONTEND_LOG="${LOG_DIR}/frontend.log"
BACKEND_LOG="${LOG_DIR}/backend.log"
PYTHON_LOG="${LOG_DIR}/python-rag.log"

FRONTEND_PID=""
BACKEND_PID=""
PYTHON_PID=""

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


# Pre-flight Requirements & Error Checking

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
    echo -e "${RED}[✘] Pre-flight checks failed with ${errors} error(s). Aborting startup.${RESET}"
    exit 1
  fi

  echo -e "${GREEN}[✔] Pre-flight checks passed.${RESET}"
}


# Port Conflict Check & Safe Process Cleanup

check_port_raw() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" 2>/dev/null
  else
    (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

free_port_if_needed() {
  local port=$1
  local name=$2
  local attempts=0

  while [ $attempts -lt 6 ]; do
    if ! check_port_raw "$port"; then
      break
    fi

    echo -e "${YELLOW}[!] Port ${port} (${name}) in use. Forcing port release (attempt $((attempts+1)))...${RESET}"

    # Strategy 1: fuser
    if command -v fuser >/dev/null 2>&1; then
      fuser -k -9 "${port}/tcp" >/dev/null 2>&1 || true
      fuser -k -9 "${port}/udp" >/dev/null 2>&1 || true
    fi

    # Strategy 2: lsof
    if command -v lsof >/dev/null 2>&1; then
      local pids
      pids=$(lsof -t -i:"${port}" 2>/dev/null || true)
      if [ -n "$pids" ]; then
        for pid in $pids; do
          kill -9 "$pid" 2>/dev/null || true
        done
      fi
    fi

    # Strategy 3: ss / socket statistics
    if command -v ss >/dev/null 2>&1; then
      local ss_pids
      ss_pids=$(ss -tulpn 2>/dev/null | grep ":${port} " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' || true)
      if [ -n "$ss_pids" ]; then
        for pid in $ss_pids; do
          kill -9 "$pid" 2>/dev/null || true
        done
      fi
    fi

    sleep 0.5
    attempts=$((attempts + 1))
  done
}

kill_existing_processes() {
  echo -e "${CYAN}[+] Checking and safely stopping any existing service instances...${RESET}"

  # Terminate stray dev processes matching command patterns
  pkill -9 -f "next dev" 2>/dev/null || true
  pkill -9 -f "nodemon index.js" 2>/dev/null || true
  pkill -9 -f "uvicorn.*8000" 2>/dev/null || true
  pkill -9 -f "uvicorn main:app" 2>/dev/null || true
  pkill -9 -f "multiprocessing.spawn" 2>/dev/null || true

  # Release active ports (3000, 4000, 8000)
  free_port_if_needed 3000 "Frontend"
  free_port_if_needed 4000 "Backend Node"
  free_port_if_needed 8000 "Python RAG"
}


# Signal Handling & Cleanup
cleanup() {
  # Restore cursor
  printf "${SHOW_CURSOR}"
  echo -e "\n${YELLOW}[!] Stopping all services...${RESET}"
  
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    echo -e "${DIM}Stopped Frontend (PID $FRONTEND_PID)${RESET}"
  fi

  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    echo -e "${DIM}Stopped Backend Node (PID $BACKEND_PID)${RESET}"
  fi

  if [ -n "$PYTHON_PID" ] && kill -0 "$PYTHON_PID" 2>/dev/null; then
    kill "$PYTHON_PID" 2>/dev/null || true
    echo -e "${DIM}Stopped Python RAG Service (PID $PYTHON_PID)${RESET}"
  fi

  pkill -9 -f "uvicorn.*8000" 2>/dev/null || true

  # Release ports cleanly
  free_port_if_needed 3000 "Frontend"
  free_port_if_needed 4000 "Backend"
  free_port_if_needed 8000 "Python RAG"

  echo -e "${GREEN}[✔] All services stopped cleanly.${RESET}"
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT


# Service Launchers with Log Rotation & Crash Monitoring

start_frontend() {
  free_port_if_needed 3000 "Frontend"
  echo -e "${CYAN}[+] Starting Frontend (Next.js)...${RESET}"
  > "${FRONTEND_LOG}"
  (
    cd "${ROOT_DIR}/frontend" || exit 1
    export FORCE_COLOR=1
    export COLORTERM=truecolor
    export NEXT_TELEMETRY_DISABLED=1
    exec npm run dev >> "${FRONTEND_LOG}" 2>&1
  ) &
  FRONTEND_PID=$!
}

start_backend() {
  free_port_if_needed 4000 "Backend"
  echo -e "${GREEN}[+] Starting Backend (Node.js Express)...${RESET}"
  > "${BACKEND_LOG}"
  (
    cd "${ROOT_DIR}/backend-node" || exit 1
    export FORCE_COLOR=1
    export COLORTERM=truecolor
    exec npm run dev >> "${BACKEND_LOG}" 2>&1
  ) &
  BACKEND_PID=$!
}

start_python() {
  pkill -9 -f "uvicorn.*8000" 2>/dev/null || true
  pkill -9 -f "uvicorn main:app" 2>/dev/null || true
  free_port_if_needed 8000 "Python RAG"
  echo -e "${MAGENTA}[+] Starting RAG Service (Python FastAPI/Uvicorn)...${RESET}"
  > "${PYTHON_LOG}"
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
    else
      echo "Error: uvicorn executable not found in PATH or .venv/bin!" >> "${PYTHON_LOG}" 2>&1
      exit 1
    fi
  ) &
  PYTHON_PID=$!
}


# Port & Health Checker

check_port() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" 2>/dev/null && echo "ONLINE" || echo "OFFLINE"
  elif command -v curl >/dev/null 2>&1; then
    curl -s --connect-timeout 1 "http://localhost:${port}" >/dev/null 2>&1 && echo "ONLINE" || echo "OFFLINE"
  else
    (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null && echo "ONLINE" || echo "OFFLINE"
  fi
}

get_status_badge() {
  local status=$1
  local pid=$2
  local log_file=$3

  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo -e "${RED}● CRASHED (Check ${log_file})${RESET}"
  elif [ "$status" == "ONLINE" ]; then
    echo -e "${GREEN}● ONLINE ${RESET}"
  else
    echo -e "${YELLOW}○ STARTING / CONNECTING${RESET}"
  fi
}


# Tmux Launcher Mode (Smooth Scrolling & Mouse Support)

launch_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo -e "${RED}[!] tmux is not installed on this system. Falling back to standard interactive menu.${RESET}"
    sleep 2
    return 1
  fi

  # Start background services first if not running
  [ -z "$FRONTEND_PID" ] && start_frontend
  [ -z "$BACKEND_PID" ] && start_backend
  [ -z "$PYTHON_PID" ] && start_python

  SESSION="civilex"
  tmux kill-session -t "$SESSION" 2>/dev/null || true

  # Enable mouse wheel support, clipboard passthrough, and seamless scrollback in tmux
  tmux new-session -d -s "$SESSION" -n "CIVIL-LEX Services" "tail -f ${FRONTEND_LOG}"
  tmux set-option -t "$SESSION" -g mouse on
  tmux set-option -t "$SESSION" -g history-limit 10000
  tmux set-option -t "$SESSION" -g set-clipboard on

  # Clipboard copy integration for Ctrl+Shift+C and mouse selection
  if command -v xclip >/dev/null 2>&1; then
    tmux bind-key -T copy-mode C-c send-keys -X copy-pipe-and-cancel "xclip -selection clipboard -i"
    tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe-and-cancel "xclip -selection clipboard -i"
    tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "xclip -selection clipboard -i"
  elif command -v wl-copy >/dev/null 2>&1; then
    tmux bind-key -T copy-mode C-c send-keys -X copy-pipe-and-cancel "wl-copy"
    tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe-and-cancel "wl-copy"
    tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "wl-copy"
  elif command -v xsel >/dev/null 2>&1; then
    tmux bind-key -T copy-mode C-c send-keys -X copy-pipe-and-cancel "xsel -i -b"
    tmux bind-key -T copy-mode-vi C-c send-keys -X copy-pipe-and-cancel "xsel -i -b"
    tmux bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "xsel -i -b"
  fi

  tmux select-pane -t 0 -T "Frontend (Port 3000)"
  
  tmux split-window -h "tail -f ${BACKEND_LOG}"
  tmux select-pane -t 1 -T "Backend Node (Port 4000)"

  tmux split-window -v "tail -f ${PYTHON_LOG}"
  tmux select-pane -t 2 -T "Python RAG (Port 8000)"

  tmux select-pane -t 0
  tmux split-window -v "bash -c '${ROOT_DIR}/start.sh --monitor-only'"
  tmux select-pane -t 1 -T "Status Dashboard"

  tmux select-layout tiled
  tmux attach-session -t "$SESSION"
  exit 0
}

# Process command-line flags
validate_environment
kill_existing_processes

if [ "$1" == "--tmux" ]; then
  launch_tmux
fi


# Start All Services

start_frontend
start_backend
start_python


# Advanced Control Helper Functions

stop_service() {
  local target=$1
  case "$target" in
    "frontend")
      if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null || true
        FRONTEND_PID=""
      fi
      free_port_if_needed 3000 "Frontend"
      last_action_msg="${YELLOW}[!] Stopped Frontend (Next.js)${RESET}"
      ;;
    "backend")
      if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
        BACKEND_PID=""
      fi
      free_port_if_needed 4000 "Backend"
      last_action_msg="${YELLOW}[!] Stopped Backend Node.js${RESET}"
      ;;
    "python")
      if [ -n "$PYTHON_PID" ] && kill -0 "$PYTHON_PID" 2>/dev/null; then
        kill "$PYTHON_PID" 2>/dev/null || true
        PYTHON_PID=""
      fi
      free_port_if_needed 8000 "Python RAG"
      last_action_msg="${YELLOW}[!] Stopped Python RAG Service${RESET}"
      ;;
    "all")
      stop_service "frontend"
      stop_service "backend"
      stop_service "python"
      last_action_msg="${YELLOW}[!] Stopped all background services${RESET}"
      ;;
  esac
}

clear_logs() {
  > "${FRONTEND_LOG}"
  > "${BACKEND_LOG}"
  > "${PYTHON_LOG}"
  last_action_msg="${GREEN}[✔] All log files truncated successfully.${RESET}"
}

copy_active_log_to_clipboard() {
  local target_log=""
  case "$active_view" in
    "frontend") target_log="${FRONTEND_LOG}" ;;
    "backend") target_log="${BACKEND_LOG}" ;;
    "python") target_log="${PYTHON_LOG}" ;;
    *) target_log="${FRONTEND_LOG}" ;;
  esac

  if [ -f "$target_log" ]; then
    if command -v xclip >/dev/null 2>&1; then
      tail -n 100 "$target_log" | xclip -selection clipboard -i 2>/dev/null || true
      last_action_msg="${GREEN} Copied last 100 log lines to system clipboard!${RESET}"
    elif command -v wl-copy >/dev/null 2>&1; then
      tail -n 100 "$target_log" | wl-copy 2>/dev/null || true
      last_action_msg="${GREEN} Copied last 100 log lines to system clipboard!${RESET}"
    elif command -v xsel >/dev/null 2>&1; then
      tail -n 100 "$target_log" | xsel -i -b 2>/dev/null || true
      last_action_msg="${GREEN} Copied last 100 log lines to system clipboard!${RESET}"
    else
      last_action_msg="${YELLOW}[!] No clipboard utility (xclip/wl-copy/xsel) found on system.${RESET}"
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


# Flicker-Free Dashboard Renderer

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

  fe_st=$(check_port 3000)
  be_st=$(check_port 4000)
  py_st=$(check_port 8000)

  echo -e "${BOLD}${BLUE}======================================================================${RESET}"
  echo -e "${BOLD}${CYAN}                CIVIL-LEX MULTI-SERVICE CONTROLLER                   ${RESET}"
  echo -e "${BOLD}${BLUE}======================================================================${RESET}"
  
  echo -e " ${BOLD}1. Frontend (Next.js)${RESET}     : http://localhost:3000 | PID: ${FRONTEND_PID:-OFF} | Status: $(get_status_badge "$fe_st" "$FRONTEND_PID" ".logs/frontend.log")  "
  echo -e " ${BOLD}2. Backend (Node.js)${RESET}     : http://localhost:4000 | PID: ${BACKEND_PID:-OFF} | Status: $(get_status_badge "$be_st" "$BACKEND_PID" ".logs/backend.log")  "
  echo -e " ${BOLD}3. RAG Service (Python)${RESET}  : http://localhost:8000 | PID: ${PYTHON_PID:-OFF} | Status: $(get_status_badge "$py_st" "$PYTHON_PID" ".logs/python-rag.log")  "
  echo -e "${BLUE}----------------------------------------------------------------------${RESET}"
  echo -e " ${BOLD}Controls & Hotkeys:${RESET}"
  echo -e "   [${BOLD}1-4${RESET}] View Logs   [${BOLD}s${RESET}] Status Screen   [${BOLD}t${RESET}] Tmux Mode     [${BOLD}c${RESET}] Clear Logs"
  echo -e "   [${BOLD}f/b/p/a${RESET}] Restart   [${BOLD}o${RESET}] Open App UI     [${BOLD}d${RESET}] Open API Docs [${BOLD}k${RESET}] Stop All"
  echo -e "   [${BOLD}h${RESET}] Help Legend    [${BOLD}q${RESET}] Shutdown & Quit All"
  echo -e "${BLUE}======================================================================${RESET}"
  
  if [ -n "$last_action_msg" ]; then
    echo -e " ${last_action_msg}                                                              "
    echo -e "${BLUE}----------------------------------------------------------------------${RESET}"
  fi
}

if [ "$1" == "--monitor-only" ]; then
  first_draw=true
  while true; do
    show_header
    sleep 2
  done
  exit 0
fi

tail_pid=""

stop_tail() {
  if [ -n "$tail_pid" ] && kill -0 "$tail_pid" 2>/dev/null; then
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
    -e "s/\(\"GET[^\"]*\"\)/\x1b[36m\1\x1b[0m/g" \
    -e "s/\(\"POST[^\"]*\"\)/\x1b[35m\1\x1b[0m/g" \
    -e "s/\( 200 OK\| 200 \| 201 \| 304 \)/\x1b[32m\1\x1b[0m/g" \
    -e "s/\( 404 \| 400 \| 422 \)/\x1b[33m\1\x1b[0m/g" \
    -e "s/\( 500 \| 502 \| 503 \)/\x1b[31m\x1b[1m\1\x1b[0m/g"
}

render_view() {
  stop_tail
  first_draw=true
  show_header

  case "$active_view" in
    "frontend")
      echo -e "${BOLD}${CYAN}--- LIVE LOGS: FRONTEND (Press 's' for Status, 'q' to Quit) ---${RESET}"
      tail -n 25 -f "${FRONTEND_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "backend")
      echo -e "${BOLD}${GREEN}--- LIVE LOGS: BACKEND NODE (Press 's' for Status, 'q' to Quit) ---${RESET}"
      tail -n 25 -f "${BACKEND_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "python")
      echo -e "${BOLD}${MAGENTA}--- LIVE LOGS: PYTHON RAG (Press 's' for Status, 'q' to Quit) ---${RESET}"
      tail -n 25 -f "${PYTHON_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "combined")
      echo -e "${BOLD}${YELLOW}--- LIVE COMBINED LOGS (Press 's' for Status, 'q' to Quit) ---${RESET}"
      tail -n 15 -f "${FRONTEND_LOG}" "${BACKEND_LOG}" "${PYTHON_LOG}" | colorize_logs &
      tail_pid=$!
      ;;
    "help")
      echo -e "${BOLD}${CYAN}--- CONTROL KEYBOARD SHORTCUTS HELP ---${RESET}"
      echo -e "   ${BOLD}1${RESET} : Stream Frontend Logs        ${BOLD}f${RESET} : Restart Frontend"
      echo -e "   ${BOLD}2${RESET} : Stream Backend Logs         ${BOLD}b${RESET} : Restart Backend"
      echo -e "   ${BOLD}3${RESET} : Stream Python RAG Logs      ${BOLD}p${RESET} : Restart Python RAG"
      echo -e "   ${BOLD}4${RESET} : Stream Combined Logs        ${BOLD}a${RESET} : Restart All Services"
      echo -e "   ${BOLD}s${RESET} : View Service Status         ${BOLD}k${RESET} : Stop All Services"
      echo -e "   ${BOLD}t${RESET} : Open Tmux Split Dashboard   ${BOLD}c${RESET} : Truncate / Clear Logs"
      echo -e "   ${BOLD}y${RESET} : Copy Active Log to Clipboard ${BOLD}o${RESET} : Open App (localhost:3000)"
      echo -e "   ${BOLD}d${RESET} : Open API Docs (localhost:8000/docs) ${BOLD}q${RESET} : Shutdown & Quit"
      echo -e "\n  * Note: In Tmux mode or Linux terminal, Ctrl+Shift+C or mouse drag selection"
      echo -e "    automatically copies text directly to system clipboard."
      echo -e "\nPress any key to return to Status view..."
      ;;
    *)
      echo -e "${BOLD}${GREEN}All services managed automatically in background.${RESET}"
      echo -e "${DIM}Logs directory: ${LOG_DIR}${RESET}"
      echo -e "\nPress control key [1-4, s, t, f, b, p, a, c, o, d, k, q, h]..."
      ;;
  esac
}

# Handle keyboard input safely without printing raw escape sequences or key leaks
read_key() {
  local key=""
  # Read single character with timeout silently (-s)
  read -s -n 1 -t 2 key 2>/dev/null || key=""

  # If escape sequence detected (e.g. arrow keys / mouse scroll), flush buffer silently
  if [ "$key" == $'\x1b' ]; then
    read -s -n 2 -t 0.05 extra 2>/dev/null || true
    key=""
  fi

  echo "$key"
}

render_view

# Main Event Loop
while true; do
  cmd=$(read_key)

  if [ -n "$cmd" ]; then
    case "$cmd" in
      "1") active_view="frontend"; render_view ;;
      "2") active_view="backend"; render_view ;;
      "3") active_view="python"; render_view ;;
      "4") active_view="combined"; render_view ;;
      "s"|"S"|"5") active_view="status"; render_view ;;
      "t"|"T") launch_tmux ;;
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
      "a"|"A")
        stop_service "all"
        start_frontend
        start_backend
        start_python
        last_action_msg="${GREEN}[✔] Restarted All Services${RESET}"
        sleep 1
        render_view
        ;;
      "q"|"Q")
        cleanup
        ;;
      *)
        ;;
    esac
  else
    # Non-blocking status refresh without clearing screen buffer
    if [ "$active_view" == "status" ]; then
      show_header
      echo -e "${BOLD}${GREEN}All services managed automatically in background.${RESET}"
      echo -e "${DIM}Logs directory: ${LOG_DIR}${RESET}"
      echo -e "\nPress control key [1-4, s, t, f, b, p, a, c, o, d, k, q, h]..."
    fi
  fi
done

