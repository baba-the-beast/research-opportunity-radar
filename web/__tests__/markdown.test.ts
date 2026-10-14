import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/Markdown';

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Copilot Markdown', () => {
  it('turns headings, lists, bold and links into elements instead of showing the symbols', () => {
    const out = html('### Calls for you\n\n- **[ANRF CRG](/opportunities/abc)** — ANRF · closes 30 Nov 2026\n- Second call\n\n1. Open it\n2. Save it');
    expect(out).toContain('<p class="font-semibold');
    expect(out).toContain('<ul');
    expect(out).toContain('<ol');
    expect(out).toContain('<strong');
    expect(out).toContain('href="/opportunities/abc"');
    expect(out).not.toMatch(/###|\*\*/);
  });

  it('renders a simple table', () => {
    const out = html('| Call | Closes |\n|---|---|\n| CRG | 30 Nov |');
    expect(out).toContain('<table');
    expect(out).toContain('<th scope="col"');
    expect(out).toContain('<td');
  });

  it('never injects HTML or unsafe links', () => {
    const out = html('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [data](data:text/html,x) [ok](https://anrfonline.in/call)');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('href="data:');
    expect(out).toContain('href="https://anrfonline.in/call"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('keeps plain text and line breaks readable', () => {
    const out = html('Hi there.\nSecond line.');
    expect(out).toBe('<div class="flex flex-col gap-2 leading-relaxed"><p>Hi there.<br/>Second line.</p></div>');
  });

  it('renders a real Gemini answer: * bullets, linked bold titles, indented second lines', () => {
    const answer = [
      'Here are the open funding calls that match your edge AI research and close before January.',
      '',
      '* **[MeitY Call for Proposals on Edge AI Hardware](/opportunities/3f6c1d2e-1111-4a2b-9c3d-000000000002)** — MeitY · closes **15 Dec 2026**',
      '  Directly supports low-power AI accelerators and edge inference.',
      '* **[ANRF Core Research Grant (CRG) 2026](/opportunities/3f6c1d2e-1111-4a2b-9c3d-000000000001)** — ANRF · closes **30 Nov 2026**',
      '  Broad science and engineering funding theme.',
      '',
      'Would you like to open the MeitY call to check the full eligibility criteria?'
    ].join('\n');
    const out = html(answer);
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toContain('<strong class="font-semibold"><a class="text-primary font-medium underline underline-offset-2" href="/opportunities/3f6c1d2e-1111-4a2b-9c3d-000000000002">');
    expect(out).toContain('closes <strong class="font-semibold">15 Dec 2026</strong> Directly supports');
    expect(out).not.toMatch(/\*\*|\]\(/);
  });
});
