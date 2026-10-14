import { describe, expect, it } from 'vitest';
import { callShareText, digestShareText } from '../lib/share';
import { shareTextToTelegramHtml } from '../lib/telegram';

const call = {
  id: 'abc',
  title: 'Core Research Grant 2026',
  publisher: 'ANRF',
  officialUrl: 'https://anrfonline.in/call?id=1',
  deadline: { date: '2026-10-13', daysLeft: 5 }
};

describe('Telegram share text', () => {
  it('lists title, funder, deadline, official page and app link', () => {
    const text = callShareText(call, 'https://radar.example');
    expect(text.split('\n')).toEqual([
      '*Core Research Grant 2026*',
      'ANRF',
      'Deadline: 13 Oct 2026 (5 days left)',
      'Official page: https://anrfonline.in/call?id=1',
      'Details: https://radar.example/opportunities/abc'
    ]);
  });

  it('says today and tomorrow instead of 0 and 1 days', () => {
    expect(callShareText({ ...call, deadline: { date: '2026-10-08', daysLeft: 0 } })).toContain('(today)');
    expect(callShareText({ ...call, deadline: { date: '2026-10-09', daysLeft: 1 } })).toContain('(tomorrow)');
  });

  it('drops a scraped link that is not http(s)', () => {
    const text = callShareText({ ...call, officialUrl: 'javascript:alert(1)' });
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('Official page');
  });

  it('skips missing parts instead of printing blanks', () => {
    expect(callShareText({ id: 'x', title: 'Only a title' })).toBe('*Only a title*');
  });

  it('caps a digest and says how many were left out', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...call, id: String(i), title: `Call number ${i} with a long descriptive title` }));
    const text = digestShareText(many);
    expect(text.length).toBeLessThanOrEqual(1800);
    expect(text).toMatch(/…and \d+ more$/);
    expect(text.startsWith('*Research calls worth a look*')).toBe(true);
  });

  it('turns *bold* into Telegram HTML and escapes everything else', () => {
    expect(shareTextToTelegramHtml('*R&D <call>*\nx * y')).toBe('<b>R&amp;D &lt;call&gt;</b>\nx * y');
  });
});
