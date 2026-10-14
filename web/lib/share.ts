import { formatDeadline } from '@/lib/dates';
import { safeExternalUrl } from '@/lib/safeUrl';

/**
 * Plain-text messages for sending calls to the user's own Telegram chat (/api/telegram/send), from
 * where they can forward them. *bold* markers become <b> in lib/telegram.ts.
 */

export interface ShareableCall {
  id: string;
  title: string;
  publisher?: string | null;
  officialUrl?: string | null;
  deadline?: { date: string; daysLeft?: number | null } | null;
}

/** Well under Telegram's 4096-character message limit. */
const MAX_TEXT = 1800;

function deadlineLine(d: ShareableCall['deadline']): string | null {
  if (!d?.date) return null;
  const when = d.daysLeft === undefined || d.daysLeft === null
    ? ''
    : d.daysLeft === 0
      ? ' (today)'
      : d.daysLeft === 1
        ? ' (tomorrow)'
        : d.daysLeft > 1
          ? ` (${d.daysLeft} days left)`
          : '';
  return `Deadline: ${formatDeadline(d.date)}${when}`;
}

export function callShareText(call: ShareableCall, appOrigin?: string): string {
  const official = safeExternalUrl(call.officialUrl ?? undefined);
  const lines = [
    `*${call.title}*`,
    call.publisher || null,
    deadlineLine(call.deadline),
    official ? `Official page: ${official}` : null,
    appOrigin ? `Details: ${appOrigin}/opportunities/${call.id}` : null
  ].filter(Boolean);
  return lines.join('\n').slice(0, MAX_TEXT);
}

export function digestShareText(calls: ShareableCall[], heading = 'Research calls worth a look'): string {
  const blocks: string[] = [`*${heading}*`];
  let length = blocks[0].length;
  let shown = 0;
  for (const call of calls) {
    const official = safeExternalUrl(call.officialUrl ?? undefined);
    const block = [`${shown + 1}. *${call.title}*`, deadlineLine(call.deadline), official].filter(Boolean).join('\n');
    if (length + block.length + 2 > MAX_TEXT) break;
    blocks.push(block);
    length += block.length + 2;
    shown += 1;
  }
  if (shown < calls.length) blocks.push(`…and ${calls.length - shown} more`);
  return blocks.join('\n\n');
}
