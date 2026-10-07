import React from "react";
import { useTheme } from "@core/components/theme/ThemeProvider";
import { Sun, Moon } from "lucide-react";
import { Button } from "@core/components/ui/button";

/**
 * Light/Dark-Umschalter (nutzt den eigenen ThemeProvider-Context).
 */
export default function ThemeToggle() {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Dark Mode umschalten"
      title={isDark ? "Hell" : "Dunkel"}
      className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </Button>
  );
}
