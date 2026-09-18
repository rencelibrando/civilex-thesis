# Deploying CIVIL-LEX Frontend to Vercel

This guide provides step-by-step instructions for deploying the **CIVIL-LEX** Next.js frontend to [Vercel](https://vercel.com).

---

## 1. Important Architecture Prerequisites

Before deploying to Vercel, understand how the CIVIL-LEX repository is structured:

1. **Monorepo Subdirectory**: The repository contains multiple sub-projects (`frontend`, `backend-node`, `service-rag-python`). **The Next.js frontend lives inside `/frontend`**. You must specify `/frontend` as the Root Directory in Vercel.
2. **Supabase Cloud**: The frontend connects to Supabase for authentication and session management.
3. **Backend API Connectivity**:
   - In local development, the frontend communicates with the Node.js gateway at `http://localhost:4000`.
   - In production on Vercel (`https://your-project.vercel.app`), browser security prevents requests to `http://localhost:4000` (Mixed Content and offline localhost).
   - Your backend (`backend-node` + `service-rag-python`) should be deployed to a cloud platform (e.g., Railway, Render, Fly.io, or VPS) with an `https://` URL.

---

## 2. Deploying via Vercel Dashboard (Recommended)

### Step 1: Push Your Code to GitHub
Ensure all your latest changes are pushed to your remote GitHub repository:
```bash
git add .
git commit -m "Prepare frontend for Vercel deployment"
git push origin main
```

---

### Step 2: Log in to Vercel & Import Project
1. Go to [vercel.com](https://vercel.com) and log in (or sign up with GitHub).
2. In your Vercel Dashboard, click the **"Add New..."** button in the top-right corner and select **"Project"**.
3. Under **"Import Git Repository"**, locate `civilex-thesis` (or your repository name) and click **"Import"**.

---

### Step 3: Configure Project Settings (CRITICAL)

On the **"Configure Project"** screen:

1. **Project Name**: Choose a name (e.g., `civilex-thesis` or `civilex-frontend`).
2. **Framework Preset**: Ensure it is set to **Next.js**.
3. **Root Directory (MANDATORY)**:
   - Click the **"Edit"** button next to **Root Directory**.
   - Select the **`frontend`** directory from the modal and click **"Continue"**.
   - *If you do not select `frontend`, Vercel will attempt to build from the monorepo root and fail.*

---

### Step 4: Configure Environment Variables

Expand the **"Environment Variables"** accordion and add the following keys from your `frontend/.env.local`:

| Variable Name | Description | Example Value |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL | `https://xyzproject.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anon Public Key | `eyJhbGciOiJIUzI1NiIsInR...` |

*(Optional / Production Backend)*:
| Variable Name | Description | Example Value |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_BACKEND_URL` | Production URL for Node Gateway | `https://api.yourdomain.com` or Railway URL |

---

### Step 5: Deploy
1. Click the **"Deploy"** button.
2. Vercel will clone the `/frontend` directory, install dependencies (`npm install`), execute `next build`, and deploy the application.
3. Once completed, you will see a congratulations screen with your live production URL (e.g., `https://civilex-thesis.vercel.app`).

---

## 3. Post-Deployment: Configure Supabase Auth

Because Supabase handles user authentication and redirects, you must authorize your new Vercel domain:

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. Go to **Authentication** > **URL Configuration**.
4. In **Site URL**, set your production domain:
   ```
   https://civilex-thesis.vercel.app
   ```
5. In **Redirect URLs**, click **"Add URL"** and add:
   ```
   https://civilex-thesis.vercel.app/**
   https://*.vercel.app/**
   ```
6. Click **Save Changes**.

---

## 4. Alternative: Deploy Using Vercel CLI

If you prefer deploying from your terminal:

1. Install the Vercel CLI globally:
   ```bash
   npm install -g vercel
   ```
2. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
3. Log in to Vercel:
   ```bash
   vercel login
   ```
4. Deploy to Preview:
   ```bash
   vercel
   ```
   - When asked *"Set up and deploy?"*, answer `Y`.
   - When asked *"Which scope?"*, select your Vercel team/account.
   - When asked *"Link to existing project?"*, answer `N` (or select existing if already created).
   - When asked *"What's your project's name?"*, enter `civilex-thesis`.
   - When asked *"In which directory is your code located?"*, enter `./` (since you are already in `/frontend`).
5. Deploy to Production:
   ```bash
   vercel --prod
   ```

---

## 5. Transitioning from `localhost:4000` to Production Backend

Currently, certain frontend components call `http://localhost:4000/api/...`. In production on Vercel:

### Option A: Use Next.js Rewrites (Recommended for clean URLs)
You can configure `frontend/next.config.ts` so all calls to `/api/:path*` automatically proxy to your production backend without changing code:

```typescript
// frontend/next.config.ts
import type { NextConfig } from "next";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

### Option B: Use Environment Variable in Fetch Calls
Define a base API utility:
```typescript
export const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
```
And replace hardcoded strings with `${API_BASE_URL}/api/...`.

---

## 6. Troubleshooting Common Issues

### Issue 1: `Error: No Next.js version detected` or root build error
- **Cause**: Vercel tried to build the root repository directory instead of `frontend/`.
- **Solution**: Go to **Vercel Project Settings > General > Root Directory** -> set to `frontend` -> save and redeploy.

### Issue 2: Supabase Auth redirecting back to `localhost:3000`
- **Cause**: Supabase redirect URLs only list `http://localhost:3000`.
- **Solution**: Update Supabase **Authentication > URL Configuration > Redirect URLs** with `https://your-app.vercel.app/**`.

### Issue 3: Mixed Content / Network Error when calling Backend
- **Cause**: Vercel runs on `https://`, but browser fetch is trying to connect to unencrypted `http://localhost:4000`.
- **Solution**: Deploy `backend-node` to an HTTPS-enabled host (e.g. Railway, Render) and update `NEXT_PUBLIC_BACKEND_URL`.
