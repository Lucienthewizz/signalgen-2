export const SINGAPORE_TIME_ZONE = "Asia/Singapore";
export const SINGAPORE_TIME_LABEL = "Singapore Time (SGT, UTC+8)";

/** A trading date is a date, not an instant: never shift it across timezones. */
export function parseCalendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return year > 0 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}
export function calendarDateValue(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function singaporeDateTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SINGAPORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function singaporeToUTC(value: string): string {
  if (
    !parseCalendarDate(value.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  )
    return "";
  const date = new Date(`${value}+08:00`);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : "";
}
export function calendarValueError(
  value: string,
  withTime = false,
  min?: string,
  max?: string,
) {
  if (!value) return "";
  if (
    !parseCalendarDate(value.slice(0, 10)) ||
    (withTime ? !singaporeToUTC(value) : value.length !== 10)
  )
    return withTime
      ? "Enter a valid date and time: YYYY-MM-DD HH:mm (SGT)."
      : "Enter a valid date: YYYY-MM-DD.";
  if (min && value < min) return `Choose ${min.replace("T", " ")} or later.`;
  if (max && value > max) return `Choose ${max.replace("T", " ")} or earlier.`;
  return "";
}
