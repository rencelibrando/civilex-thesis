# Cloudflare Tunnel Self-Hosting Guide: Civilex

This guide outlines how to host the **Civilex Thesis Application** (Frontend, Node.js Gateway, Python RAG Service, and Local Supabase) entirely on this laptop using a custom domain and **Cloudflare Tunnels (`cloudflared`)**.

> [!NOTE]
> No existing code or environment variables have been changed yet. Follow these steps once your domain is ready.

---

## 1. Architecture & Exposure Overview

Since all services run on your local laptop, **only client/browser-facing services** need to be exposed to the public internet. Backend-only services remain secure on `localhost`.

| Service | Local Port | Exposed via Tunnel? | Public Hostname (Example) | Purpose |
| :--- | :--- | :---: | :--- | :--- |
| **Next.js Frontend** | `3000` | **Yes** | `civilex.yourdomain.com` (or `@`) | Web application UI |
| **Node.js Gateway** | `4000` | **Yes** | `api.civilex.yourdomain.com` | API routes, sessions, auth verification |
| **Supabase Kong API** | `54321` | **Yes** | `supabase.civilex.yourdomain.com` | Browser auth, user sign-in, JWT verification |
| **Python RAG Service** | `8000` | **No** | *None (stays private)* | Handled via internal Node-to-Python requests |
| **Supabase Postgres DB** | `54322` | **No** | *None (stays private)* | Internal DB access |

---

## 2. Prerequisites & Domain Acquisition

1. **Purchase Domain on Cloudflare Registrar**:
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com/) > **Domain Registration** > **Register Domains**.
   - Cloudflare sells domains at wholesale cost with no markup (e.g., `.com` is ~$10/year).
   - *If purchased elsewhere (e.g., Namecheap, GoDaddy):* Add the site to Cloudflare and change nameservers to Cloudflare's assigned nameservers.
2. **Prevent Laptop from Sleeping**:
   - When the laptop suspends or closes its lid, your services will go offline.
   - On Linux (GNOME/Ubuntu):
     - Settings > **Power** > Set "Automatic Suspend" to **Off**.
     - To prevent sleep on lid close, edit `/etc/systemd/logind.conf`:
       ```bash
       HandleLidSwitch=ignore
       HandleLidSwitchExternalPower=ignore
       ```
       Then reload: `sudo systemctl restart systemd-logind`.

---

## 3. Step-by-Step Implementation

### Step 3.1: Install `cloudflared` on Linux

Run the following commands in your terminal:

```bash
# Add Cloudflare's package repository
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bullseye main" | sudo tee /etc/apt/sources.list.d/cloudflared.list

# Install cloudflared
sudo apt-get update && sudo apt-get install cloudflared -y
```

Verify installation:
```bash
cloudflared --version
```

---

### Step 3.2: Authenticate and Create the Tunnel

1. **Login to Cloudflare**:
   ```bash
   cloudflared tunnel login
   ```
   *This command outputs a URL. Open it in your browser, log in, and select your purchased domain to authorize.*

2. **Create the Tunnel**:
   ```bash
   cloudflared tunnel create civilex-laptop
   ```
   *Note the **Tunnel UUID** generated (e.g. `a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) and the credentials file path saved in `~/.cloudflared/<UUID>.json`.*

---

### Step 3.3: Configure the Ingress Rules

Create a configuration file at `~/.cloudflared/config.yml`:

```bash
nano ~/.cloudflared/config.yml
```

Paste the following content (replace `<YOUR_TUNNEL_UUID>` and `yourdomain.com` with your real values):

```yaml
tunnel: <YOUR_TUNNEL_UUID>
credentials-file: /home/rence/.cloudflared/<YOUR_TUNNEL_UUID>.json

ingress:
  # 1. Frontend
  - hostname: civilex.yourdomain.com
    service: http://localhost:3000

  # 2. Node.js API Gateway
  - hostname: api.civilex.yourdomain.com
    service: http://localhost:4000

  # 3. Local Supabase Auth / Gateway (Port 54321)
  - hostname: supabase.civilex.yourdomain.com
    service: http://localhost:54321

  # Catch-all rule for 404
  - service: http_status:404
```

---

### Step 3.4: Route DNS Records in Cloudflare

Link your subdomains to the tunnel:

```bash
cloudflared tunnel route dns civilex-laptop civilex.yourdomain.com
cloudflared tunnel route dns civilex-laptop api.civilex.yourdomain.com
cloudflared tunnel route dns civilex-laptop supabase.civilex.yourdomain.com
```

---

### Step 3.5: Run the Tunnel as a Background Service

Make sure the tunnel automatically restarts on system reboot:

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

## 4. Required Code & Environment Variable Updates

When you are ready to switch over, update the following configuration files:

### 1. `frontend/.env.local`
Change from:
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```
To:
```env
NEXT_PUBLIC_SUPABASE_URL=https://supabase.civilex.yourdomain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
NEXT_PUBLIC_BACKEND_URL=https://api.civilex.yourdomain.com
```

### 2. Frontend Component API Calls
Currently, several frontend files have `fetch("http://localhost:4000/api/...")` hardcoded:
- `components/jurisprudence-modal.tsx`
- `components/layout/header.tsx`
- `app/(dashboard)/settings/page.tsx`
- `app/(dashboard)/civil-code/page.tsx`
- `app/(dashboard)/history/page.tsx`
- `app/(dashboard)/research/page.tsx`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/chat/page.tsx`

We will update them to use:
```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
```
This ensures calls go over `https://api.civilex.yourdomain.com` when running through the domain, without breaking local development.

### 3. Node.js Backend CORS
In `backend-node/src/app.ts` (or `index.ts`), make sure CORS allows your new frontend domain:
```typescript
const allowedOrigins = [
  "http://localhost:3000",
  "https://civilex.yourdomain.com"
];
```

### 4. Supabase Local Config (`supabase/config.toml`)
If Supabase redirects OAuth or auth email confirmation back to localhost, update `site_url` and `additional_redirect_urls` in `supabase/config.toml`:
```toml
[auth]
site_url = "https://civilex.yourdomain.com"
additional_redirect_urls = ["https://civilex.yourdomain.com/**"]
```
Then restart Supabase:
```bash
npx supabase stop && npx supabase start
```

---

## 5. What Remains Unchanged

The following internal backend configs do **not** need to change:
- `service-rag-python/.env`:
  - `POSTGRES_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` (Internal direct DB connection)
  - `LM_STUDIO_URL=http://10.57.24.131:1234/v1` (Internal model connection)
- `backend-node/.env`:
  - `PORT=4000`
  - Internal forwarding to `http://localhost:8000` (Node communicates with Python via internal loopback)

---

## 6. Verification Checklist

Once the tunnel and services are active:
- [ ] Open `https://civilex.yourdomain.com` from an external device (e.g. mobile phone on 4G/5G).
- [ ] Verify SSL certificate shows as valid (padlock icon).
- [ ] Log in / sign up using Supabase auth.
- [ ] Check API requests in DevTools Network tab to confirm they go to `https://api.civilex.yourdomain.com` without CORS or Mixed Content warnings.
- [ ] Submit a RAG query to ensure Node successfully invokes the internal Python service.
