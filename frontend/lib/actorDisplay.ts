/** Strip parenthetical role suffixes seeded into some roster names. */
export function displayName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, "").trim() || name;
}

/** Initials from a display name, ignoring parenthetical suffixes. */
export function initialsFor(name: string): string {
  const parts = displayName(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((w) => w.charAt(0).toUpperCase()).join("");
}
