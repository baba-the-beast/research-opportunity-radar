/** Reminder windows a user may choose, in days before a deadline (mirrors the DB check constraint). */
export const REMINDER_OPTIONS = [30, 14, 7, 3, 1] as const;
export type ReminderDay = (typeof REMINDER_OPTIONS)[number];

/** The behaviour every user had before reminders were configurable: one alert 3 days ahead. */
export const DEFAULT_REMINDER_DAYS: ReminderDay[] = [3];

export const MY_DEADLINE_LABEL_MAX = 80;
