/**
 * Application tracker stages. One source for the API's validation and every screen's wording.
 * Stored values keep their original names ('pursuing', 'applied') so existing rows and the scan
 * pipeline's reminder query (saved, pursuing or applied) keep working unchanged.
 */

export const TRACK_STATUSES = ['new', 'pursuing', 'applied', 'awarded', 'not_awarded', 'dismissed'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

/** Stages that count as an application in progress or finished. */
export const APPLICATION_STATUSES = ['pursuing', 'applied', 'awarded', 'not_awarded'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const NOTES_MAX = 4000;

export const STAGE: Record<ApplicationStatus, { label: string; short: string; icon: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  pursuing: { label: 'Preparing', short: 'Preparing', icon: 'edit_note', tone: 'info' },
  applied: { label: 'Submitted', short: 'Submitted', icon: 'send', tone: 'warning' },
  awarded: { label: 'Funded or accepted', short: 'Funded', icon: 'emoji_events', tone: 'success' },
  not_awarded: { label: 'Not funded', short: 'Not funded', icon: 'do_not_disturb_on', tone: 'neutral' }
};

export function isApplication(status: string | null | undefined): status is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(status ?? '');
}

/** Where a stage sits in the Preparing -> Submitted -> Outcome sequence (outcomes share step 2). */
export function stageStep(status: ApplicationStatus): 0 | 1 | 2 {
  return status === 'pursuing' ? 0 : status === 'applied' ? 1 : 2;
}
