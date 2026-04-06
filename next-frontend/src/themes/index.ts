import { defaultTheme, type UiTheme } from "./defaultTheme";
import { darkTheme } from "./darkTheme";
import { minimalTheme } from "./minimalTheme";

export const THEMES: Record<string, UiTheme> = {
  [defaultTheme.id]: defaultTheme,
  [darkTheme.id]: darkTheme,
  [minimalTheme.id]: minimalTheme,
};

export const THEME_LIST: UiTheme[] = [defaultTheme, darkTheme, minimalTheme];

