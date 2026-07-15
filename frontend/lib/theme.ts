export const THEME_STORAGE_KEY = "sop-opera-theme";

export const THEMES = [
  { id: "mission-control", label: "Mission Control" },
  { id: "vscode-dark", label: "VS Code Dark" },
  { id: "light", label: "Light" },
  { id: "blueprint", label: "Blueprint" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "mission-control";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function resolveTheme(value: string | null | undefined): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}
