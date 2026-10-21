#!/usr/bin/env bash

# CIVIL-LEX - Azure Tunneling Launcher for Local Services
# Exposes Python RAG Service (port 8000) and Local Supabase (port 54321) to the public internet
# so your Azure-hosted frontend and backend can reach them securely.

set -e

BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}====================================================${RESET}"
echo -e "${BOLD}${CYAN}   CIVIL-LEX Local Services Tunnel Helper for Azure   ${RESET}"
echo -e "${BOLD}${CYAN}====================================================${RESET}"

# Check if devtunnel is available
if ! command -v devtunnel >/dev/null 2>&1; then
  echo -e "${YELLOW}[!] 'devtunnel' (Microsoft Dev Tunnels CLI) was not found in PATH.${RESET}"
  echo -e "\n${BOLD}Install Microsoft Dev Tunnels CLI:${RESET}"
  echo -e "  ${BLUE}curl -sL https://aka.ms/TunnelsCliDownload/linux-x64 -o /tmp/devtunnel && chmod +x /tmp/devtunnel && sudo mv /tmp/devtunnel /usr/local/bin/${RESET}\n"
  exit 1
fi

echo -e "${GREEN}[✔] Using Microsoft Dev Tunnels ('devtunnel')${RESET}"
echo -e "${CYAN}[i] Creating or connecting persistent tunnel 'civilex-tunnel-2'...${RESET}"

# Ensure user is logged in
if ! devtunnel user show >/dev/null 2>&1; then
  echo -e "${YELLOW}[!] Please log in to Microsoft / GitHub for Dev Tunnels:${RESET}"
  devtunnel user login
fi

# Create tunnel if not existing
devtunnel show civilex-tunnel-2 >/dev/null 2>&1 || devtunnel create civilex-tunnel-2 -a --allow-anonymous

# Add ports if not added (configured with http protocol to prevent raw TCP window stalls)
devtunnel port create civilex-tunnel-2 -p 4000 --protocol http >/dev/null 2>&1 || true
devtunnel port create civilex-tunnel-2 -p 54321 --protocol http >/dev/null 2>&1 || true

echo -e "${GREEN}[✔] Ports configured:${RESET}"
echo -e "  - Port 4000  (Node.js Backend Gateway)"
echo -e "  - Port 54321 (Local Supabase API Gateway)"
echo -e "\n${BOLD}${YELLOW}Your Dev Tunnel URLs:${RESET}"
echo -e "  - Backend API:  https://ps7cvfbz-4000.asse.devtunnels.ms"
echo -e "  - Supabase API: https://ps7cvfbz-54321.asse.devtunnels.ms"

while true; do
  echo -e "${CYAN}[i] Hosting tunnel 'civilex-tunnel-2'...${RESET}"
  devtunnel host civilex-tunnel-2 || true
  echo -e "${YELLOW}[!] Dev Tunnel disconnected or encountered an error. Reconnecting in 3 seconds...${RESET}"
  sleep 3
done
