"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

type Theme = "system" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

interface ThemeContextType {
  theme: string;
  setTheme: (theme: string) => void;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  themes: string[];
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "dark",
  systemTheme: "dark",
  themes: ["system", "dark", "light"],
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  attribute?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
      } catch (_) {}
    }
    return defaultTheme;
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  const [mounted, setMounted] = useState(false);

  // Apply theme class and style to documentElement
  const applyThemeToDOM = useCallback((targetTheme: ResolvedTheme) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (targetTheme === "dark") {
      root.classList.remove("light");
      root.classList.add("dark");
      root.style.colorScheme = "dark";
      root.setAttribute("data-theme", "dark");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
      root.style.colorScheme = "light";
      root.setAttribute("data-theme", "light");
    }
  }, []);

  // Fetch actual OS system theme from host API
  const syncHostSystemTheme = useCallback(async () => {
    try {
      const res = await fetch("/api/system-theme").catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.systemTheme === "dark" || data.systemTheme === "light") {
          setSystemTheme(data.systemTheme);
          return data.systemTheme as ResolvedTheme;
        }
      }
    } catch (_) {}

    // Fallback to matchMedia
    if (typeof window !== "undefined") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const detected = isDark ? "dark" : "light";
      setSystemTheme(detected);
      return detected;
    }
    return "dark";
  }, []);

  // Set theme handler
  const setTheme = useCallback(
    (newTheme: string) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(storageKey, newTheme);
      } catch (_) {}

      if (newTheme === "system") {
        // When user explicitly selects system, immediately sync and apply the actual host theme
        syncHostSystemTheme().then((activeSysTheme) => {
          applyThemeToDOM(activeSysTheme);
        });
      } else if (newTheme === "dark" || newTheme === "light") {
        applyThemeToDOM(newTheme as ResolvedTheme);
      }
    },
    [storageKey, syncHostSystemTheme, applyThemeToDOM]
  );

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return systemTheme;
  }, [theme, systemTheme]);

  // Initial sync & change listeners
  useEffect(() => {
    setMounted(true);

    // Initial check of OS system theme
    syncHostSystemTheme().then((activeSysTheme) => {
      const currentStored = (localStorage.getItem(storageKey) as Theme) || theme;
      if (currentStored === "system") {
        applyThemeToDOM(activeSysTheme);
      } else if (currentStored === "dark" || currentStored === "light") {
        applyThemeToDOM(currentStored as ResolvedTheme);
      }
    });

    // Listen to browser prefers-color-scheme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      const sys = e.matches ? "dark" : "light";
      setSystemTheme(sys);
      const current = localStorage.getItem(storageKey) || "system";
      if (current === "system") {
        applyThemeToDOM(sys);
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleMediaChange);
    } else {
      mediaQuery.addListener(handleMediaChange);
    }

    // Sync when window regains focus in case OS theme switched while in another window
    const handleFocus = () => {
      syncHostSystemTheme().then((activeSysTheme) => {
        const current = localStorage.getItem(storageKey) || "system";
        if (current === "system") {
          applyThemeToDOM(activeSysTheme);
        }
      });
    };
    window.addEventListener("focus", handleFocus);

    // Listen for storage changes across tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        setThemeState(e.newValue);
        if (e.newValue === "system") {
          syncHostSystemTheme().then(applyThemeToDOM);
        } else if (e.newValue === "dark" || e.newValue === "light") {
          applyThemeToDOM(e.newValue as ResolvedTheme);
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleMediaChange);
      } else {
        mediaQuery.removeListener(handleMediaChange);
      }
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [storageKey, syncHostSystemTheme, applyThemeToDOM, theme]);

  // Keep DOM in sync whenever resolvedTheme changes
  useEffect(() => {
    if (mounted) {
      applyThemeToDOM(resolvedTheme);
    }
  }, [mounted, resolvedTheme, applyThemeToDOM]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      systemTheme,
      themes: ["system", "dark", "light"],
    }),
    [theme, setTheme, resolvedTheme, systemTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
