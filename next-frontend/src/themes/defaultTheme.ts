export type UiTheme = {
  id: string;
  name: string;
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  spacing: string;
  borderRadius: string;
};

export const defaultTheme: UiTheme = {
  id: "default",
  name: "Default Aurora",
  colors: {
    primary: "#f6c445",
    secondary: "#1b6ef3",
    background: "#f8fbff",
    text: "#0f172a",
  },
  fonts: {
    heading: "var(--font-display), ui-serif, Georgia, serif",
    body: "var(--font-geist-sans), Arial, sans-serif",
  },
  spacing: "1rem",
  borderRadius: "1rem",
};

