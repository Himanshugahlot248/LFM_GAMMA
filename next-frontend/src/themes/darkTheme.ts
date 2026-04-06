import type { UiTheme } from "./defaultTheme";

export const darkTheme: UiTheme = {
  id: "dark",
  name: "Dark Modern",
  colors: {
    primary: "#60a5fa",
    secondary: "#22d3ee",
    background: "#05070c",
    text: "#e5e7eb",
  },
  fonts: {
    heading: "var(--font-display), ui-serif, Georgia, serif",
    body: "var(--font-geist-sans), Arial, sans-serif",
  },
  spacing: "1rem",
  borderRadius: "1rem",
};

