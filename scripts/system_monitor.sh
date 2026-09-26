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
MONITOR_SCRIPT="${SCRIPT_DIR}/system_monitor.sh"

# Source root .env if present
if [ -f "${ROOT_DIR}/.env" ]; then
  # shellcheck source=/dev/null
  set -a
  source "${ROOT_DIR}/.env" 2>/dev/null || true
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

CLEAR_LINE="\033[K"

# Terminal restoration & cleanup handler
# Restores original cursor, echo, and exits alternate screen buffer
in_alternate_screen=false
cleanup() {
  if [ "$in_alternate_screen" = true ]; then
    printf "\033[?1049l\033[?25h" 2>/dev/null || true
  else
    printf "\033[?25h" 2>/dev/null || true
  fi
  stty echo 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Static host hardware cached once at startup
CPU_MODEL=$(lscpu 2>/dev/null | grep -m1 "Model name:" | sed 's/Model name:[[:space:]]*//' | sed 's/[[:space:]]\+/ /g' || true)
[ -z "$CPU_MODEL" ] && CPU_MODEL="Generic x86_64 CPU"
if [ ${#CPU_MODEL} -gt 42 ]; then
  CPU_MODEL="${CPU_MODEL:0:39}..."
fi
CPU_CORES=$(nproc 2>/dev/null || echo 1)

# CPU calculation state maintained in parent shell (prevents subshell fork loss)
PREV_TOTAL=0
PREV_IDLE=0
CPU_PCT="0.0"

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

# Prime CPU usage state
update_cpu_usage

# Check if a local port is responding (timeout 1s)
check_port() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 127.0.0.1 "$port" 2>/dev/null
  else
    (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

# Fast Progress Bar Renderer without subshell/awk overhead
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

# Tmux launcher subroutine
launch_in_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] tmux is not installed on this system. Falling back to direct terminal monitor...${RESET}"
    sleep 1
    render_dashboard
    return
  fi

  # Check if target session exists
  if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${YELLOW}[i] Tmux session '${SESSION_NAME}' not found. Starting dedicated monitor session...${RESET}"
    tmux new-session -d -s "$SESSION_NAME" -n "$MONITOR_WINDOW_NAME" "bash '${MONITOR_SCRIPT}'"
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
  tmux new-window -t "$SESSION_NAME" -n "$MONITOR_WINDOW_NAME" "bash '${MONITOR_SCRIPT}'"
  tmux select-window -t "${SESSION_NAME}:${MONITOR_WINDOW_NAME}"

  if [ -z "${TMUX:-}" ]; then
    tmux attach-session -t "$SESSION_NAME"
  fi
  exit 0
}

# Single snapshot frame generator (usable by both interactive loop and --once flag)
generate_frame() {
  local term_lines=${1:-24}
  local term_cols=${2:-80}

  local now_str
  now_str=$(date "+%Y-%m-%d %H:%M:%S %Z")

  local uptime_str
  uptime_str=$(uptime -p 2>/dev/null || uptime | awk -F'( |,|:)+' '{print $6,"hrs,", $7,"min"}')

  local load_avg
  load_avg=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')

  update_cpu_usage

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

  # Query Python RAG queue status API (0.5s timeout)
  local queue_json=""
  queue_json=$(curl -s --connect-timeout 0.5 --max-time 1 http://localhost:8000/system/queue-status 2>/dev/null || true)

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

  # Query Online Users from Backend Node Gateway (0.5s timeout)
  local users_json=""
  users_json=$(curl -s --connect-timeout 0.5 --max-time 1 http://localhost:4000/api/system/online-users 2>/dev/null || true)

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
  devtunnel_pid=$(pgrep -f "devtunnel host" | head -n 1 || true)
  if [ -n "$devtunnel_pid" ]; then
    st_tu="${GREEN}● ACTIVE ${DIM}(PID ${devtunnel_pid})${RESET}"
  else
    st_tu="${DIM}○ INACTIVE${RESET}"
  fi

  # Visual dividers (78 columns wide, fits perfectly without wrapping)
  local BOX_TOP="${BOLD}${BLUE}╔════════════════════════════════════════════════════════════════════════════╗${RESET}${CLEAR_LINE}\n"
  local BOX_MID="${BOLD}${BLUE}╠════════════════════════════════════════════════════════════════════════════╣${RESET}${CLEAR_LINE}\n"
  local BOX_BOT="${BOLD}${BLUE}╚════════════════════════════════════════════════════════════════════════════╝${RESET}${CLEAR_LINE}\n"
  local DIV_LINE="${BLUE}──────────────────────────────────────────────────────────────────────────────${RESET}${CLEAR_LINE}\n"

  # Assemble entire frame in-memory for 100% flicker-free atomic rendering
  local frame=""

  # Header Box
  frame+="${BOX_TOP}"
  frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}${CYAN}CIVIL-LEX LIVE SYSTEM, RESOURCE & CONCURRENCY MONITOR${RESET}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Time:${RESET} ${WHITE}${now_str}${RESET}  ${DIM}│ Uptime:${RESET} ${WHITE}${uptime_str}${RESET}  ${DIM}│ Win:${RESET} ${CYAN}${MONITOR_WINDOW_NAME}${RESET}${CLEAR_LINE}\n"
  frame+="${BOX_MID}"

  # Section 1: LLM Inference & Concurrency Queue
  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${MAGENTA}⚡ LLM INFERENCE & CONCURRENCY QUEUE (STRICT 6GB VRAM LIMITER)${RESET}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Server:${RESET} ${WHITE}${lm_url}${RESET} -> ${st_lm}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  ${DIM}Model :${RESET} ${CYAN}${active_model}${RESET}  ${DIM}│ Limit:${RESET} ${YELLOW}${max_concurrent} Query Concurrency (VRAM Safety)${RESET}${CLEAR_LINE}\n"

  local query_util_pct=0
  [ "$max_concurrent" -gt 0 ] && query_util_pct=$(awk -v a="$active_queries" -v m="$max_concurrent" 'BEGIN { printf "%.1f", (a / m) * 100 }')
  local concurrency_badge="${GREEN}IDLE${RESET}"
  if [ "$active_queries" -ge "$max_concurrent" ]; then
    concurrency_badge="${RED}${BOLD}BUSY (FULL CAP)${RESET}"
  elif [ "$active_queries" -gt 0 ]; then
    concurrency_badge="${YELLOW}${BOLD}ACTIVE${RESET}"
  fi

  local bar_str
  bar_str=$(draw_bar "$query_util_pct" 16 "$MAGENTA")
  frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Slots :${RESET} [${bar_str}] ${WHITE}${active_queries}/${max_concurrent} Active${RESET} -> ${concurrency_badge}${CLEAR_LINE}\n"

  if [ ${#active_slot_lines[@]} -gt 0 ]; then
    for as_line in "${active_slot_lines[@]}"; do
      IFS=$'\t' read -r as_ticket as_display as_mail as_role as_sec <<< "$as_line"
      local as_id_str="${BOLD}${WHITE}${as_display}${RESET}"
      [ -n "$as_mail" ] && [ "$as_mail" != "$as_display" ] && as_id_str+=" ${DIM}<${as_mail}>${RESET}"
      [ -n "$as_role" ] && as_id_str+=" ${CYAN}[${as_role}]${RESET}"
      frame+="${BOLD}${BLUE}║${RESET}  ${MAGENTA}↳ Current:${RESET} ${YELLOW}⚡ #${as_ticket}${RESET} │ ${as_id_str} ${DIM}(${as_sec}s running)${RESET}${CLEAR_LINE}\n"
    done
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${MAGENTA}↳ Current:${RESET} ${DIM}No active query running (GPU Idle & Available)${RESET}${CLEAR_LINE}\n"
  fi

  local queue_badge="${DIM}0 Waiting (Empty)${RESET}"
  [ "$queued_queries" -gt 0 ] && queue_badge="${YELLOW}${BOLD}${queued_queries} Waiting in FIFO line${RESET}"
  frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Queue :${RESET} ${queue_badge}  ${DIM}│ Served:${RESET} ${WHITE}${total_served}${RESET}  ${DIM}│ Latency:${RESET} ${WHITE}${avg_latency}s${RESET}${CLEAR_LINE}\n"

  if [ ${#waiter_lines[@]} -gt 0 ]; then
    local w_max=2
    [ "$term_lines" -ge 30 ] && w_max=4
    local w_cnt=0
    for w_line in "${waiter_lines[@]}"; do
      w_cnt=$((w_cnt + 1))
      [ "$w_cnt" -gt "$w_max" ] && break
      IFS=$'\t' read -r w_pos w_ticket w_display w_mail w_role w_sec <<< "$w_line"
      local w_id_str="${BOLD}${WHITE}${w_display}${RESET}"
      [ -n "$w_mail" ] && [ "$w_mail" != "$w_display" ] && w_id_str+=" ${DIM}<${w_mail}>${RESET}"
      frame+="${BOLD}${BLUE}║${RESET}  ${YELLOW}↳ Line #${w_pos}:${RESET} ${YELLOW}⏳ #${w_ticket}${RESET} │ ${w_id_str} ${DIM}(${w_sec}s wait)${RESET}${CLEAR_LINE}\n"
    done
  fi

  frame+="${BOX_MID}"

  # Section 2: Online Users
  local online_badge="${GREEN}● ${online_count} Online${RESET}"
  [ "$online_count" -eq 0 ] && online_badge="${DIM}○ 0 Online${RESET}"
  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${CYAN}👥 ONLINE PLATFORM USERS (${online_badge}${BOLD}${CYAN})${RESET}${CLEAR_LINE}\n"

  if [ "$online_count" -gt 0 ]; then
    local max_u=2
    [ "$term_lines" -ge 28 ] && max_u=4
    [ "$term_lines" -ge 34 ] && max_u=6
    local u_idx=0
    for u_line in "${online_users_lines[@]}"; do
      u_idx=$((u_idx + 1))
      [ "$u_idx" -gt "$max_u" ] && break
      IFS=$'\t' read -r u_name u_email u_role u_status u_last_seen u_ip u_client <<< "$u_line"

      local dot="${GREEN}●${RESET}"
      local st_color="${GREEN}"
      if [ "$u_last_seen" -gt 300 ]; then
        dot="${DIM}○${RESET}"
        st_color="${DIM}"
      elif [ "$u_last_seen" -gt 60 ]; then
        dot="${YELLOW}●${RESET}"
        st_color="${YELLOW}"
      fi

      local role_badge=""
      if [[ "$u_role" =~ (Attorney|Lawyer|Practitioner) ]]; then
        role_badge="${MAGENTA}[Attorney]${RESET} "
      elif [ -n "$u_role" ] && [ "$u_role" != "User" ] && [ "$u_role" != "Normal Citizen" ]; then
        role_badge="${CYAN}[${u_role}]${RESET} "
      fi

      local time_str="Active"
      if [ "$u_last_seen" -gt 60 ]; then
        time_str="$((u_last_seen / 60))m ago"
      elif [ "$u_last_seen" -gt 5 ]; then
        time_str="${u_last_seen}s ago"
      fi

      frame+="${BOLD}${BLUE}║${RESET}  ${dot} ${BOLD}${WHITE}${u_name}${RESET} ${role_badge}${st_color}${u_status}${RESET} ${DIM}(${time_str} · ${u_ip} · ${u_client})${RESET}${CLEAR_LINE}\n"
    done
    if [ "$online_count" -gt "$max_u" ]; then
      local rem=$(( online_count - max_u ))
      frame+="${BOLD}${BLUE}║${RESET}  ${DIM}... and ${rem} more active session(s)${RESET}${CLEAR_LINE}\n"
    fi
  else
    frame+="${BOLD}${BLUE}║${RESET}  ${DIM}No active users currently detected (0 sessions in last 30m)${RESET}${CLEAR_LINE}\n"
  fi

  frame+="${BOX_MID}"

  # Section 3: Host Hardware
  local cpu_bar ram_bar swap_bar disk_bar
  cpu_bar=$(draw_bar "$CPU_PCT" 14 "$CYAN")
  ram_bar=$(draw_bar "$mem_pct" 14 "$GREEN")
  swap_bar=$(draw_bar "$swap_pct" 14 "$YELLOW")
  disk_bar=$(draw_bar "$disk_pct" 14 "$BLUE")

  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${CYAN}💻 HOST HARDWARE & SYSTEM UTILIZATION${RESET} ${DIM}(${CPU_MODEL}, ${CPU_CORES}T)${RESET}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}CPU Load :${RESET} [${cpu_bar}]  ${DIM}Load Avg:${RESET} ${WHITE}${load_avg}${RESET}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}RAM      :${RESET} [${ram_bar}]  ${WHITE}${mem_used_gb}G/${mem_total_gb}G${RESET} ${DIM}(Avail: ${mem_avail_gb}G)${RESET}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  ${BOLD}Swap/Disk:${RESET} [${swap_bar}] ${WHITE}${swap_used_gb}G/${swap_total_gb}G${RESET} │ ${DIM}Disk (/):${RESET} ${WHITE}${disk_info}${RESET}${CLEAR_LINE}\n"

  frame+="${BOX_MID}"

  # Section 4: Service Health Grid (2 items per line for compact density)
  frame+="${BOLD}${BLUE}║${RESET} ${BOLD}${GREEN}🌐 SERVICE INFRASTRUCTURE STATUS${RESET}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  Frontend (3000): ${st_fe}   │ Backend Node (4000)  : ${st_be}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  Python RAG (8000): ${st_py}   │ Supabase DB (54322)  : ${st_db}${CLEAR_LINE}\n"
  frame+="${BOLD}${BLUE}║${RESET}  Supabase API(54321): ${st_sb} │ Azure Tunnel         : ${st_tu}${CLEAR_LINE}\n"

  # Footer Controls
  frame+="${BOX_MID}"
  frame+="${BOLD}${BLUE}║${RESET} ${DIM}Hotkeys:${RESET} [${BOLD}r${RESET}] Instant Refresh  [${BOLD}t${RESET}] Open in Tmux  [${BOLD}q${RESET}] Exit Monitor${CLEAR_LINE}\n"
  frame+="${BOX_BOT}"

  printf "%b" "$frame"
}

# Main Interactive Render Loop
render_dashboard() {
  in_alternate_screen=true
  # Switch to alternate screen buffer, clear, home cursor, hide cursor
  printf "\033[?1049h\033[H\033[?25l"

  while true; do
    local term_lines term_cols
    term_lines=$(tput lines 2>/dev/null || echo 24)
    term_cols=$(tput cols 2>/dev/null || echo 80)

    # Generate complete frame in-memory
    local frame_output
    frame_output=$(generate_frame "$term_lines" "$term_cols")

    # Atomic write to screen: cursor home (\033[H) + frame buffer + clear-to-end-of-display (\033[J)
    # Zero scrolling, zero flicker, zero leftover artifact lines
    printf "\033[H%b\033[J" "$frame_output"

    # Non-blocking keypress with 2-second timeout
    local key=""
    read -s -n 1 -t 2 key 2>/dev/null || key=""

    # Silent escape-sequence flush for arrow keys / mouse scroll
    if [ "$key" == $'\x1b' ]; then
      read -s -n 2 -t 0.05 extra 2>/dev/null || true
      key=""
    fi

    if [ "$key" == "q" ] || [ "$key" == "Q" ]; then
      cleanup
      echo -e "${GREEN}[✔] System Monitor closed cleanly.${RESET}"
      exit 0
    elif [ "$key" == "r" ] || [ "$key" == "R" ]; then
      continue
    elif [ "$key" == "t" ] || [ "$key" == "T" ]; then
      launch_in_tmux
    fi
  done
}

# Check command line flags
case "${1:-}" in
  --tmux|-t)
    launch_in_tmux
    ;;
  --once|-1)
    # Print a single clean snapshot and exit without alternate buffer
    generate_frame "$(tput lines 2>/dev/null || echo 24)" "$(tput cols 2>/dev/null || echo 80)"
    exit 0
    ;;
  --help|-h)
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
