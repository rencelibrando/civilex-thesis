import express from 'express';
import { execSync } from 'child_process';
import os from 'os';

const router = express.Router();

export function detectHostSystemTheme() {
  const platform = os.platform();

  if (platform === 'linux') {
    // 1. GNOME desktop color-scheme
    try {
      const out = execSync("gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null", {
        timeout: 400,
      })
        .toString()
        .trim();
      if (out.includes('dark')) return 'dark';
      if (out.includes('light')) return 'light';
    } catch (_) {}

    // 2. FreeDesktop portal appearance via dbus
    try {
      const portal = execSync(
        "dbus-send --session --print-reply=literal --dest=org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.Settings.Read string:org.freedesktop.appearance string:color-scheme 2>/dev/null",
        { timeout: 400 }
      )
        .toString()
        .trim();
      if (portal.includes('uint32 1')) return 'dark';
      if (portal.includes('uint32 2')) return 'light';
    } catch (_) {}

    // 3. GTK theme name
    try {
      const gtk = execSync("gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null", {
        timeout: 400,
      })
        .toString()
        .trim();
      if (gtk.toLowerCase().includes('dark')) return 'dark';
      if (gtk.toLowerCase().includes('light')) return 'light';
    } catch (_) {}

    // 4. KDE Plasma
    try {
      const kde = execSync(
        "kreadconfig5 --group General --key ColorScheme 2>/dev/null || kreadconfig6 --group General --key ColorScheme 2>/dev/null",
        { timeout: 400 }
      )
        .toString()
        .trim();
      if (kde.toLowerCase().includes('dark')) return 'dark';
    } catch (_) {}
  } else if (platform === 'darwin') {
    try {
      const style = execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", { timeout: 400 })
        .toString()
        .trim();
      if (style.toLowerCase().includes('dark')) return 'dark';
    } catch (_) {}
  } else if (platform === 'win32') {
    try {
      const win = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme 2>nul',
        { timeout: 400 }
      ).toString();
      if (win.includes('0x0')) return 'dark';
      if (win.includes('0x1')) return 'light';
    } catch (_) {}
  }

  return 'dark';
}

router.get('/theme', (req, res) => {
  const systemTheme = detectHostSystemTheme();
  res.json({ systemTheme });
});

router.get('/queue', async (req, res) => {
  const ragUrl = process.env.RAG_SERVICE_URL || 'http://localhost:8000';
  try {
    const response = await fetch(`${ragUrl}/system/queue-status`);
    if (!response.ok) {
      return res.status(502).json({ error: 'RAG Service returned non-200' });
    }
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    return res.status(503).json({
      error: 'RAG Service offline or unreachable',
      max_concurrent: parseInt(process.env.MAX_CONCURRENT_QUERIES || '1', 10),
      active_queries: 0,
      queued_queries: 0,
      offline: true,
    });
  }
});

router.get('/status', async (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const loadAvg = os.loadavg();
  const cpus = os.cpus();

  const ragUrl = process.env.RAG_SERVICE_URL || 'http://localhost:8000';
  let ragQueue = null;
  try {
    const qResp = await fetch(`${ragUrl}/system/queue-status`);
    if (qResp.ok) {
      ragQueue = await qResp.json();
    }
  } catch (_) {}

  res.json({
    timestamp: new Date().toISOString(),
    uptime: os.uptime(),
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model || 'Unknown',
      cpuCores: cpus.length,
      loadAverage: loadAvg,
      memory: {
        totalBytes: totalMem,
        usedBytes: usedMem,
        freeBytes: freeMem,
        usedPercent: ((usedMem / totalMem) * 100).toFixed(1),
      },
    },
    concurrencyConfig: {
      maxConcurrentQueries: parseInt(process.env.MAX_CONCURRENT_QUERIES || '1', 10),
      maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '50', 10),
      queueTimeoutSeconds: parseInt(process.env.QUEUE_TIMEOUT_SECONDS || '180', 10),
    },
    queue: ragQueue,
  });
});

export default router;
