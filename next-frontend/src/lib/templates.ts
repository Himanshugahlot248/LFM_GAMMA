export type TemplateTheme = {
  background: string;
  card: { fill: string; radius: number; shadow: boolean };
  title: { color: string; fontSize: number; bold?: boolean };
  body: { color: string; fontSize: number };
};

export type TemplateCard = {
  key: string;
  displayName: string;
  theme: TemplateTheme;
};

export const TEMPLATE_CARDS: TemplateCard[] = [
  /** Matches deck preview / `GAMMA_DECK_PREVIEW` — default when no other theme is chosen. */
  {
    key: "gammaDefault",
    displayName: "GAMMA (Deck preview)",
    theme: {
      background: "#05070c",
      card: { fill: "#0c1118", radius: 0.4, shadow: true },
      title: { color: "#FFFFFF", fontSize: 34, bold: true },
      body: { color: "#cbd5e1", fontSize: 18 },
    },
  },
  {
    key: "clementa",
    displayName: "CLEMENTA (Warm Minimal)",
    theme: {
      background: "#CBB89D",
      card: { fill: "#E8DDC8", radius: 0.4, shadow: true },
      title: { color: "#5A4634", fontSize: 32, bold: true },
      body: { color: "#7A6A55", fontSize: 18 },
    },
  },
  {
    key: "stratos",
    displayName: "STRATOS (Dark Galaxy)",
    theme: {
      background: "#0B0F2A",
      card: { fill: "#11183C", radius: 0.4, shadow: false },
      title: { color: "#FFFFFF", fontSize: 34, bold: true },
      body: { color: "#AAB0FF", fontSize: 18 },
    },
  },
  {
    key: "nova",
    displayName: "NOVA (Light Gradient)",
    theme: {
      background: "#EAF0FF",
      card: { fill: "#FFFFFF", radius: 0.4, shadow: true },
      title: { color: "#4A5D73", fontSize: 32 },
      body: { color: "#6B7C93", fontSize: 18 },
    },
  },
  {
    key: "twilight",
    displayName: "TWILIGHT (Soft Pastel)",
    theme: {
      background: "#EAD9D2",
      card: { fill: "#F4EDE7", radius: 0.4, shadow: true },
      title: { color: "#5C4B44", fontSize: 32 },
      body: { color: "#7A6A64", fontSize: 18 },
    },
  },
  {
    key: "coralGlow",
    displayName: "CORAL GLOW",
    theme: {
      background: "#F7C6C7",
      card: { fill: "#FFFFFF", radius: 0.4, shadow: true },
      title: { color: "#A14D4E", fontSize: 32 },
      body: { color: "#6E3C3D", fontSize: 18 },
    },
  },
  {
    key: "mercury",
    displayName: "MERCURY (Metallic Light)",
    theme: {
      background: "#DDE3EA",
      card: { fill: "#F5F7FA", radius: 0.4, shadow: true },
      title: { color: "#4B5563", fontSize: 32 },
      body: { color: "#6B7280", fontSize: 18 },
    },
  },
  {
    key: "ashrose",
    displayName: "ASHROSE (Muted)",
    theme: {
      background: "#E5E5E5",
      card: { fill: "#F2F2F2", radius: 0.4, shadow: false },
      title: { color: "#6B6B6B", fontSize: 32 },
      body: { color: "#8A8A8A", fontSize: 18 },
    },
  },
  {
    key: "spectrum",
    displayName: "SPECTRUM (Colorful)",
    theme: {
      background: "#DDEBFF",
      card: { fill: "#FFFFFF", radius: 0.4, shadow: true },
      title: { color: "#3B82F6", fontSize: 32 },
      body: { color: "#6366F1", fontSize: 18 },
    },
  },
  {
    key: "stardust",
    displayName: "STARDUST (Dark Premium)",
    theme: {
      background: "#000000",
      card: { fill: "#0A0A0A", radius: 0.5, shadow: false },
      title: { color: "#FFFFFF", fontSize: 34 },
      body: { color: "#FFA500", fontSize: 18 },
    },
  },
  {
    key: "seafoam",
    displayName: "SEAFOAM",
    theme: {
      background: "#CFE8E2",
      card: { fill: "#F1FAF7", radius: 0.4, shadow: true },
      title: { color: "#2C6E65", fontSize: 32 },
      body: { color: "#3B8276", fontSize: 18 },
    },
  },
];

