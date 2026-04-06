"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { THEME_LIST, THEMES } from "@/themes";
import type { UiTheme } from "@/themes/defaultTheme";

type ThemeContextValue = {
  currentTheme: UiTheme;
  setTheme: (themeId: string) => void;
  themes: UiTheme[];
};

const STORAGE_KEY = "lf_ui_theme_id";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeToDocument(theme: UiTheme) {
  const root = document.documentElement;
  root.style.setProperty("--ui-primary", theme.colors.primary);
  root.style.setProperty("--ui-secondary", theme.colors.secondary);
  root.style.setProperty("--ui-bg", theme.colors.background);
  root.style.setProperty("--ui-text", theme.colors.text);
  root.style.setProperty("--ui-font-heading", theme.fonts.heading);
  root.style.setProperty("--ui-font-body", theme.fonts.body);
  root.style.setProperty("--ui-spacing", theme.spacing);
  root.style.setProperty("--ui-radius", theme.borderRadius);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>("default");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && THEMES[stored]) setThemeId(stored);
    } catch {
      // ignore storage failures
    }
  }, []);

  const currentTheme = useMemo(() => THEMES[themeId] ?? THEMES.default, [themeId]);

  useEffect(() => {
    applyThemeToDocument(currentTheme);
    try {
      localStorage.setItem(STORAGE_KEY, currentTheme.id);
    } catch {
      // ignore storage failures
    }
  }, [currentTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      currentTheme,
      setTheme: (id: string) => {
        if (!THEMES[id]) return;
        setThemeId(id);
      },
      themes: THEME_LIST,
    }),
    [currentTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

