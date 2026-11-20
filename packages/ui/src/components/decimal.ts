/**
 * Exact decimal-string formatting for report values (FR-REPORT-011, FR-REPORT-013).
 *
 * Report values arrive as exact decimal strings ("3244.80", "-0.005", "1E+3"). Display rounding
 * must not go through binary floating point, so this works on the digit string: round half up
 * (away from zero on the magnitude), then group the integer part. The aggregated value itself is
 * never changed; callers keep the original string for comparison and CSV.
 */

export interface DecimalFormatOptions {
  /** Thousands separator; default ",". */
  groupSeparator?: string;
  /** Decimal separator; default ".". */
  decimalSeparator?: string;
  /** Group the integer part; default true. */
  grouping?: boolean;
}

export interface ParsedDecimal {
  negative: boolean;
  /** Integer digits without leading zeros ("0" for zero). */
  int: string;
  /** Fraction digits (may be empty). */
  frac: string;
}

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export const MIN_PRECISION = 0;
export const MAX_PRECISION = 6;

/** Clamp a style precision into 0–6; anything not an integer falls back to `fallback`. */
export function clampPrecision(precision: unknown, fallback = 2): number {
  if (typeof precision !== "number" || !Number.isInteger(precision)) return fallback;
  return Math.min(MAX_PRECISION, Math.max(MIN_PRECISION, precision));
}

/** Parse a decimal string (optionally with an exponent) without floating point; null if invalid. */
export function parseDecimal(value: string): ParsedDecimal | null {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return null;
  const sign = m[1] ?? "";
  let int = m[2] ?? "";
  let frac = m[3] ?? "";
  if (int === "" && frac === "") return null;
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 1000) return null;
  if (exp > 0) {
    frac = frac.padEnd(exp, "0");
    int += frac.slice(0, exp);
    frac = frac.slice(exp);
  } else if (exp < 0) {
    int = int.padStart(-exp, "0");
    frac = int.slice(int.length + exp) + frac;
    int = int.slice(0, int.length + exp);
  }
  int = int.replace(/^0+/, "") || "0";
  return { negative: sign === "-", int, frac };
}

/** Add one unit in the last place to a digit string ("199" → "200", "99" → "100"). */
function incrementDigits(digits: string): string {
  const out = digits.split("");
  let i = out.length - 1;
  while (i >= 0) {
    if (out[i] === "9") {
      out[i] = "0";
      i -= 1;
    } else {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
  }
  return "1" + out.join("");
}

function group(int: string, sep: string): string {
  let out = "";
  for (let i = 0; i < int.length; i += 1) {
    const fromEnd = int.length - i;
    out += int[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += sep;
  }
  return out;
}

/**
 * Format an exact decimal string with `precision` fraction digits (0–6), rounding half up.
 * Invalid input is returned unchanged so nothing is silently turned into a number.
 *
 * formatDecimal("3244.8", 2) → "3,244.80"; formatDecimal("-0.005", 2) → "-0.01".
 */
export function formatDecimal(
  value: string,
  precision: number,
  options: DecimalFormatOptions = {},
): string {
  const parsed = parseDecimal(value);
  if (!parsed) return value;
  const p = clampPrecision(precision);
  const { groupSeparator = ",", decimalSeparator = ".", grouping = true } = options;
  const frac = parsed.frac.padEnd(p, "0");
  let digits = parsed.int + frac.slice(0, p);
  const next = frac.charAt(p);
  if (next !== "" && next >= "5") digits = incrementDigits(digits);
  const intLen = digits.length - p;
  let int = digits.slice(0, intLen).replace(/^0+/, "") || "0";
  const kept = digits.slice(intLen);
  const isZero = /^0*$/.test(int + kept);
  if (grouping) int = group(int, groupSeparator);
  const sign = parsed.negative && !isZero ? "-" : "";
  return p > 0 ? `${sign}${int}${decimalSeparator}${kept}` : `${sign}${int}`;
}

/** True when the string is a valid decimal (used before plotting). */
export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && parseDecimal(value) !== null;
}

/** Whether an exact decimal string is negative (and not zero), without floating point. */
export function isNegativeDecimal(value: string): boolean {
  const p = parseDecimal(value);
  return !!p && p.negative && !/^0*$/.test(p.int + p.frac);
}
