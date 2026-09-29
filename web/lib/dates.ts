/**
 * Calendar dates in India time. Agency deadlines are Indian calendar dates, so "today" and
 * "days left" must use Asia/Kolkata, not the server's UTC date (which is still "yesterday" until
 * 05:30 IST).
 */
export const IST_TIMEZONE = 'Asia/Kolkata';

/** YYYY-MM-DD for the given instant in IST. */
export function istDate(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Whole days from today (IST) until a YYYY-MM-DD deadline; negative once it has passed. */
export function daysUntil(deadline: string, today: string = istDate()): number {
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = deadline.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "15 Oct 2026" */
export function formatDeadline(deadline: string): string {
  const [y, m, d] = deadline.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

/** Date and time of an instant, shown in IST: "29 Sept 2026, 9:16 am IST". */
export function formatIstDateTime(at: string | Date): string {
  return (
    new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at)) + ' IST'
  );
}
