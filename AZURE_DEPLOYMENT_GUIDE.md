# CIVIL-LEX Hybrid Azure Hosting Guide
*(Azure for Students / GitHub Student Developer Pack)*

This guide details how to host the **Frontend (Next.js)** and **Backend Gateway (Node.js)** on **Microsoft Azure**, while running the **Python RAG Service** and **Local Database (Supabase)** on your local laptop connected via secure tunneling.

---

## 1. Architecture Flow

```
[ User Web Browser ]
        │ HTTPS
        ▼
┌─────────────────────────────────────────────────────────────┐
│                       AZURE CLOUD                           │
│                                                             │
│   Frontend (Next.js)            Backend Gateway (Node.js)   │
│   https://<frontend>.azure... ──► https://<backend>.azure...│
└──────────────────────────────────────────────┬──────────────┘
                                               │ HTTPS (Tunneled)
                                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    YOUR LOCAL LAPTOP                        │
│                                                             │
│   Python RAG Service (Port 8000)   Supabase API (Port 54321)│
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Step 1: Tunnel Your Laptop Services

Before Azure can reach your laptop, expose the Python RAG and Supabase ports using **Microsoft Dev Tunnels** (recommended) or **Cloudflare Tunnel**.

### Option A: Microsoft Dev Tunnels (`devtunnel`) — Recommended
1. Install `devtunnel` CLI (if not installed):
   ```bash
   curl -sL https://aka.ms/TunnelsCliDownload/linux-x64 -o /tmp/devtunnel && chmod +x /tmp/devtunnel && sudo mv /tmp/devtunnel /usr/local/bin/
   ```
2. Run the helper script:
   ```bash
   ./scripts/start-azure-tunnel.sh
   ```
   Or manually:
   ```bash
   # Log in with your Microsoft / GitHub student account
   devtunnel user login

   # Create persistent tunnel
   devtunnel create civilex-tunnel -a --allow-anonymous
   devtunnel port create civilex-tunnel -p 8000
   devtunnel port create civilex-tunnel -p 54321

   # Host the tunnel
   devtunnel host civilex-tunnel
   ```
3. Note the two HTTPS URLs output in your terminal:
   - **Port 8000**: e.g., `https://civilex-tunnel-8000.inc1.devtunnels.ms`
   - **Port 54321**: e.g., `https://civilex-tunnel-54321.inc1.devtunnels.ms`

---

## 3. Step 2: Deploy Backend Gateway (`backend-node`) on Azure

### Creating the Azure App Service:
1. Log in to [Azure Portal](https://portal.azure.com) with your Student account.
2. Click **Create a resource** ➔ **Web App** (App Service).
3. Configuration:
   - **Subscription**: Azure for Students
   - **Resource Group**: `rg-civilex` (create new)
   - **Name**: `civilex-api` (or any unique name: `https://civilex-api.azurewebsites.net`)
   - **Publish**: Code
   - **Runtime stack**: `Node 20 LTS`
   - **Operating System**: `Linux`
   - **Pricing Plan**: `Free F1` or `Basic B1` (covered by student tier/credits)
4. Click **Review + Create** ➔ **Create**.

### Configuring Environment Variables:
In your App Service page, navigate to **Settings ➔ Environment variables** (or **Configuration ➔ Application settings**) and add:

| Key | Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Node production mode |
| `PORT` | `8080` (or `4000`) | Azure handles port binding |
| `RAG_SERVICE_URL` | `https://civilex-tunnel-8000.inc1.devtunnels.ms` | Your laptop's tunneled Python URL |
| `SUPABASE_URL` | `https://civilex-tunnel-54321.inc1.devtunnels.ms` | Your laptop's tunneled Supabase URL |
| `SUPABASE_ANON_KEY` | *(your local supabase anon key)* | From your local `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(your local supabase service role key)* | From your local `.env` |
| `ALLOWED_ORIGINS` | `*` (or your Azure frontend URL) | Permitted origins for CORS |

### Deployment:
- **Via GitHub Actions (Continuous Deployment)**:
  - In App Service, go to **Deployment Center** ➔ Select **GitHub** ➔ Choose repository `civilex-thesis` ➔ Root directory: `backend-node`.
- **Via VS Code / Azure CLI**:
  - Deploy directly from the `backend-node/` folder using the Azure App Service extension or `az webapp up`.

---

## 4. Step 3: Deploy Frontend (`frontend`) on Azure

### Option A: Azure Static Web Apps (SWA) — (Fast & Free)
1. In Azure Portal, click **Create a resource** ➔ **Static Web App**.
2. Select **GitHub** and authorize.
3. Select repository: `civilex-thesis`, branch `main`.
4. Build Presets:
   - **App location**: `frontend`
   - **Api location**: *(leave empty)*
   - **Output location**: `.next`
5. Environment Variables (Configuration):
   - `NEXT_PUBLIC_API_URL`: `https://civilex-api.azurewebsites.net`
   - `NEXT_PUBLIC_BACKEND_URL`: `https://civilex-api.azurewebsites.net`
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://civilex-tunnel-54321.inc1.devtunnels.ms`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: *(your supabase anon key)*

### Option B: Azure App Service (Linux Node 20)
1. Create another **Web App** named `civilex-web`.
2. Runtime stack: `Node 20 LTS`.
3. In **Configuration ➔ Application settings**, set:
   - `NEXT_PUBLIC_API_URL`: `https://civilex-api.azurewebsites.net`
   - `NEXT_PUBLIC_BACKEND_URL`: `https://civilex-api.azurewebsites.net`
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://civilex-tunnel-54321.inc1.devtunnels.ms`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: *(your supabase anon key)*
4. Startup command (in General Settings):
   ```bash
   node .next/standalone/server.js
   ```

---

## 5. Important Checklist & Tips

1. **Laptop Sleep Settings**:
   - When presenting or testing your thesis, prevent your laptop from sleeping (or change lid close settings in Linux/GNOME power options).
2. **Supabase Redirect URLs**:
   - In your local Supabase config or dashboard, ensure `https://<your-frontend>.azurewebsites.net` is added to permitted Auth Redirect URLs.
3. **Local Services Running**:
   - Ensure `start.sh` or your python service (`./service-rag-python/run_server.sh`) and local Supabase (`npx supabase start`) are running before launching the tunnel.
