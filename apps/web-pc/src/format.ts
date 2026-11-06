// Ported from apps/line-mini/src/utils/format.ts (web-pc-account plan: copied, not shared).
/** Display formats (A7, A12): times in Bangkok (UTC+7, no DST), counts with separators. */
const BANGKOK_MS = 7 * 60 * 60 * 1000;

function bangkokParts(iso: string): string {
  return new Date(new Date(iso).getTime() + BANGKOK_MS).toISOString();
}

export function formatBangkokDate(iso: string): string {
  return bangkokParts(iso).slice(0, 10);
}

export function formatBangkokDateTime(iso: string): string {
  const s = bangkokParts(iso);
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
