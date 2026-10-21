// URL slugs for projects: "Imported from Jira" -> "imported-from-jira".
// Two projects with the same name get "-2", "-3" in a stable (id) order, so links never collide or change.
export const slugify = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";

export function assignSlugs(lists: { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Map<string, number>();
  for (const l of [...lists].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = slugify(l.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.set(l.id, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}
