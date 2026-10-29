import type { ReactNode } from 'react';

// A small Markdown subset for Verity's answers: paragraphs, headings, bullet and numbered
// lists, **bold**, *italic*, `code` and [links](https://…). It builds React elements, never
// HTML strings, so model output cannot inject markup. Only http(s) links are kept.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      return /^https?:\/\//i.test(href!) ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-verity-fg underline">
          {label}
        </a>
      ) : (
        label
      );
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      if (part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'h'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const last = blocks.at(-1);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (!line) {
      blocks.push({ kind: 'p', lines: [] });
    } else if (heading) {
      blocks.push({ kind: 'h', text: heading[1]! });
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1]!;
      if (last?.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (last?.kind === 'p') {
      last.lines.push(line);
    } else {
      blocks.push({ kind: 'p', lines: [line] });
    }
  }
  return blocks.filter((block) => block.kind !== 'p' || block.lines.length > 0);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseBlocks(text).map((block, index) => {
        const key = `b-${index}`;
        if (block.kind === 'h') {
          return (
            <p key={key} className="font-semibold text-fg">
              {renderInline(block.text, key)}
            </p>
          );
        }
        if (block.kind !== 'p') {
          const List = block.kind;
          return (
            <List key={key} className={`space-y-1 pl-5 ${block.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </List>
          );
        }
        return <p key={key}>{renderInline(block.lines.join(' '), key)}</p>;
      })}
    </div>
  );
}
