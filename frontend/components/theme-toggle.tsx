"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="relative h-9 w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
      aria-label="Toggle theme"
      title={mounted ? (resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
    >
      <Sun className="h-4.5 w-4.5 rotate-0 scale-100 transition-transform duration-150 dark:-rotate-90 dark:scale-0 text-amber-500" />
      <Moon className="absolute h-4.5 w-4.5 rotate-90 scale-0 transition-transform duration-150 dark:rotate-0 dark:scale-100 text-sky-400" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
