import type { RosterEntry } from "@/lib/authTypes";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionTokenFor(name: string): string {
  return `@${name}`;
}

/** Resolve @Name tokens in body against the worker roster (longest names first). */
export function parseMentionedWorkerIds(
  body: string,
  workers: RosterEntry[],
): string[] {
  if (!body.includes("@") || workers.length === 0) return [];
  const sorted = [...workers].sort((a, b) => b.name.length - a.name.length);
  const found = new Set<string>();
  for (const w of sorted) {
    const re = new RegExp(`@${escapeRegExp(w.name)}\\b`, "i");
    if (re.test(body)) found.add(w.id);
  }
  return Array.from(found);
}

export function insertMention(draft: string, name: string): string {
  if (new RegExp(`@${escapeRegExp(name)}\\b`, "i").test(draft)) {
    return draft;
  }
  const token = mentionTokenFor(name);
  const trimmed = draft.trimEnd();
  if (!trimmed) return `${token} `;
  const needsSpace = !/\s$/.test(draft);
  return `${draft}${needsSpace ? " " : ""}${token} `;
}

export function removeMention(draft: string, name: string): string {
  return draft
    .replace(new RegExp(`\\s*@${escapeRegExp(name)}\\b`, "gi"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s+/, "");
}
