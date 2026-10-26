import type { ReactNode } from 'react';

/** Renders `**bold**`, `*italic*` and `code` without ever injecting HTML. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Minimal Markdown for the AI recap: headings, bullet lists and paragraphs. */
export function Markdown({ source }: { source: string }): JSX.Element {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushList = (): void => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key++}>
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={key++}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      blocks.push(<h3 key={key++}>{inline(heading[2] ?? '')}</h3>);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1] ?? '');
    } else if (line.trim() === '') {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushList();
  flushParagraph();
  return <div className="recap">{blocks}</div>;
}
