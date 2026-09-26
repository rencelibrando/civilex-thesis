#!/usr/bin/env bash

# ==============================================================================
# CIVIL-LEX Live System, Resource & LLM Concurrency Queue Monitor
# ==============================================================================
# Displays real-time host hardware metrics (CPU, RAM, Swap, Disk),
# service health statuses, and live LLM inference concurrency queue statistics
# (strict 6GB VRAM protection for LM Studio Gemma 4).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source root .env if present
if [ -f "${ROOT_DIR}/.env" ]; then
  # shellcheck source=/dev/null
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

SESSION_NAME="${CIVILEX_TMUX_SESSION:-civilex}"
MONITOR_WINDOW_NAME="System-Monitor"

# ANSI Color & Formatting Tokens
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"

RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
MAGENTA="\033[35m"
CYAN="\033[36m"
WHITE="\033[37m"

BG_BLUE="\033[44m"
BG_MAGENTA="\033[45m"
BG_DARK="\033[48;5;236m"

CLEAR_SCREEN="\033[2J\033[H"
HOME_CURSOR="\033[H"
HIDE_CURSOR="\033[?25l"
SHOW_CURSOR="\033[?25h"
CLEAR_LINE="\033[K"

# Terminal cleanup handler
cleanup() {
  printf "${SHOW_CURSOR}" 2>/dev/null || true
  stty echo 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Check if a port is responding
check_port() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" 2>/dev/null
  else
    (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

# Progress Bar Renderer: draw_bar <percent> <width> <filled_color>
draw_bar() {
  local pct=$1
  local width=${2:-20}
  local color=${3:-$GREEN}

  # Ensure integer between 0 and 100
  local num
  num=$(echo "$pct" | awk '{printf "%d", $1}')
  [ "$num" -lt 0 ] && num=0
  [ "$num" -gt 100 ] && num=100

  local filled=$(( num * width / 100 ))
  local empty=$(( width - filled ))

  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  local empty_bar=""
  for ((i=0; i<empty; i++)); do empty_bar+="░"; done

  # Alert colors if high
  if [ "$num" -ge 90 ]; then
    color=$RED
  elif [ "$num" -ge 75 ]; then
    color=$YELLOW
  fi

  printf "${color}${bar}${DIM}${WHITE}${empty_bar}${RESET} %5.1f%%" "$pct"
}

# CPU calculation state
PREV_TOTAL=0
PREV_IDLE=0

get_cpu_usage() {
  local cpu_line
  cpu_line=$(grep '^cpu ' /proc/stat 2>/dev/null || true)
  if [ -z "$cpu_line" ]; then
    echo "0.0"
    return
  fi

  local user nice system idle iowait irq softirq steal
  read -r _ user nice system idle iowait irq softirq steal _ <<< "$cpu_line"

  local total=$(( user + nice + system + idle + iowait + irq + softirq + steal ))
  local idle_all=$(( idle + iowait ))

  if [ "$PREV_TOTAL" -eq 0 ]; then
    PREV_TOTAL=$total
    PREV_IDLE=$idle_all
    echo "0.0"
    return
  fi

  local diff_total=$(( total - PREV_TOTAL ))
  local diff_idle=$(( idle_all - PREV_IDLE ))

  PREV_TOTAL=$total
  PREV_IDLE=$idle_all

  if [ "$diff_total" -le 0 ]; then
    echo "0.0"
    return
  fi

  awk -v dt="$diff_total" -v di="$diff_idle" 'BEGIN { printf "%.1f", ((dt - di) / dt) * 100 }'
}

# Tmux launcher subroutine
launch_in_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo -e "${RED}[!] tmux is not installed on this system.${RESET}"
    exit 1
  fi

  # Check if target session exists
  if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${YELLOW}[i] Tmux session '${SESSION_NAME}' not found. Starting a dedicated monitor session...${RESET}"
    tmux new-session -d -s "$SESSION_NAME" -n "$MONITOR_WINDOW_NAME" "bash '${BASH_SOURCE[0]}'"
    if [ -n "${TMUX:-}" ]; then
      tmux switch-client -t "$SESSION_NAME"
    else
      tmux attach-session -t "$SESSION_NAME"
    fi
    exit 0
  fi

  # Check if the monitor window already exists in the session
  if tmux list-windows -t "$SESSION_NAME" -F "#{window_name}" | grep -q "^${MONITOR_WINDOW_NAME}$"; then
    echo -e "${GREEN}[✔] Switching to existing tmux window '${MONITOR_WINDOW_NAME}'...${RESET}"
    tmux select-window -t "${SESSION_NAME}:${MONITOR_WINDOW_NAME}"
    if [ -z "${TMUX:-}" ]; then
      tmux attach-session -t "$SESSION_NAME"
    fi
    exit 0
  fi

  # Create a new window in the existing session
  echo -e "${GREEN}[✔] Creating new tmux window '${MONITOR_WINDOW_NAME}' in session '${SESSION_NAME}'...${RESET}"
  tmux new-window -t "$SESSION_NAME" -n "$MONITOR_WINDOW_NAME" "bash '${BASH_SOURCE[0]}'"
  tmux select-window -t "${SESSION_NAME}:${MONITOR_WINDOW_NAME}"

  if [ -z "${TMUX:-}" ]; then
    tmux attach-session -t "$SESSION_NAME"
  fi
  exit 0
}

# Check command line flags
if [ "${1:-}" == "--tmux" ] || [ "${1:-}" == "-t" ]; then
  launch_in_tmux
fi

# Main Interactive Render Loop
render_dashboard() {
  printf "${CLEAR_SCREEN}${HIDE_CURSOR}"

  while true; do
    local now_str
    now_str=$(date "+%Y-%m-%d %H:%M:%S %Z")

    local uptime_str
    uptime_str=$(uptime -p 2>/dev/null || uptime | awk -F'( |,|:)+' '{print $6,"hrs,", $7,"min"}')

    local load_avg
    load_avg=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')

    local cpu_pct
    cpu_pct=$(get_cpu_usage)

    local cpu_model
    cpu_model=$(lscpu 2>/dev/null | grep -m1 "Model name:" | sed 's/Model name:[[:space:]]*//')
    [ -z "$cpu_model" ] && cpu_model="Generic x86_64 CPU"
    local cpu_cores
    cpu_cores=$(nproc 2>/dev/null || echo 1)

    # Memory parsing from /proc/meminfo
    local mem_total_kb=0 mem_free_kb=0 mem_avail_kb=0 mem_buffers_kb=0 mem_cached_kb=0 swap_total_kb=0 swap_free_kb=0
    while read -r key val _; do
      case "$key" in
        "MemTotal:") mem_total_kb=$val ;;
        "MemFree:") mem_free_kb=$val ;;
        "MemAvailable:") mem_avail_kb=$val ;;
        "Buffers:") mem_buffers_kb=$val ;;
        "Cached:") mem_cached_kb=$val ;;
        "SwapTotal:") swap_total_kb=$val ;;
        "SwapFree:") swap_free_kb=$val ;;
      esac
    done < /proc/meminfo

    local mem_used_kb=$(( mem_total_kb - mem_avail_kb ))
    local mem_pct=0
    [ "$mem_total_kb" -gt 0 ] && mem_pct=$(awk -v u="$mem_used_kb" -v t="$mem_total_kb" 'BEGIN { printf "%.1f", (u / t) * 100 }')

    local swap_used_kb=$(( swap_total_kb - swap_free_kb ))
    local swap_pct=0
    [ "$swap_total_kb" -gt 0 ] && swap_pct=$(awk -v u="$swap_used_kb" -v t="$swap_total_kb" 'BEGIN { printf "%.1f", (u / t) * 100 }')

    local mem_total_gb mem_used_gb mem_avail_gb swap_total_gb swap_used_gb
    mem_total_gb=$(awk -v k="$mem_total_kb" 'BEGIN { printf "%.1f", k / 1048576 }')
    mem_used_gb=$(awk -v k="$mem_used_kb" 'BEGIN { printf "%.1f", k / 1048576 }')
    mem_avail_gb=$(awk -v k="$mem_avail_kb" 'BEGIN { printf "%.1f", k / 1048576 }')
    swap_total_gb=$(awk -v k="$swap_total_kb" 'BEGIN { printf "%.1f", k / 1048576 }')
    swap_used_gb=$(awk -v k="$swap_used_kb" 'BEGIN { printf "%.1f", k / 1048576 }')

    # Disk usage for root
    local disk_used_pct=0 disk_info="-"
    disk_info=$(df -h / 2>/dev/null | awk 'NR==2 {print $3 "/" $2, "(" $5 ")"}')
    disk_used_pct=$(df / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')

    # Query Python RAG queue status API
    local queue_json=""
    queue_json=$(curl -s --connect-timeout 1 http://localhost:8000/system/queue-status 2>/dev/null || true)

    local active_queries=0 queued_queries=0 max_concurrent=1 total_served=0 avg_latency="0.0"
    local lm_online=false lm_latency="-" lm_url="${LM_STUDIO_URL:-http://10.57.24.131:1234/v1}"
    local active_slots_str="" waiters_str="" active_model="None"

    if [ -n "$queue_json" ]; then
      max_concurrent=$(echo "$queue_json" | grep -o '"max_concurrent":[0-9]*' | cut -d':' -f2 || echo 1)
      active_queries=$(echo "$queue_json" | grep -o '"active_queries":[0-9]*' | cut -d':' -f2 || echo 0)
      queued_queries=$(echo "$queue_json" | grep -o '"queued_queries":[0-9]*' | cut -d':' -f2 || echo 0)
      total_served=$(echo "$queue_json" | grep -o '"total_served":[0-9]*' | cut -d':' -f2 || echo 0)
      avg_latency=$(echo "$queue_json" | grep -o '"avg_latency_sec":[0-9.]*' | cut -d':' -f2 || echo "0.0")

      if echo "$queue_json" | grep -q '"online":true'; then
        lm_online=true
      fi
      local lat
      lat=$(echo "$queue_json" | grep -o '"latency_ms":[0-9.]*' | cut -d':' -f2 || echo "")
      [ -n "$lat" ] && lm_latency="${lat}ms"

      # Extract first loaded model
      local m_extracted
      m_extracted=$(echo "$queue_json" | grep -o '"models":\[[^]]*\]' | sed 's/"models":\[//;s/\]//;s/"//g' | cut -d',' -f1 || true)
      [ -n "$m_extracted" ] && active_model="$m_extracted"
    fi

    # Port checks for Infrastructure Grid
    local st_fe st_be st_py st_db st_sb st_lm st_tu
    check_port 3000 && st_fe="${GREEN}● ONLINE${RESET}" || st_fe="${RED}○ OFFLINE${RESET}"
    check_port 4000 && st_be="${GREEN}● ONLINE${RESET}" || st_be="${RED}○ OFFLINE${RESET}"
    check_port 8000 && st_py="${GREEN}● ONLINE${RESET}" || st_py="${RED}○ OFFLINE${RESET}"
    check_port 54322 && st_db="${GREEN}● ONLINE${RESET}" || st_db="${RED}○ OFFLINE${RESET}"
    check_port 54321 && st_sb="${GREEN}● ONLINE${RESET}" || st_sb="${RED}○ OFFLINE${RESET}"
    if [ "$lm_online" = true ]; then
      st_lm="${GREEN}● CONNECTED ${DIM}(${lm_latency})${RESET}"
    else
      st_lm="${RED}○ DISCONNECTED${RESET}"
    fi

    local devtunnel_pid
    devtunnel_pid=$(pgrep -f "devtunnel host" | head -n 1 || true)
    if [ -n "$devtunnel_pid" ]; then
      st_tu="${GREEN}● ACTIVE ${DIM}(PID ${devtunnel_pid})${RESET}"
    else
      st_tu="${DIM}○ INACTIVE${RESET}"
    fi

    # ------------------ DRAW TERMINAL UI ------------------
    printf "${HOME_CURSOR}"

    # Header Box
    echo -e "${BOLD}${BLUE}╔═══════════════════════════════════════════════════════════════════════════════════════════╗${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}${CYAN}CIVIL-LEX LIVE SYSTEM, RESOURCE & CONCURRENCY MONITOR${RESET}                                ${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${DIM}Time:${RESET} ${WHITE}${now_str}${RESET}  ${DIM}| Uptime:${RESET} ${WHITE}${uptime_str}${RESET}  ${DIM}| Tmux Window:${RESET} ${CYAN}${MONITOR_WINDOW_NAME}${RESET}        ${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}╠═══════════════════════════════════════════════════════════════════════════════════════════╣${RESET}${CLEAR_LINE}"

    # Section 1: LLM Inference & Concurrency Queue
    echo -e "${BOLD}${BLUE}║${RESET} ${BOLD}${MAGENTA}⚡ LLM INFERENCE & CONCURRENCY QUEUE (STRICT 6GB VRAM LIMITER)${RESET}                           ${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${DIM}Model Server (LM Studio):${RESET} ${WHITE}${lm_url}${RESET} -> ${st_lm}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${DIM}Active Model:${RESET}            ${CYAN}${active_model}${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${DIM}VRAM Safety Enforcement:${RESET} ${YELLOW}Strict ${max_concurrent} Query Concurrency (Protects against 6GB VRAM OOM)${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"

    # Visual concurrency bar
    local query_util_pct=0
    [ "$max_concurrent" -gt 0 ] && query_util_pct=$(awk -v a="$active_queries" -v m="$max_concurrent" 'BEGIN { printf "%.1f", (a / m) * 100 }')

    local concurrency_badge="${GREEN}IDLE${RESET}"
    if [ "$active_queries" -ge "$max_concurrent" ]; then
      concurrency_badge="${RED}${BOLD}BUSY (FULL CAP)${RESET}"
    elif [ "$active_queries" -gt 0 ]; then
      concurrency_badge="${YELLOW}${BOLD}ACTIVE${RESET}"
    fi

    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}Active Query Slots:${RESET}  [$(draw_bar "$query_util_pct" 20 "$MAGENTA")]  ${WHITE}${active_queries} / ${max_concurrent} Active${RESET} -> ${concurrency_badge}${CLEAR_LINE}"
    
    local queue_badge="${DIM}0 Waiting (Empty)${RESET}"
    if [ "$queued_queries" -gt 0 ]; then
      queue_badge="${YELLOW}${BOLD}${queued_queries} User(s) Waiting in FIFO Line${RESET}"
    fi
    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}Resource Queue:${RESET}      ${queue_badge}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${DIM}Metrics:${RESET}             Total Served: ${WHITE}${total_served}${RESET} queries  |  Avg Latency: ${WHITE}${avg_latency}s${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}╠═══════════════════════════════════════════════════════════════════════════════════════════╣${RESET}${CLEAR_LINE}"

    # Section 2: Host Hardware Resources
    echo -e "${BOLD}${BLUE}║${RESET} ${BOLD}${CYAN}💻 HOST SYSTEM HARDWARE & RESOURCE UTILIZATION${RESET}                                            ${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${DIM}Processor:${RESET}           ${WHITE}${cpu_model} (${cpu_cores} threads)${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}CPU Load:${RESET}            [$(draw_bar "$cpu_pct" 20 "$CYAN")]  ${DIM}Load Avg:${RESET} ${WHITE}${load_avg}${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}System RAM:${RESET}          [$(draw_bar "$mem_pct" 20 "$GREEN")]  ${WHITE}${mem_used_gb}G / ${mem_total_gb}G (${mem_pct}%)${RESET}  ${DIM}Avail: ${mem_avail_gb}G${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}Swap Memory:${RESET}         [$(draw_bar "$swap_pct" 20 "$YELLOW")]  ${WHITE}${swap_used_gb}G / ${swap_total_gb}G (${swap_pct}%)${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   ${BOLD}Disk Space (/):${RESET}      [$(draw_bar "${disk_used_pct:-0}" 20 "$BLUE")]  ${WHITE}${disk_info}${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}╠═══════════════════════════════════════════════════════════════════════════════════════════╣${RESET}${CLEAR_LINE}"

    # Section 3: Service Health Grid
    echo -e "${BOLD}${BLUE}║${RESET} ${BOLD}${GREEN}🌐 CIVIL-LEX SERVICE INFRASTRUCTURE STATUS${RESET}                                                ${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   Frontend (Next.js 15)  : Port 3000 -> ${st_fe}   Backend Gateway (Node.js) : Port 4000 -> ${st_be}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   RAG Service (Python)   : Port 8000 -> ${st_py}   Supabase DB (Postgres)    : Port 54322-> ${st_db}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}║${RESET}   Supabase API (Kong)    : Port 54321-> ${st_sb}   Azure Dev Tunnel          :            ${st_tu}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}╠═══════════════════════════════════════════════════════════════════════════════════════════╣${RESET}${CLEAR_LINE}"

    # Hotkey Footer
    echo -e "${BOLD}${BLUE}║${RESET} ${DIM}Hotkeys:${RESET} [${BOLD}r${RESET}] Instant Refresh  [${BOLD}t${RESET}] Open in Tmux Screen  [${BOLD}q${RESET}] Exit Monitor                    ${BOLD}${BLUE}║${RESET}${CLEAR_LINE}"
    echo -e "${BOLD}${BLUE}╚═══════════════════════════════════════════════════════════════════════════════════════════╝${RESET}${CLEAR_LINE}"

    # Non-blocking keypress with 2-second timeout
    local key=""
    read -s -n 1 -t 2 key 2>/dev/null || key=""

    if [ "$key" == "q" ] || [ "$key" == "Q" ]; then
      cleanup
      echo -e "\n${GREEN}[✔] Monitor closed cleanly.${RESET}"
      exit 0
    elif [ "$key" == "r" ] || [ "$key" == "R" ]; then
      continue
    elif [ "$key" == "t" ] || [ "$key" == "T" ]; then
      launch_in_tmux
    fi
  done
}

render_dashboard
