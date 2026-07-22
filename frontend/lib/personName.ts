/** Strip seeded parenthetical role suffixes, e.g. "Meera (Panel Operator · A)" → "Meera". */
export function displayPersonName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, "").trim() || name;
}
