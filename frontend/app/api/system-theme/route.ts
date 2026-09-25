import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";

export const dynamic = "force-dynamic";

function detectHostSystemTheme(): "dark" | "light" {
  const platform = os.platform();

  if (platform === "linux") {
    // 1. GNOME desktop color-scheme
    try {
      const out = execSync("gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null", {
        timeout: 400,
      })
        .toString()
        .trim();
      if (out.includes("dark")) return "dark";
      if (out.includes("light")) return "light";
    } catch (_) {}

    // 2. FreeDesktop portal appearance via dbus
    try {
      const portal = execSync(
        "dbus-send --session --print-reply=literal --dest=org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.Settings.Read string:org.freedesktop.appearance string:color-scheme 2>/dev/null",
        { timeout: 400 }
      )
        .toString()
        .trim();
      if (portal.includes("uint32 1")) return "dark";
      if (portal.includes("uint32 2")) return "light";
    } catch (_) {}

    // 3. GTK theme name
    try {
      const gtk = execSync("gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null", {
        timeout: 400,
      })
        .toString()
        .trim();
      if (gtk.toLowerCase().includes("dark")) return "dark";
      if (gtk.toLowerCase().includes("light")) return "light";
    } catch (_) {}

    // 4. KDE Plasma
    try {
      const kde = execSync(
        "kreadconfig5 --group General --key ColorScheme 2>/dev/null || kreadconfig6 --group General --key ColorScheme 2>/dev/null",
        { timeout: 400 }
      )
        .toString()
        .trim();
      if (kde.toLowerCase().includes("dark")) return "dark";
    } catch (_) {}
  } else if (platform === "darwin") {
    try {
      const style = execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", { timeout: 400 })
        .toString()
        .trim();
      if (style.toLowerCase().includes("dark")) return "dark";
    } catch (_) {}
  } else if (platform === "win32") {
    try {
      const win = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme 2>nul',
        { timeout: 400 }
      ).toString();
      if (win.includes("0x0")) return "dark";
      if (win.includes("0x1")) return "light";
    } catch (_) {}
  }

  return "dark"; // Default fallback
}

export async function GET() {
  const systemTheme = detectHostSystemTheme();
  return NextResponse.json({ systemTheme });
}
