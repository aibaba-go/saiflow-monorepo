import type { Dayjs } from "dayjs";

/** The console shows and enters times as Bangkok time (UTC+7), whatever the browser's zone. */
const BANGKOK = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(iso: string | null | undefined): string {
  return iso ? BANGKOK.format(new Date(iso)) : "—";
}

/** A picked date-time as entered, sent as Bangkok time. */
export function toBangkokIso(value: Dayjs): string {
  return `${value.format("YYYY-MM-DDTHH:mm:ss")}+07:00`;
}

/** Plan names are product names: the same in every language. */
export const PLAN_NAMES: Record<string, string> = {
  kinder: "Kinder",
  starter: "Starter",
  intermediate: "Intermediate",
  advance: "Advance",
};
