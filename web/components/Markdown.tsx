import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { safeExternalUrl } from '@/lib/safeUrl';

/**
 * Renders the Copilot's Markdown as React elements: headings, paragraphs, bullet and numbered
 * lists, quotes, simple tables, **bold**, *italic*, `code` and [links](url). It never injects HTML,
 * so text quoted from a scraped call cannot add markup; links are app paths or http(s) only.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="flex flex-col gap-2 leading-relaxed">{blocks(text)}</div>;
}

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**')) return <strong key={i} className="font-semibold">{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith('`')) return <code key={i} className="px-1 py-0.5 rounded bg-surface-container text-[0.92em]">{part.slice(1, -1)}</code>;
    if (part.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      if (m) return <MdLink key={i} href={m[2]}>{inline(m[1])}</MdLink>;
    }
    if ((part.startsWith('*') || part.startsWith('_')) && part.length > 2) return <em key={i}>{inline(part.slice(1, -1))}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function MdLink({ href, children }: { href: string; children: ReactNode }) {
  const cls = 'text-primary font-medium underline underline-offset-2';
  // App paths stay in the app; anything else must be http(s), otherwise it is shown as plain text
  if (/^\/(?!\/)/.test(href)) return <Link href={href} className={cls}>{children}</Link>;
  const url = safeExternalUrl(href);
  if (!url) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  );
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `b${out.length}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = HEADING.exec(line);
    if (h) {
      // Answers sit in a narrow panel: every heading level becomes one modest size
      out.push(<p key={key()} className={`font-semibold text-on-surface ${h[1].length <= 2 ? 'text-[15px]' : 'text-[14px]'} mt-1`}>{inline(h[2])}</p>);
      i++; continue;
    }
    if (RULE.test(line)) { out.push(<hr key={key()} className="border-outline-variant/40" />); i++; continue; }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={key()} className="overflow-x-auto -mx-1">
          <table className="w-full text-left text-[12.5px] border-collapse">
            <thead><tr>{head.map((c, j) => <th key={j} scope="col" className="px-2 py-1 border-b border-outline-variant/60 font-semibold">{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="px-2 py-1 border-b border-outline-variant/30 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    const listKind = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : null;
    if (listKind) {
      const re = listKind === 'ul' ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = re.exec(lines[i])![1];
        i++;
        // A wrapped item continues on indented lines that are not a new item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const List = listKind;
      out.push(
        <List key={key()} className={`${listKind === 'ul' ? 'list-disc' : 'list-decimal'} pl-5 flex flex-col gap-1`}>
          {items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </List>
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])![1]);
      out.push(<div key={key()} className="pl-3 border-l-2 border-primary/50 text-on-surface-variant">{inline(quoted.join(' '))}</div>);
      continue;
    }

    // Paragraph: consecutive plain lines, joined with line breaks as written
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !QUOTE.test(lines[i]) && !TABLE_ROW.test(lines[i]) && !RULE.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(<p key={key()}>{para.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l.trim())}</Fragment>)}</p>);
  }
  return out;
}
