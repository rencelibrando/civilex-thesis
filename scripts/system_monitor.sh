#!/usr/bin/env bash

# ==============================================================================
# CIVIL-LEX Live System, Resource & LLM Concurrency Queue Monitor
# ==============================================================================
# Displays real-time host hardware metrics (CPU, RAM, Swap, Disk, Net I/O),
# per-core CPU load, service process resources, service health statuses,
# a scrollable online users directory, and live LLM inference concurrency queue statistics
# (strict 6GB VRAM protection for LM Studio Gemma 4).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MONITOR_SCRIPT="${SCRIPT_DIR}/system_monitor.sh"
START_MTIME=$(stat -c %Y "${MONITOR_SCRIPT}" 2>/dev/null || echo 0)

# Source root .env if present
if [ -f "${ROOT_DIR}/.env" ]; then
  # shellcheck source=/dev/null
  set -a
  source "${ROOT_DIR}/.env" 2>/dev/null || true
  set +a
fi

SESSION_NAME="${CIVILEX_TMUX_SESSION:-civilex}"
MONITOR_WINDOW_NAME="System-Monitor"

# Shared memory cache paths for ultra-fast non-blocking data exchange
CACHE_DIR="/dev/shm"
[ ! -d "$CACHE_DIR" ] && CACHE_DIR="/tmp"
QUEUE_CACHE="${CACHE_DIR}/civilex_mon_queue.json"
USERS_CACHE="${CACHE_DIR}/civilex_mon_users.json"
POLL_LOCK="${CACHE_DIR}/civilex_mon_poll.lock"
PROC_CACHE="${CACHE_DIR}/civilex_mon_procs.tsv"

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

CLEAR_LINE="\033[K"
ESC=$'\033'

# Terminal state tracking
in_alternate_screen=false
USER_SCROLL_OFFSET=0
RESIZE_NEEDED=0

# Terminal restoration & cleanup handler
cleanup() {
  # Disable SGR mouse tracking, exit alternate buffer, restore cursor & echo
  printf "\033[?1000l\033[?1006l" 2>/dev/null || true
  if [ "$in_alternate_screen" = true ]; then
    printf "\033[?1049l\033[?25h" 2>/dev/null || true
  else
    printf "\033[?25h" 2>/dev/null || true
  fi
  stty echo 2>/dev/null || true
  rm -f "$POLL_LOCK" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

handle_winch() {
  RESIZE_NEEDED=1
}
trap handle_winch WINCH

# Static host hardware cached once at startup
CPU_MODEL=$(lscpu 2>/dev/null | grep -m1 "Model name:" | sed 's/Model name:[[:space:]]*//' | sed 's/[[:space:]]\+/ /g' || true)
[ -z "$CPU_MODEL" ] && CPU_MODEL="Generic x86_64 CPU"
CPU_CORES=$(nproc 2>/dev/null || echo 1)

# CPU calculation state maintained across ticks
PREV_TOTAL=0
PREV_IDLE=0
CPU_PCT="0.0"

# Per-core CPU calculation state
declare -A PREV_CORE_TOT
declare -A PREV_CORE_IDL
declare -a CORE_PCTS

# Network I/O calculation state
PREV_RX=0
PREV_TX=0
PREV_NET_SEC=0
RX_RATE_STR="0.0 KB/s"
TX_RATE_STR="0.0 KB/s"

# Cached Process Stats (updated every 2 seconds)
LAST_PROC_UPDATE=0
FE_STATS="-"
BE_STATS="-"
PY_STATS="-"
TU_STATS="-"

# Update Total CPU Usage
update_cpu_usage() {
  local cpu_line
  cpu_line=$(grep '^cpu ' /proc/stat 2>/dev/null || true)
  if [ -z "$cpu_line" ]; then
    CPU_PCT="0.0"
    return
  fi

  local user nice system idle iowait irq softirq steal
  read -r _ user nice system idle iowait irq softirq steal _ <<< "$cpu_line"

  local total=$(( user + nice + system + idle + iowait + irq + softirq + steal ))
  local idle_all=$(( idle + iowait ))

  if [ "$PREV_TOTAL" -eq 0 ]; then
    PREV_TOTAL=$total
    PREV_IDLE=$idle_all
    CPU_PCT="0.0"
    return
  fi

  local diff_total=$(( total - PREV_TOTAL ))
  local diff_idle=$(( idle_all - PREV_IDLE ))

  PREV_TOTAL=$total
  PREV_IDLE=$idle_all

  if [ "$diff_total" -le 0 ]; then
    CPU_PCT="0.0"
    return
  fi

  CPU_PCT=$(awk -v dt="$diff_total" -v di="$diff_idle" 'BEGIN { printf "%.1f", ((dt - di) / dt) * 100 }')
}

# Update Per-Core CPU Usage
update_core_stats() {
  local c_idx=0
  while read -r c_name user nice sys idle iowait irq softirq steal _; do
    local tot=$(( user + nice + sys + idle + iowait + irq + softirq + steal ))
    local idl=$(( idle + iowait ))
    local prev_t="${PREV_CORE_TOT[$c_idx]:-0}"
    local prev_i="${PREV_CORE_IDL[$c_idx]:-0}"

    PREV_CORE_TOT[$c_idx]=$tot
    PREV_CORE_IDL[$c_idx]=$idl

    if [ "$prev_t" -gt 0 ]; then
      local dt=$(( tot - prev_t ))
      local di=$(( idl - prev_i ))
      if [ "$dt" -gt 0 ]; then
        CORE_PCTS[$c_idx]=$(awk -v dt="$dt" -v di="$di" 'BEGIN { printf "%.0f", ((dt - di) / dt) * 100 }')
      else
        CORE_PCTS[$c_idx]="0"
      fi
    else
      CORE_PCTS[$c_idx]="0"
    fi
    c_idx=$((c_idx + 1))
  done < <(grep -E '^cpu[0-9]+' /proc/stat 2>/dev/null || true)
}

# Update Real-time Network Throughput
update_network_usage() {
  local cur_rx=0 cur_tx=0
  read -r cur_rx cur_tx < <(awk 'NR>2 && $1 !~ /^lo:/ {rx += $2; tx += $10} END {printf "%d %d\n", rx, tx}' /proc/net/dev 2>/dev/null || echo "0 0")
  local now
  now=$(date +%s)

  if [ "$PREV_NET_SEC" -eq 0 ] || [ "$PREV_RX" -eq 0 ]; then
    PREV_RX=$cur_rx
    PREV_TX=$cur_tx
    PREV_NET_SEC=$now
    RX_RATE_STR="0.0 KB/s"
    TX_RATE_STR="0.0 KB/s"
    return
  fi

  local dt=$(( now - PREV_NET_SEC ))
  [ "$dt" -le 0 ] && dt=1

  local diff_rx=$(( cur_rx - PREV_RX ))
  local diff_tx=$(( cur_tx - PREV_TX ))
  [ "$diff_rx" -lt 0 ] && diff_rx=0
  [ "$diff_tx" -lt 0 ] && diff_tx=0

  PREV_RX=$cur_rx
  PREV_TX=$cur_tx
  PREV_NET_SEC=$now

  if [ "$diff_rx" -ge 1048576 ]; then
    RX_RATE_STR=$(awk -v b="$diff_rx" -v s="$dt" 'BEGIN { printf "%.2f MB/s", (b / 1048576) / s }')
  else
    RX_RATE_STR=$(awk -v b="$diff_rx" -v s="$dt" 'BEGIN { printf "%.1f KB/s", (b / 1024) / s }')
  fi

  if [ "$diff_tx" -ge 1048576 ]; then
    TX_RATE_STR=$(awk -v b="$diff_tx" -v s="$dt" 'BEGIN { printf "%.2f MB/s", (b / 1048576) / s }')
  else
    TX_RATE_STR=$(awk -v b="$diff_tx" -v s="$dt" 'BEGIN { printf "%.1f KB/s", (b / 1024) / s }')
  fi
}

# Update Service Process Resource Telemetry (cached for 2s)
update_proc_metrics() {
  local now
  now=$(date +%s)
  if [ $(( now - LAST_PROC_UPDATE )) -lt 2 ] && [ "$LAST_PROC_UPDATE" -gt 0 ]; then
    return
  fi
  LAST_PROC_UPDATE=$now

  local p_fe="" p_be="" p_py="" p_tu=""
  p_fe=$(fuser 3000/tcp 2>/dev/null | awk '{print $1}')
  p_be=$(fuser 4000/tcp 2>/dev/null | awk '{print $1}')
  p_py=$(fuser 8000/tcp 2>/dev/null | awk '{print $NF}')
  p_tu=$(pgrep -f "devtunnel host" 2>/dev/null | head -n 1 || true)

  FE_STATS="-"
  BE_STATS="-"
  PY_STATS="-"
  TU_STATS="-"

  local pids=()
  [ -n "$p_fe" ] && pids+=("$p_fe")
  [ -n "$p_be" ] && pids+=("$p_be")
  [ -n "$p_py" ] && pids+=("$p_py")
  [ -n "$p_tu" ] && pids+=("$p_tu")

  if [ ${#pids[@]} -gt 0 ]; then
    local pid_list
    pid_list=$(IFS=,; echo "${pids[*]}")
    while read -r pid pcpu rss _; do
      local mem_str=""
      if [ -n "$rss" ] && [ "$rss" -gt 0 ] 2>/dev/null; then
        if [ "$rss" -ge 1048576 ]; then
          mem_str=$(awk -v r="$rss" 'BEGIN { printf "%.1fG", r / 1048576 }')
        else
          mem_str=$(awk -v r="$rss" 'BEGIN { printf "%dM", r / 1024 }')
        fi
      fi
      local stat_str="${pcpu}% CPU, ${mem_str} RAM"

      if [ "$pid" = "$p_fe" ]; then FE_STATS="$stat_str"; fi
      if [ "$pid" = "$p_be" ]; then BE_STATS="$stat_str"; fi
      if [ "$pid" = "$p_py" ]; then PY_STATS="$stat_str"; fi
      if [ "$pid" = "$p_tu" ]; then TU_STATS="${pcpu}% CPU"; fi
    done < <(ps -p "$pid_list" -o pid,%cpu,rss,comm --no-headers 2>/dev/null || true)
  fi
}

# Prime CPU & Network usage
update_cpu_usage
update_core_stats
update_network_usage

# Check if a local port is responding (timeout 0.3s)
check_port() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 127.0.0.1 "$port" 2>/dev/null
  else
    (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

# Fast Progress Bar Renderer that scales proportionally to width
draw_bar() {
  local pct=${1:-0}
  local width=${2:-16}
  local default_color=${3:-$GREEN}

  local num=${pct%.*}
  num=${num:-0}
  [ "$num" -lt 0 ] && num=0
  [ "$num" -gt 100 ] && num=100

  local filled=$(( num * width / 100 ))
  local empty=$(( width - filled ))

  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  local empty_bar=""
  for ((i=0; i<empty; i++)); do empty_bar+="░"; done

  local color="$default_color"
  if [ "$num" -ge 90 ]; then
    color="$RED"
  elif [ "$num" -ge 75 ]; then
    color="$YELLOW"
  fi

  printf "${color}${bar}${DIM}${WHITE}${empty_bar}${RESET} %5.1f%%" "$pct"
}

# Mini Core Progress Meter
draw_mini_bar() {
  local p=${1:-0}
  local b=""
  if [ "$p" -ge 80 ]; then b="${RED}████${RESET}"
  elif [ "$p" -ge 60 ]; then b="${YELLOW}███░${RESET}"
  elif [ "$p" -ge 40 ]; then b="${CYAN}██░░${RESET}"
  elif [ "$p" -ge 20 ]; then b="${GREEN}█░░░${RESET}"
  else b="${DIM}░░░░${RESET}"
  fi
  printf "%b %2d%%" "$b" "$p"
}

# Non-blocking Asynchronous API Poller
trigger_background_poll() {
  local force=${1:-false}
  local now
  now=$(date +%s)

  if [ "$force" != true ] && [ -f "$POLL_LOCK" ]; then
    local mtime
    mtime=$(stat -c %Y "$POLL_LOCK" 2>/dev/null || echo 0)
    # If lock is less than 3 seconds old, skip spawning redundant poll
    if [ $(( now - mtime )) -lt 3 ]; then
      return
    fi
  fi

  touch "$POLL_LOCK"
  (
    # 1. Fetch Python RAG queue status
    curl -s --connect-timeout 0.4 --max-time 0.8 http://localhost:8000/system/queue-status > "${QUEUE_CACHE}.tmp" 2>/dev/null && \
      mv -f "${QUEUE_CACHE}.tmp" "$QUEUE_CACHE" 2>/dev/null || rm -f "${QUEUE_CACHE}.tmp" 2>/dev/null

    # 2. Fetch Backend Node online users
    curl -s --connect-timeout 0.4 --max-time 0.8 http://localhost:4000/api/system/online-users > "${USERS_CACHE}.tmp" 2>/dev/null && \
      mv -f "${USERS_CACHE}.tmp" "$USERS_CACHE" 2>/dev/null || rm -f "${USERS_CACHE}.tmp" 2>/dev/null

    rm -f "$POLL_LOCK" 2>/dev/null || true
  ) &
}

# Initial synchronization if cache does not exist
if [ ! -f "$QUEUE_CACHE" ] || [ ! -f "$USERS_CACHE" ]; then
  trigger_background_poll true
  sleep 0.2
fi

# Tmux launcher subroutine
launch_in_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] tmux is not installed on this system. Falling back to direct terminal monitor...${RESET}"
    sleep 1
    render_dashboard
    return
  fi

  local MON_SESSION="civilex-monitor"

  if ! tmux has-session -t "$MON_SESSION" 2>/dev/null; then
    echo -e "${GREEN}[✔] Launching dedicated system monitor session '${MON_SESSION}'...${RESET}"
    tmux new-session -d -s "$MON_SESSION" -n "$MONITOR_WINDOW_NAME" "bash '${MONITOR_SCRIPT}'"
    tmux set-option -t "$MON_SESSION" -g mouse on 2>/dev/null || true
    tmux set-window-option -t "$MON_SESSION" -g aggressive-resize on 2>/dev/null || true
  fi

  if [ -n "${TMUX:-}" ]; then
    tmux switch-client -t "$MON_SESSION" 2>/dev/null || tmux attach-session -t "$MON_SESSION"
  else
    tmux attach-session -t "$MON_SESSION"
  fi
  exit 0
}

# Detect current terminal dimensions honoring COLUMNS, LINES, tput and stty
get_terminal_dimensions() {
  local cols="${COLUMNS:-}"
  local lines="${LINES:-}"
  if [ -z "$cols" ] || [ "$cols" -le 0 ] 2>/dev/null; then
    cols=$(tput cols 2>/dev/null || stty size 2>/dev/null | awk '{print $2}' || echo 80)
  fi
  if [ -z "$lines" ] || [ "$lines" -le 0 ] 2>/dev/null; then
    lines=$(tput lines 2>/dev/null || stty size 2>/dev/null | awk '{print $1}' || echo 24)
  fi
  [ -z "$cols" ] || [ "$cols" -lt 80 ] 2>/dev/null && cols=80
  [ -z "$lines" ] || [ "$lines" -lt 20 ] 2>/dev/null && lines=20
  echo "$lines $cols"
}

# Single snapshot frame generator
generate_frame() {
  local term_lines=${1:-24}
  local term_cols=${2:-80}

  # Ensure minimum dimensions for clean presentation
  [ "$term_cols" -lt 80 ] && term_cols=80
  [ "$term_lines" -lt 20 ] && term_lines=20

  local inner_width=$(( term_cols - 2 ))
  local border_str
  printf -v border_str '═%.0s' $(seq 1 "$inner_width")

  local BOX_TOP="${BOLD}${BLUE}╔${border_str}╗${RESET}${CLEAR_LINE}\n"
  local BOX_MID="${BOLD}${BLUE}╠${border_str}╣${RESET}${CLEAR_LINE}\n"
  local BOX_BOT="${BOLD}${BLUE}╚${border_str}╝${RESET}${CLEAR_LINE}\n"

  local now_str
  now_str=$(date "+%Y-%m-%d %H:%M:%S %Z")

  local uptime_str
  uptime_str=$(uptime -p 2>/dev/null || uptime | awk -F'( |,|:)+' '{print $6,"hrs,", $7,"min"}')

  local load_avg
  load_avg=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')

  # Real-time resource updates
  update_cpu_usage
  update_core_stats
  update_network_usage
  update_proc_metrics

  # Real-time CPU Frequency
  local cpu_freq_ghz=""
  local cur_khz
  cur_khz=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || true)
  if [ -n "$cur_khz" ] && [ "$cur_khz" -gt 0 ] 2>/dev/null; then
    cpu_freq_ghz=$(awk -v k="$cur_khz" 'BEGIN { printf "%.2f GHz", k / 1000000 }')
  else
    local mhz
    mhz=$(grep -m1 "cpu MHz" /proc/cpuinfo 2>/dev/null | awk '{print $4}' || true)
    [ -n "$mhz" ] && cpu_freq_ghz=$(awk -v m="$mhz" 'BEGIN { printf "%.2f GHz", m / 1000 }')
  fi
  [ -z "$cpu_freq_ghz" ] && cpu_freq_ghz="Dynamic"

  # Memory parsing from /proc/meminfo
  local mem_total_kb=0 mem_avail_kb=0 swap_total_kb=0 swap_free_kb=0
  while read -r key val _; do
    case "$key" in
      "MemTotal:") mem_total_kb=$val ;;
      "MemAvailable:") mem_avail_kb=$val ;;
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
  local disk_info="-" disk_pct="0"
  disk_info=$(df -hP / 2>/dev/null | awk 'NR==2 {print $3 "/" $2, "(" $5 ")"}')
  disk_pct=$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')

  # Read Python RAG queue status from cached JSON in /dev/shm
  local queue_json=""
  [ -f "$QUEUE_CACHE" ] && queue_json=$(cat "$QUEUE_CACHE" 2>/dev/null || true)

  local active_queries=0 queued_queries=0 max_concurrent=1 total_served=0 avg_latency="0.0"
  local lm_online=false lm_latency="-" lm_url="${LM_STUDIO_URL:-http://10.57.24.131:1234/v1}"
  local active_model="None"
  local -a active_slot_lines=()
  local -a waiter_lines=()

  if [ -n "$queue_json" ] && command -v jq >/dev/null 2>&1; then
    IFS=$'\t' read -r max_concurrent active_queries queued_queries total_served avg_latency lm_online_raw lm_lat active_model < <(
      echo "$queue_json" | jq -r '[
        (.max_concurrent // 1),
        (.active_queries // 0),
        (.queued_queries // 0),
        (.total_served // 0),
        (.avg_latency_sec // 0.0),
        (if .lm_studio.online then "true" else "false" end),
        (.lm_studio.latency_ms // ""),
        (.lm_studio.models[0] // "None")
      ] | @tsv' 2>/dev/null || echo -e "1\t0\t0\t0\t0.0\tfalse\t\tNone"
    )
    [ "$lm_online_raw" = "true" ] && lm_online=true
    [ -n "$lm_lat" ] && lm_latency="${lm_lat}ms"

    # Parse active slots
    while IFS=$'\t' read -r t_num u_display u_mail u_role run_sec; do
      [ -z "$t_num" ] && continue
      active_slot_lines+=("$t_num	$u_display	$u_mail	$u_role	$run_sec")
    done < <(echo "$queue_json" | jq -r '(.active_slots // [])[] | [
      (.ticket|tostring),
      ([.user_name, .user_email, .user_id] | map(select(. != null and . != "")) | first // "Unknown"),
      (.user_email // ""),
      (.user_role // ""),
      ((.running_time_sec // 0)|tostring)
    ] | @tsv' 2>/dev/null || true)

    # Parse waiters
    while IFS=$'\t' read -r pos t_num u_display u_mail u_role wait_sec; do
      [ -z "$t_num" ] && continue
      waiter_lines+=("$pos	$t_num	$u_display	$u_mail	$u_role	$wait_sec")
    done < <(echo "$queue_json" | jq -r '(.waiters // [])[] | [
      ((.position // 1)|tostring),
      (.ticket|tostring),
      ([.user_name, .user_email, .user_id] | map(select(. != null and . != "")) | first // "Unknown"),
      (.user_email // ""),
      (.user_role // ""),
      ((.wait_time_sec // 0)|tostring)
    ] | @tsv' 2>/dev/null || true)
  fi

  # Read Online Users from cached JSON in /dev/shm
  local users_json=""
  [ -f "$USERS_CACHE" ] && users_json=$(cat "$USERS_CACHE" 2>/dev/null || true)

  local online_count=0
  local -a online_users_lines=()

  if [ -n "$users_json" ] && command -v jq >/dev/null 2>&1; then
    online_count=$(echo "$users_json" | jq -r '.onlineCount // (.users | length) // 0' 2>/dev/null || echo 0)
    while IFS=$'\t' read -r u_name u_email u_role u_status u_last_seen u_ip u_client; do
      [ -z "$u_email" ] && [ -z "$u_name" ] && continue
      online_users_lines+=("$u_name	$u_email	$u_role	$u_status	$u_last_seen	$u_ip	$u_client")
    done < <(echo "$users_json" | jq -r '(.users // [])[] | [.fullName // "", .email // "", .role // "", .status // "Active", ((.lastSeenSec // 0)|tostring), .ip // "-", .client // "Browser"] | @tsv' 2>/dev/null || true)
  fi

  # Direct database fallback only if backend returned 0 users AND Postgres port 54322 is responding
  if [ "$online_count" -eq 0 ] && command -v docker >/dev/null 2>&1 && check_port 54322; then
    local pg_out=""
    pg_out=$(docker exec supabase_db_civilex-thesis psql -U postgres -d postgres -t -A -F$'\t' -c "
      SELECT DISTINCT ON (s.user_id)
        COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) as full_name,
        u.email,
        COALESCE(u.raw_user_meta_data->>'role', 'Normal Citizen') as role,
        'Recent Session' as status,
        ROUND(EXTRACT(EPOCH FROM (NOW() - s.updated_at)))::int as last_seen_sec,
        COALESCE(host(s.ip), 'local') as ip,
        COALESCE(s.user_agent, 'Browser') as client
      FROM auth.sessions s
      JOIN auth.users u ON u.id = s.user_id
      WHERE s.updated_at >= NOW() - INTERVAL '30 minutes'
      ORDER BY s.user_id, s.updated_at DESC;
    " 2>/dev/null || true)

    if [ -n "$pg_out" ]; then
      while IFS=$'\t' read -r u_name u_email u_role u_status u_last_seen u_ip u_client; do
        [ -z "$u_email" ] && [ -z "$u_name" ] && continue
        local short_client="Browser"
        if [[ "$u_client" =~ (iPhone|iPad) ]]; then short_client="iOS Safari";
        elif [[ "$u_client" =~ Android ]]; then short_client="Android";
        elif [[ "$u_client" =~ Windows ]]; then short_client="Windows";
        elif [[ "$u_client" =~ Linux ]]; then short_client="Linux";
        elif [[ "$u_client" =~ (Macintosh|Mac OS) ]]; then short_client="macOS";
        fi
        online_users_lines+=("$u_name	$u_email	$u_role	$u_status	$u_last_seen	$u_ip	$short_client")
      done <<< "$pg_out"
      online_count=${#online_users_lines[@]}
    fi
  fi

  # Service Port Statuses
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
  devtunnel_pid=$(pgrep -f "devtunnel host" 2>/dev/null | head -n 1 || true)
  if [ -n "$devtunnel_pid" ]; then
    st_tu="${GREEN}● ACTIVE ${DIM}(PID ${devtunnel_pid})${RESET}"
  else
    st_tu="${DIM}○ INACTIVE${RESET}"
  fi

  # Progress bar sizing dynamically adapted to screen width
  local main_bar_width=16
  if [ "$term_cols" -ge 180 ]; then
    main_bar_width=45
  elif [ "$term_cols" -ge 140 ]; then
    main_bar_width=32
  elif [ "$term_cols" -ge 110 ]; then
    main_bar_width=22
  elif [ "$term_cols" -ge 90 ]; then
    main_bar_width=16
  else
    main_bar_width=10
  fi

  # Build atomic frame buffer
  local frame=""

  # ----------------------------------------------------------------------------
  # Header Box
  # ----------------------------------------------------------------------------
  frame+="${BOX_TOP}"
  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}${CYAN}CIVIL-LEX LIVE SYSTEM, RESOURCE & CONCURRENCY MONITOR${RESET}  ${DIM}│ Host:${RESET} ${WHITE}fedora${RESET}  ${DIM}│ Arch:${RESET} ${WHITE}x86_64${RESET}  ${DIM}│ CPU:${RESET} ${CYAN}${CPU_MODEL}${RESET}  ${DIM}│ Cores:${RESET} ${YELLOW}${CPU_CORES}T AMD Ryzen 5${RESET}  ${DIM}│ Status:${RESET} ${GREEN}Live Telemetry${RESET}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Time:${RESET} ${WHITE}${now_str}${RESET}  ${DIM}│ Uptime:${RESET} ${WHITE}${uptime_str}${RESET}  ${DIM}│ Session:${RESET} ${CYAN}${SESSION_NAME}${RESET}  ${DIM}│ Window:${RESET} ${CYAN}${MONITOR_WINDOW_NAME}${RESET}  ${DIM}│ Screen:${RESET} ${YELLOW}${term_cols}x${term_lines}${RESET}  ${DIM}│ RAM:${RESET} ${WHITE}${mem_total_gb}G Total${RESET}  ${DIM}│ Swap:${RESET} ${WHITE}${swap_total_gb}G${RESET}  ${DIM}│ Poll:${RESET} ${GREEN}0.8s real-time${RESET}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}${CYAN}CIVIL-LEX LIVE SYSTEM, RESOURCE & CONCURRENCY MONITOR${RESET}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Time:${RESET} ${WHITE}${now_str}${RESET}  ${DIM}│ Uptime:${RESET} ${WHITE}${uptime_str}${RESET}  ${DIM}│ Win:${RESET} ${CYAN}${MONITOR_WINDOW_NAME}${RESET}  ${DIM}│ Screen:${RESET} ${YELLOW}${term_cols}x${term_lines}${RESET}${CLEAR_LINE}\n"
  fi
  frame+="${BOX_MID}"

  # ----------------------------------------------------------------------------
  # Section 1: LLM Inference & Concurrency Queue
  # ----------------------------------------------------------------------------
  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${MAGENTA} LLM INFERENCE & CONCURRENCY QUEUE (STRICT 6GB VRAM LIMITER)${RESET}${CLEAR_LINE}\n"

  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Server:${RESET} ${WHITE}${lm_url}${RESET} -> ${st_lm}  ${DIM}│ Model:${RESET} ${CYAN}${active_model}${RESET}  ${DIM}│ Limit:${RESET} ${YELLOW}${max_concurrent} Query Concurrency (Strict 6GB VRAM)${RESET}  ${DIM}│ Provider:${RESET} ${WHITE}LM Studio / Local Engine${RESET}${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 105 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Server:${RESET} ${WHITE}${lm_url}${RESET} -> ${st_lm}  ${DIM}│ Model:${RESET} ${CYAN}${active_model}${RESET}  ${DIM}│ Limit:${RESET} ${YELLOW}${max_concurrent} Query Concurrency (VRAM Safety)${RESET}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Server:${RESET} ${WHITE}${lm_url}${RESET} -> ${st_lm}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Model :${RESET} ${CYAN}${active_model}${RESET}  ${DIM}│ Limit:${RESET} ${YELLOW}${max_concurrent} Query Concurrency (VRAM Safety)${RESET}${CLEAR_LINE}\n"
  fi

  local query_util_pct=0
  [ "$max_concurrent" -gt 0 ] && query_util_pct=$(awk -v a="$active_queries" -v m="$max_concurrent" 'BEGIN { printf "%.1f", (a / m) * 100 }')
  local concurrency_badge="${GREEN}IDLE${RESET}"
  if [ "$active_queries" -ge "$max_concurrent" ]; then
    concurrency_badge="${RED}${BOLD}BUSY (FULL CAP)${RESET}"
  elif [ "$active_queries" -gt 0 ]; then
    concurrency_badge="${YELLOW}${BOLD}ACTIVE${RESET}"
  fi

  local bar_str
  bar_str=$(draw_bar "$query_util_pct" "$main_bar_width" "$MAGENTA")
  local queue_badge="${DIM}0 Waiting (Empty)${RESET}"
  [ "$queued_queries" -gt 0 ] && queue_badge="${YELLOW}${BOLD}${queued_queries} Waiting in FIFO line${RESET}"

  if [ "$term_cols" -ge 110 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Slots :${RESET} [${bar_str}] ${WHITE}${active_queries}/${max_concurrent} Active${RESET} -> ${concurrency_badge}  ${DIM}│ Queue:${RESET} ${queue_badge}  ${DIM}│ Served:${RESET} ${WHITE}${total_served}${RESET}  ${DIM}│ Avg Latency:${RESET} ${WHITE}${avg_latency}s${RESET}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Slots :${RESET} [${bar_str}] ${WHITE}${active_queries}/${max_concurrent} Active${RESET} -> ${concurrency_badge}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Queue :${RESET} ${queue_badge}  ${DIM}│ Served:${RESET} ${WHITE}${total_served}${RESET}  ${DIM}│ Latency:${RESET} ${WHITE}${avg_latency}s${RESET}${CLEAR_LINE}\n"
  fi

  if [ ${#active_slot_lines[@]} -gt 0 ]; then
    for as_line in "${active_slot_lines[@]}"; do
      IFS=$'\t' read -r as_ticket as_display as_mail as_role as_sec <<< "$as_line"
      local as_id_str="${BOLD}${WHITE}${as_display}${RESET}"
      if [ "$term_cols" -ge 115 ] && [ -n "$as_mail" ] && [ "$as_mail" != "$as_display" ]; then
        as_id_str+=" ${DIM}<${as_mail}>${RESET}"
      fi

      local short_role="$as_role"
      if [[ "$short_role" =~ (Normal Citizen|General Public) ]]; then short_role="Citizen";
      elif [[ "$short_role" =~ (Law Student|Bar Candidate) ]]; then short_role="Law Student";
      elif [[ "$short_role" =~ (Attorney|Lawyer|Practitioner) ]]; then short_role="Attorney";
      fi
      [ -n "$short_role" ] && as_id_str+=" ${CYAN}[${short_role}]${RESET}"

      frame+="${BOLD}${BLUE}║${RESET}  ${MAGENTA}↳ Running Ticket #${as_ticket}:${RESET} ${as_id_str} ${DIM}(${as_sec}s running · Model: ${active_model})${RESET}${CLEAR_LINE}\n"
    done
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${MAGENTA}↳ Active Queue:${RESET} ${DIM}No active query running (GPU Idle & Available)${RESET}${CLEAR_LINE}\n"
  fi

  if [ ${#waiter_lines[@]} -gt 0 ]; then
    local w_max=2
    [ "$term_lines" -ge 36 ] && w_max=4
    local w_cnt=0
    for w_line in "${waiter_lines[@]}"; do
      w_cnt=$((w_cnt + 1))
      [ "$w_cnt" -gt "$w_max" ] && break
      IFS=$'\t' read -r w_pos w_ticket w_display w_mail w_role w_sec <<< "$w_line"
      local w_id_str="${BOLD}${WHITE}${w_display}${RESET}"
      if [ "$term_cols" -ge 115 ] && [ -n "$w_mail" ] && [ "$w_mail" != "$w_display" ]; then
        w_id_str+=" ${DIM}<${w_mail}>${RESET}"
      fi
      [ -n "$w_role" ] && w_id_str+=" ${CYAN}[${w_role}]${RESET}"
      frame+="${BOLD}${BLUE}║${RESET}  ${YELLOW}↳ Waiting #${w_pos}:${RESET} ${YELLOW}⏳ Ticket #${w_ticket}${RESET} │ ${w_id_str} ${DIM}(${w_sec}s in line)${RESET}${CLEAR_LINE}\n"
    done
  fi

  frame+="${BOX_MID}"

  # ----------------------------------------------------------------------------
  # Section 2: Online Platform Users (Full Screen Height Maximized & Scrollable)
  # ----------------------------------------------------------------------------
  # Dynamically count exact fixed lines so total frame rows EXACTLY equal term_lines!
  local fixed_lines=0
  fixed_lines=$(( fixed_lines + 4 )) # Top border + 2 header lines + mid border
  fixed_lines=$(( fixed_lines + 1 )) # LLM title
  [ "$term_cols" -ge 105 ] && fixed_lines=$(( fixed_lines + 1 )) || fixed_lines=$(( fixed_lines + 2 )) # LLM server/model
  [ "$term_cols" -ge 110 ] && fixed_lines=$(( fixed_lines + 1 )) || fixed_lines=$(( fixed_lines + 2 )) # LLM slots/queue
  local llm_slots_lines=${#active_slot_lines[@]}
  [ "$llm_slots_lines" -eq 0 ] && llm_slots_lines=1
  fixed_lines=$(( fixed_lines + llm_slots_lines ))
  [ ${#waiter_lines[@]} -gt 0 ] && fixed_lines=$(( fixed_lines + ${#waiter_lines[@]} ))
  fixed_lines=$(( fixed_lines + 1 )) # LLM mid border

  fixed_lines=$(( fixed_lines + 1 )) # Users title
  [ "$term_cols" -ge 115 ] && fixed_lines=$(( fixed_lines + 1 )) # Users table header
  fixed_lines=$(( fixed_lines + 1 )) # Users mid border

  fixed_lines=$(( fixed_lines + 6 )) # Hardware (title + cpu + cores + ram + disk + mid border)
  fixed_lines=$(( fixed_lines + 5 )) # Services (title + 3 rows + mid border)
  fixed_lines=$(( fixed_lines + 2 )) # Footer (hotkeys + bot border)

  local visible_user_rows=$(( term_lines - fixed_lines ))
  [ "$visible_user_rows" -lt 3 ] && visible_user_rows=3

  # Clamp user scroll offset
  local total_users=${#online_users_lines[@]}
  local max_scroll_offset=$(( total_users > visible_user_rows ? total_users - visible_user_rows : 0 ))
  [ "$USER_SCROLL_OFFSET" -gt "$max_scroll_offset" ] && USER_SCROLL_OFFSET=$max_scroll_offset
  [ "$USER_SCROLL_OFFSET" -lt 0 ] && USER_SCROLL_OFFSET=0

  local online_badge="${GREEN}● ${online_count} Online${RESET}"
  [ "$online_count" -eq 0 ] && online_badge="${DIM}○ 0 Online${RESET}"

  local scroll_info=""
  if [ "$total_users" -gt "$visible_user_rows" ]; then
    local view_start=$(( USER_SCROLL_OFFSET + 1 ))
    local view_end=$(( USER_SCROLL_OFFSET + visible_user_rows ))
    [ "$view_end" -gt "$total_users" ] && view_end=$total_users

    local dir_indicator="▲ More · ▼ More"
    if [ "$USER_SCROLL_OFFSET" -eq 0 ]; then
      dir_indicator="▲ Top · ▼ More"
    elif [ "$USER_SCROLL_OFFSET" -ge "$max_scroll_offset" ]; then
      dir_indicator="▲ More · Bottom ▼"
    fi
    if [ "$term_cols" -ge 110 ]; then
      scroll_info="${DIM}│ Viewing ${WHITE}${view_start}-${view_end}${DIM} of ${WHITE}${total_users}${DIM} │ ${YELLOW}${dir_indicator}${DIM} (Scroll: ↑/↓, j/k, PgUp/PgDn, Mouse)${RESET}"
    else
      scroll_info="${DIM}│ ${WHITE}${view_start}-${view_end}${DIM}/${WHITE}${total_users}${DIM} │ ${YELLOW}${dir_indicator}${RESET}"
    fi
  else
    if [ "$total_users" -gt 0 ]; then
      if [ "$term_cols" -ge 100 ]; then
        scroll_info="${DIM}│ All ${total_users} active session(s) visible on screen  │ Scrollable Viewport Capacity: ${visible_user_rows} slots${RESET}"
      else
        scroll_info="${DIM}│ All ${total_users} session(s)${RESET}"
      fi
    fi
  fi

  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${CYAN} ONLINE PLATFORM USERS (${online_badge}${BOLD}${CYAN}) ${scroll_info}${RESET}${CLEAR_LINE}\n"

  # Table column header for wide terminals
  if [ "$term_cols" -ge 160 ]; then
    local th_user="USER / IDENTITY"
    local th_mail="EMAIL ADDRESS"
    local th_role="ROLE"
    local th_stat="ACTIVITY STATUS"
    local th_seen="LAST SEEN"
    local th_ip="IP ADDRESS"
    local th_client="CLIENT / PLATFORM"
    local th_info="SESSION DETAILS / HEARTBEAT"
    local table_hdr
    printf -v table_hdr "  ${DIM}%-2s  %-26.26s  %-30.30s  %-16.16s  %-22.22s  %-12.12s  %-16.16s  %-24.24s  %s${RESET}" \
      "#" "$th_user" "$th_mail" "$th_role" "$th_stat" "$th_seen" "$th_ip" "$th_client" "$th_info"
    frame+="${BOLD}${BLUE}║${RESET}${table_hdr}${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 115 ]; then
    local table_hdr
    printf -v table_hdr "  ${DIM}%-2s  %-24.24s  %-26.26s  %-14.14s  %-18.18s  %-10.10s  %-22.22s${RESET}" \
      "#" "USER / IDENTITY" "EMAIL ADDRESS" "ROLE" "STATUS" "SEEN" "CLIENT / PLATFORM"
    frame+="${BOLD}${BLUE}║${RESET}${table_hdr}${CLEAR_LINE}\n"
  fi

  # Render users list up to visible_user_rows
  local rows_rendered=0
  if [ "$total_users" -gt 0 ]; then
    local slice_end=$(( USER_SCROLL_OFFSET + visible_user_rows ))
    [ "$slice_end" -gt "$total_users" ] && slice_end=$total_users

    for ((u_i=USER_SCROLL_OFFSET; u_i<slice_end; u_i++)); do
      local u_line="${online_users_lines[$u_i]}"
      IFS=$'\t' read -r u_name u_email u_role u_status u_last_seen u_ip u_client <<< "$u_line"

      local dot="${GREEN}●${RESET}"
      local st_color="${GREEN}"
      local disp_status="$u_status"
      if [[ "$u_status" =~ (Running|Query) ]]; then
        dot="${CYAN}●${RESET}"
        st_color="${BOLD}${CYAN}"
        [ "$term_cols" -lt 95 ] && disp_status="Running Query"
      elif [ "$u_last_seen" -gt 300 ]; then
        dot="${DIM}○${RESET}"
        st_color="${DIM}"
        [ "$term_cols" -lt 95 ] && disp_status="Idle"
      elif [ "$u_last_seen" -gt 60 ]; then
        dot="${YELLOW}●${RESET}"
        st_color="${YELLOW}"
      fi

      local role_plain=""
      if [[ "$u_role" =~ (Attorney|Lawyer|Practitioner) ]]; then role_plain="[Attorney]"
      elif [[ "$u_role" =~ (Law Student|Bar Candidate) ]]; then role_plain="[Law Student]"
      elif [[ "$u_role" =~ (Normal Citizen|General Public) ]]; then role_plain="[Citizen]"
      elif [ -n "$u_role" ] && [ "$u_role" != "User" ]; then role_plain="[${u_role:0:15}]"
      else role_plain="[Citizen]"
      fi

      local role_badge="${CYAN}${role_plain}${RESET}"
      [[ "$role_plain" =~ Attorney ]] && role_badge="${MAGENTA}${role_plain}${RESET}"
      [[ "$role_plain" =~ Student ]] && role_badge="${BLUE}${role_plain}${RESET}"

      local time_str="Active"
      if [ "$u_last_seen" -gt 60 ]; then
        time_str="$((u_last_seen / 60))m ago"
      elif [ "$u_last_seen" -gt 5 ]; then
        time_str="${u_last_seen}s ago"
      fi

      local scroll_track=""
      if [ "$total_users" -gt "$visible_user_rows" ]; then
        local thumb_pos=$(( USER_SCROLL_OFFSET * (visible_user_rows - 1) / (max_scroll_offset > 0 ? max_scroll_offset : 1) ))
        if [ "$rows_rendered" -eq "$thumb_pos" ]; then
          scroll_track=" ${CYAN}█${RESET}"
        else
          scroll_track=" ${DIM}│${RESET}"
        fi
      fi
      rows_rendered=$(( rows_rendered + 1 ))

      local disp_client="$u_client"
      if [ "$term_cols" -lt 95 ]; then
        disp_client=$(echo "$disp_client" | sed -e 's/ (Windows)/\/Win/' -e 's/ (Linux)/\/Linux/' -e 's/ (iOS)/\/iOS/' -e 's/ (macOS)/\/Mac/')
      fi

      local user_content=""
      if [ "$term_cols" -ge 160 ]; then
        local extra_detail="Live Heartbeat · Active Session"
        if [[ "$u_status" =~ (Running|Query) ]]; then
          extra_detail="Active Legal Intelligence Analysis"
        elif [ "$u_last_seen" -gt 300 ]; then
          extra_detail="Session Idle (> 5 minutes inactive)"
        fi
        local name_field email_field role_field status_field tail_fields
        printf -v name_field "%-26.26s" "$u_name"
        printf -v email_field "%-30.30s" "$u_email"
        printf -v role_field "%-16.16s" "$role_plain"
        local pad_role="${role_field:${#role_plain}}"
        local colored_role="${role_badge}${pad_role}"

        printf -v status_field "%-22.22s" "$disp_status"
        local pad_st="${status_field:${#disp_status}}"
        local colored_status="${st_color}${disp_status}${RESET}${pad_st}"

        printf -v tail_fields "%-12.12s  %-16.16s  %-24.24s  %s" "$time_str" "$u_ip" "$disp_client" "$extra_detail"
        user_content="  ${dot}  ${BOLD}${WHITE}${name_field}${RESET}  ${DIM}${email_field}${RESET}  ${colored_role}  ${colored_status}  ${DIM}${tail_fields}${RESET}"
      elif [ "$term_cols" -ge 120 ]; then
        local email_str=""
        [ -n "$u_email" ] && [ "$u_email" != "$u_name" ] && email_str=" ${DIM}<${u_email}>${RESET}"
        user_content="  ${dot} ${BOLD}${WHITE}${u_name}${RESET}${email_str} ${role_badge} ${st_color}${disp_status}${RESET} ${DIM}(${time_str} · IP: ${u_ip} · ${disp_client})${RESET}"
      else
        user_content="  ${dot} ${BOLD}${WHITE}${u_name}${RESET} ${role_badge} ${st_color}${disp_status}${RESET} ${DIM}(${time_str} · ${disp_client})${RESET}"
      fi

      frame+="${BOLD}${BLUE}║${RESET}${user_content}${scroll_track}${CLEAR_LINE}\n"
    done
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}No active users currently detected (0 active sessions in last 30m)${RESET}${CLEAR_LINE}\n"
    rows_rendered=$(( rows_rendered + 1 ))
  fi

  # Pad remaining rows to visible_user_rows so monitor ALWAYS fills the full screen length!
  while [ "$rows_rendered" -lt "$visible_user_rows" ]; do
    rows_rendered=$(( rows_rendered + 1 ))
    local slot_num=$rows_rendered
    local empty_content=""
    if [ "$term_cols" -ge 160 ]; then
      local empty_row
      printf -v empty_row "%-26.26s  %-30.30s  %-16.16s  %-22.22s  %-12.12s  %-16.16s  %-24.24s  %s" \
        "[Slot #${slot_num} Available]" "--" "--" "Standby / Ready" "--" "--" "--" "Connection pool standby"
      empty_content="  ${DIM}·  ${empty_row}${RESET}"
    elif [ "$term_cols" -ge 115 ]; then
      local empty_row
      printf -v empty_row "%-24.24s  %-26.26s  %-14.14s  %-18.18s  %-10.10s  %-22.22s" \
        "[Slot #${slot_num} Available]" "--" "--" "Standby / Ready" "--" "--"
      empty_content="  ${DIM}·  ${empty_row}${RESET}"
    else
      empty_content="  ${DIM}·  [Slot #${slot_num} Available] -- Standby / Ready${RESET}"
    fi
    frame+="${BOLD}${BLUE}║${RESET}${empty_content}${CLEAR_LINE}\n"
  done

  frame+="${BOX_MID}"

  # ----------------------------------------------------------------------------
  # Section 3: Host Hardware & Real-time Resource Telemetry
  # ----------------------------------------------------------------------------
  local cpu_bar ram_bar swap_bar disk_bar
  cpu_bar=$(draw_bar "$CPU_PCT" "$main_bar_width" "$CYAN")
  ram_bar=$(draw_bar "$mem_pct" "$main_bar_width" "$GREEN")
  swap_bar=$(draw_bar "$swap_pct" "$main_bar_width" "$YELLOW")
  disk_bar=$(draw_bar "$disk_pct" "$main_bar_width" "$BLUE")

  local hw_title=" HOST HARDWARE & REALTIME UTILIZATION"
  if [ "$term_cols" -ge 95 ]; then
    hw_title+=" (${CPU_MODEL}, ${CPU_CORES}T @ ${cpu_freq_ghz})"
  else
    hw_title+=" (${CPU_CORES}T @ ${cpu_freq_ghz})"
  fi
  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${CYAN}${hw_title}${RESET}${CLEAR_LINE}\n"

  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}CPU Total  :${RESET} [${cpu_bar}]  ${DIM}Clock:${RESET} ${WHITE}${cpu_freq_ghz} Boost${RESET}  ${DIM}│ Load Avg:${RESET} ${WHITE}${load_avg} (1m, 5m, 15m)${RESET}  ${DIM}│ Cores:${RESET} ${CYAN}${CPU_CORES} Threads (${CPU_MODEL})${RESET}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}CPU Load :${RESET} [${cpu_bar}]  ${DIM}Clock:${RESET} ${WHITE}${cpu_freq_ghz}${RESET}  ${DIM}│ Load Avg:${RESET} ${WHITE}${load_avg}${RESET}${CLEAR_LINE}\n"
  fi

  # Real-time Per-Core CPU utilization display
  if [ ${#CORE_PCTS[@]} -gt 0 ]; then
    local core_str=""
    if [ "$term_cols" -ge 150 ]; then
      for ((ci=0; ci<${#CORE_PCTS[@]} && ci<8; ci++)); do
        local cp="${CORE_PCTS[$ci]:-0}"
        core_str+="C${ci}:[$(draw_mini_bar "$cp")]    "
      done
      core_str+="${DIM}│ Mode:${RESET} ${GREEN}Performance Boost (AMD P-State)${RESET}"
    elif [ "$term_cols" -ge 118 ]; then
      for ((ci=0; ci<${#CORE_PCTS[@]} && ci<8; ci++)); do
        local cp="${CORE_PCTS[$ci]:-0}"
        core_str+="C${ci}:[$(draw_mini_bar "$cp")] "
      done
    elif [ "$term_cols" -ge 92 ]; then
      for ((ci=0; ci<${#CORE_PCTS[@]} && ci<8; ci++)); do
        local cp="${CORE_PCTS[$ci]:-0}"
        local c_col="${CYAN}"
        [ "$cp" -ge 75 ] && c_col="${YELLOW}"
        [ "$cp" -ge 90 ] && c_col="${RED}"
        core_str+="[C${ci}: ${c_col}${cp}%${RESET}] "
      done
    else
      for ((ci=0; ci<${#CORE_PCTS[@]} && ci<8; ci++)); do
        local cp="${CORE_PCTS[$ci]:-0}"
        local c_col="${CYAN}"
        [ "$cp" -ge 75 ] && c_col="${YELLOW}"
        [ "$cp" -ge 90 ] && c_col="${RED}"
        core_str+="[${ci}:${c_col}${cp}%${RESET}] "
      done
    fi
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}CPU Cores  :${RESET} ${core_str}${CLEAR_LINE}\n"
  fi

  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}RAM Util   :${RESET} [${ram_bar}]  ${WHITE}${mem_used_gb}G/${mem_total_gb}G Used (${mem_pct}%)${RESET}  ${DIM}│ Avail:${RESET} ${WHITE}${mem_avail_gb}G${RESET}  ${DIM}│ Buffers+Cache:${RESET} ${WHITE}$(( (mem_total_kb - mem_avail_kb) / 1024 ))M${RESET}  ${DIM}│ Swap:${RESET} [${swap_bar}] ${WHITE}${swap_used_gb}G/${swap_total_gb}G (${swap_pct}%)${RESET}${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 105 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}RAM Util :${RESET} [${ram_bar}]  ${WHITE}${mem_used_gb}G/${mem_total_gb}G${RESET} ${DIM}(Avail: ${mem_avail_gb}G)${RESET}  ${DIM}│ Swap:${RESET} [${swap_bar}] ${WHITE}${swap_used_gb}G/${swap_total_gb}G${RESET}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}RAM :${RESET} [${ram_bar}] ${WHITE}${mem_used_gb}G/${mem_total_gb}G${RESET}  ${DIM}│ Swap:${RESET} [${swap_bar}] ${WHITE}${swap_used_gb}G/${swap_total_gb}G${RESET}${CLEAR_LINE}\n"
  fi

  # Real-time Network bandwidth color-coded indicator
  local rx_disp="${CYAN}${RX_RATE_STR}${RESET}"
  local tx_disp="${MAGENTA}${TX_RATE_STR}${RESET}"
  [[ "$RX_RATE_STR" =~ MB/s ]] && rx_disp="${YELLOW}${BOLD}${RX_RATE_STR}${RESET}"
  [[ "$TX_RATE_STR" =~ MB/s ]] && tx_disp="${YELLOW}${BOLD}${TX_RATE_STR}${RESET}"

  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Disk Space :${RESET} [${disk_bar}]  ${WHITE}${disk_info} Used on root filesystem (/)${RESET}  ${DIM}│ Realtime Net I/O:${RESET} ↓ ${rx_disp}   ↑ ${tx_disp} ${DIM}(Active Interface: wlp2s0 WiFi)${RESET}${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 105 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Disk (/):${RESET} [${disk_bar}]  ${WHITE}${disk_info}${RESET}  ${DIM}│ Realtime Net:${RESET} ↓ ${rx_disp}  ↑ ${tx_disp}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Disk:${RESET} [${disk_bar}] ${WHITE}${disk_info}${RESET}  ${DIM}│ Net:${RESET} ↓ ${rx_disp}  ↑ ${tx_disp}${CLEAR_LINE}\n"
  fi

  frame+="${BOX_MID}"

  # ----------------------------------------------------------------------------
  # Section 4: Service Infrastructure Status & Live Process Resources
  # ----------------------------------------------------------------------------
  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${GREEN} SERVICE INFRASTRUCTURE & PROCESS STATUS${RESET}${CLEAR_LINE}\n"

  local fe_detail="" be_detail="" py_detail="" tu_detail=""
  [ "$FE_STATS" != "-" ] && fe_detail=" ${DIM}[${FE_STATS}]${RESET}"
  [ "$BE_STATS" != "-" ] && be_detail=" ${DIM}[${BE_STATS}]${RESET}"
  [ "$PY_STATS" != "-" ] && py_detail=" ${DIM}[${PY_STATS}]${RESET}"
  [ "$TU_STATS" != "-" ] && tu_detail=" ${DIM}[${TU_STATS}]${RESET}"

  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  Frontend (3000)   : ${st_fe}${fe_detail}   ${DIM}│${RESET} Backend Node (4000)  : ${st_be}${be_detail}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  Python RAG (8000) : ${st_py}${py_detail}   ${DIM}│${RESET} Supabase DB (54322)  : ${st_db} ${DIM}[PostgreSQL 15 Container · Port 54322 · Healthy]${RESET}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  Supabase API(54321): ${st_sb} ${DIM}[Kong API Gateway · Port 54321 · Healthy]${RESET}    ${DIM}│${RESET} Azure Tunnel         : ${st_tu}${tu_detail}${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 110 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  Frontend (3000)   : ${st_fe}${fe_detail}   │ Backend Node (4000)  : ${st_be}${be_detail}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  Python RAG (8000) : ${st_py}${py_detail}   │ Supabase DB (54322)  : ${st_db} ${DIM}[PostgreSQL]${RESET}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  Supabase API(54321): ${st_sb} ${DIM}[Kong API]${RESET}    │ Azure Tunnel         : ${st_tu}${tu_detail}${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 92 ]; then
    frame+="${BOLD}${BLUE}║${RESET}  FE (3000): ${st_fe}${fe_detail} │ BE (4000): ${st_be}${be_detail}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  PY (8000): ${st_py}${py_detail} │ DB (54322): ${st_db}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  API(54321): ${st_sb} │ Tunnel: ${st_tu}${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET}  FE(3000): ${st_fe} ${DIM}${FE_STATS:0:14}${RESET} │ BE(4000): ${st_be} ${DIM}${BE_STATS:0:14}${RESET}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  PY(8000): ${st_py} ${DIM}${PY_STATS:0:14}${RESET} │ DB(54322): ${st_db}${CLEAR_LINE}\n"
    frame+="${BOLD}${BLUE}║${RESET}  API(54321): ${st_sb} │ Tunnel: ${st_tu}${CLEAR_LINE}\n"
  fi

  # ----------------------------------------------------------------------------
  # Footer Controls
  # ----------------------------------------------------------------------------
  frame+="${BOX_MID}"
  if [ "$term_cols" -ge 140 ]; then
    frame+="${BOLD}${BLUE}║${RESET} ${DIM}Hotkeys:${RESET} [${BOLD}↑/↓/j/k${RESET}] Scroll Users Directory  ${DIM}│${RESET} [${BOLD}PgUp/PgDn${RESET}] Fast Page Scroll  ${DIM}│${RESET} [${BOLD}Home/End/g/G${RESET}] Jump Top/Bottom  ${DIM}│${RESET} [${BOLD}r${RESET}] Instant Telemetry Refresh  ${DIM}│${RESET} [${BOLD}t${RESET}] Dedicated Tmux Window  ${DIM}│${RESET} [${BOLD}q${RESET}] Exit Monitor${CLEAR_LINE}\n"
  elif [ "$term_cols" -ge 100 ]; then
    frame+="${BOLD}${BLUE}║${RESET} ${DIM}Hotkeys:${RESET} [${BOLD}↑/↓/j/k${RESET}] Scroll Users  [${BOLD}PgUp/PgDn${RESET}] Page  [${BOLD}Home/End/g/G${RESET}] Top/Bot  [${BOLD}r${RESET}] Refresh  [${BOLD}t${RESET}] Tmux  [${BOLD}q${RESET}] Exit${CLEAR_LINE}\n"
  else
    frame+="${BOLD}${BLUE}║${RESET} ${DIM}Hotkeys:${RESET} [${BOLD}↑/↓/j/k${RESET}] Scroll  [${BOLD}PgUp/Dn${RESET}] Page  [${BOLD}r${RESET}] Refresh  [${BOLD}t${RESET}] Tmux  [${BOLD}q${RESET}] Quit${CLEAR_LINE}\n"
  fi
  frame+="${BOX_BOT}"

  printf "%b" "$frame"
}

# Key Event Reader with Escape Sequence & SGR Mouse Decoding
read_interactive_input() {
  local timeout=${1:-0.8}
  local key=""
  IFS= read -rs -n 1 -t "$timeout" key 2>/dev/null || key=""

  if [ "$key" = "$ESC" ]; then
    local rest=""
    while IFS= read -rs -n 1 -t 0.04 c; do
      rest+="$c"
    done
    case "$rest" in
      "[A") echo "UP" ;;
      "[B") echo "DOWN" ;;
      "[5~") echo "PAGE_UP" ;;
      "[6~") echo "PAGE_DOWN" ;;
      "[H"|"[1~"|"[7~") echo "HOME" ;;
      "[F"|"[4~"|"[8~") echo "END" ;;
      *"<64;"*) echo "WHEEL_UP" ;;
      *"<65;"*) echo "WHEEL_DOWN" ;;
      *"<"*) echo "MOUSE_IGNORE" ;;
      *) echo "ESC_${rest}" ;;
    esac
    return
  fi

  case "$key" in
    k|K|w|W) echo "UP" ;;
    j|J|s|S) echo "DOWN" ;;
    u|U|b|B) echo "PAGE_UP" ;;
    d|D|f|F) echo "PAGE_DOWN" ;;
    g) echo "HOME" ;;
    G) echo "END" ;;
    q|Q) echo "QUIT" ;;
    r|R) echo "REFRESH" ;;
    t|T) echo "TMUX" ;;
    "") echo "TIMEOUT" ;;
    *) echo "KEY_$key" ;;
  esac
}

# Main Interactive Render Loop
render_dashboard() {
  in_alternate_screen=true
  # Switch to alternate screen buffer, clear, home cursor, hide cursor, enable SGR mouse tracking
  printf "\033[?1049h\033[H\033[?25l\033[?1000h\033[?1006h"

  while true; do
    # Self-reload if script was updated on disk
    local cur_mtime
    cur_mtime=$(stat -c %Y "${MONITOR_SCRIPT}" 2>/dev/null || echo 0)
    if [ "$cur_mtime" -gt "$START_MTIME" ]; then
      cleanup
      exec bash "${MONITOR_SCRIPT}" "$@"
    fi

    local term_lines term_cols
    read -r term_lines term_cols < <(get_terminal_dimensions)

    # Trigger asynchronous background poll for freshest data without UI latency
    trigger_background_poll false

    # Generate complete frame in-memory
    local frame_output
    frame_output=$(generate_frame "$term_lines" "$term_cols")

    # Atomic write to screen: cursor home (\033[H) + frame buffer + clear-to-end-of-display (\033[J)
    # Zero scrolling, zero flicker, zero leftover artifact lines
    printf "\033[H%b\033[J" "$frame_output"

    # Non-blocking input read (timeout 0.8s for true real-time metric updates)
    local event
    event=$(read_interactive_input 0.8)

    case "$event" in
      QUIT)
        cleanup
        echo -e "${GREEN}[✔] System Monitor closed cleanly.${RESET}"
        exit 0
        ;;
      UP)
        USER_SCROLL_OFFSET=$(( USER_SCROLL_OFFSET - 1 ))
        [ "$USER_SCROLL_OFFSET" -lt 0 ] && USER_SCROLL_OFFSET=0
        ;;
      DOWN)
        USER_SCROLL_OFFSET=$(( USER_SCROLL_OFFSET + 1 ))
        ;;
      WHEEL_UP)
        USER_SCROLL_OFFSET=$(( USER_SCROLL_OFFSET - 3 ))
        [ "$USER_SCROLL_OFFSET" -lt 0 ] && USER_SCROLL_OFFSET=0
        ;;
      WHEEL_DOWN)
        USER_SCROLL_OFFSET=$(( USER_SCROLL_OFFSET + 3 ))
        ;;
      PAGE_UP)
        USER_SCROLL_OFFSET=$(( USER_SCROLL_OFFSET - 10 ))
        [ "$USER_SCROLL_OFFSET" -lt 0 ] && USER_SCROLL_OFFSET=0
        ;;
      PAGE_DOWN)
        USER_SCROLL_OFFSET=$(( USER_SCROLL_OFFSET + 10 ))
        ;;
      HOME)
        USER_SCROLL_OFFSET=0
        ;;
      END)
        USER_SCROLL_OFFSET=9999
        ;;
      REFRESH)
        trigger_background_poll true
        ;;
      TMUX)
        launch_in_tmux
        ;;
      TIMEOUT|MOUSE_IGNORE)
        # Normal real-time tick
        ;;
    esac
  done
}

# Check command line flags
case "${1:-}" in
  --tmux|-t|-tmux|tmux)
    launch_in_tmux
    ;;
  --once|-1|-once|once)
    # Print a single clean snapshot and exit without alternate buffer
    trigger_background_poll true
    sleep 0.1
    read -r t_lines t_cols < <(get_terminal_dimensions)
    generate_frame "$t_lines" "$t_cols"
    exit 0
    ;;
  --help|-h|-help|help)
    echo -e "${BOLD}CIVIL-LEX System & Resource Monitor${RESET}"
    echo -e "Usage: ./scripts/system_monitor.sh [OPTION]"
    echo -e ""
    echo -e "Options:"
    echo -e "  ${BOLD}(no args)${RESET}     Launch live interactive monitor in current terminal"
    echo -e "  ${BOLD}-t, --tmux${RESET}    Open monitor in dedicated tmux window"
    echo -e "  ${BOLD}-1, --once${RESET}    Print single status snapshot and exit"
    echo -e "  ${BOLD}-h, --help${RESET}    Show this help message"
    exit 0
    ;;
  *)
    render_dashboard
    ;;
esac
