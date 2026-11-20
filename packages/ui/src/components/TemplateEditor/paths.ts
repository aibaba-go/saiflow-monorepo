/** Path helpers shared by the editor, its error mapping and confirmations. */

export const groupPath = (gi: number) => `groups[${gi}]`;
export const itemPath = (gi: number, ii: number) => `groups[${gi}].items[${ii}]`;
export const columnPath = (gi: number, ii: number, ci: number) => `groups[${gi}].items[${ii}].columns[${ci}]`;

/** Maps an old index-based path to the new one after a structural edit; null when it was removed. */
export type PathRemap = (path: string) => string | null;

/** Remap `${base}[i]...` paths with `map(i)`; other paths are kept. */
export function remapIndexed(base: string, map: (i: number) => number | null): PathRemap {
  const head = `${base}[`;
  return (path) => {
    if (!path.startsWith(head)) return path;
    const end = path.indexOf("]", head.length);
    if (end < 0) return path;
    const i = Number(path.slice(head.length, end));
    if (!Number.isInteger(i)) return path;
    const next = map(i);
    if (next === null) return null;
    return `${head}${next}${path.slice(end)}`;
  };
}

export const swapRemap = (base: string, a: number, b: number): PathRemap =>
  remapIndexed(base, (i) => (i === a ? b : i === b ? a : i));

export const removeRemap = (base: string, at: number): PathRemap =>
  remapIndexed(base, (i) => (i === at ? null : i > at ? i - 1 : i));

/** Parent of a path: drops the last `.name` or `[n]` segment; null at the root. */
export function parentPath(path: string): string | null {
  const m = /^(.*)(?:\.[^.[\]]+|\[\d+\])$/.exec(path);
  return m && m[1] ? m[1] : null;
}

/** Stable DOM id for a path inside one editor instance. */
export function pathDomId(prefix: string, path: string): string {
  return `${prefix}-${path.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

/**
 * Suggested key from a display name (lowercase ASCII slug, `^[a-z][a-z0-9_]{0,63}$`).
 * Returns "" when the name has no Latin letters/digits (e.g. Thai), so nothing is guessed.
 */
export function slugifyKey(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) return "";
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  return s.slice(0, 64).replace(/_+$/, "");
}
