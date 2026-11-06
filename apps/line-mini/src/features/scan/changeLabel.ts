import type { T } from "../../i18n";
import type { Lang } from "../../stores/language";
import { type Group, label } from "./structured";

const ROW = /^([^.[\]]+)\.([^.[\]]+)\[(\d+)\]\.(.+)$/;
const FIELD = /^([^.[\]]+)\.([^.[\]]+)$/;

/** A change log path in words (FR-SYS-122): "group.field" → the field's name, and
 * "group.table[i].column" → "table · row i+1 · column", in the UI language with the
 * template's default names as fallback. A path the template does not know stays as is. */
export function changeLabel(path: string, groups: Group[] | null, t: T, lang: Lang = "en"): string {
  if (!groups) return path;
  const row = ROW.exec(path);
  if (row) {
    const [, g, table, idx, col] = row;
    const item = groups.find((x) => x.key === g)?.items.find((i) => i.key === table && i.kind === "table");
    const column = item?.columns?.find((c) => c.key === col);
    if (item && column) {
      return t("review.changes.row", { table: label(item, lang), n: Number(idx) + 1, col: label(column, lang) });
    }
    return path;
  }
  const field = FIELD.exec(path);
  if (field) {
    const [, g, key] = field;
    const item = groups.find((x) => x.key === g)?.items.find((i) => i.key === key && i.kind === "field");
    if (item) return label(item, lang);
  }
  return path;
}
