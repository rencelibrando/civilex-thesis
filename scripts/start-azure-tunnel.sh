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

# Check available tunneling tool
TOOL=""
if command -v devtunnel >/dev/null 2>&1; then
  TOOL="devtunnel"
elif command -v cloudflared >/dev/null 2>&1; then
  TOOL="cloudflared"
fi

if [ -z "$TOOL" ]; then
  echo -e "${YELLOW}[!] Neither 'devtunnel' (Microsoft) nor 'cloudflared' was found in PATH.${RESET}"
  echo -e "\n${BOLD}Choose one to install on your machine:${RESET}"
  echo -e "  ${BLUE}1. Microsoft Dev Tunnels CLI (Recommended for Azure):${RESET}"
  echo -e "     curl -sL https://aka.ms/TunnelsCliDownload/linux-x64 -o /tmp/devtunnel && chmod +x /tmp/devtunnel && sudo mv /tmp/devtunnel /usr/local/bin/"
  echo -e "\n  ${BLUE}2. Cloudflare Tunnel (cloudflared):${RESET}"
  echo -e "     # On Fedora: sudo dnf install cloudflared"
  echo -e "     # Or universal: curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/"
  echo ""
  exit 1
fi

if [ "$TOOL" = "devtunnel" ]; then
  echo -e "${GREEN}[✔] Using Microsoft Dev Tunnels ('devtunnel')${RESET}"
  echo -e "${CYAN}[i] Creating or connecting persistent tunnel 'civilex-tunnel'...${RESET}"
  
  # Ensure user is logged in
  if ! devtunnel user show >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] Please log in to Microsoft / GitHub for Dev Tunnels:${RESET}"
    devtunnel user login
  fi

  # Create tunnel if not existing
  devtunnel show civilex-tunnel >/dev/null 2>&1 || devtunnel create civilex-tunnel -a --allow-anonymous

  # Add ports if not added
  devtunnel port create civilex-tunnel -p 4000 >/dev/null 2>&1 || true
  devtunnel port create civilex-tunnel -p 8000 >/dev/null 2>&1 || true
  devtunnel port create civilex-tunnel -p 54321 >/dev/null 2>&1 || true

  echo -e "${GREEN}[✔] Ports configured:${RESET}"
  echo -e "  - Port 4000  (Node.js Backend Gateway)"
  echo -e "  - Port 8000  (Python RAG Service)"
  echo -e "  - Port 54321 (Local Supabase API Gateway)"
  echo -e "\n${BOLD}${YELLOW}Your Dev Tunnel URLs:${RESET}"
  echo -e "  - Backend API:  https://w21xbn22-4000.asse.devtunnels.ms"
  echo -e "  - Python RAG:   https://w21xbn22-8000.asse.devtunnels.ms"
  echo -e "  - Supabase API: https://w21xbn22-54321.asse.devtunnels.ms"


  devtunnel host civilex-tunnel

elif [ "$TOOL" = "cloudflared" ]; then
  echo -e "${GREEN}[✔] Using Cloudflare Quick Tunnels ('cloudflared')${RESET}"
  echo -e "${CYAN}[i] Starting tunnel for Python RAG Service on port 8000...${RESET}"
  echo -e "${YELLOW}[*] Run in a second terminal for Supabase (port 54321): 'cloudflared tunnel --url http://localhost:54321'${RESET}\n"

  cloudflared tunnel --url http://localhost:8000
fi
