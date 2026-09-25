export type ContractBlock = { kind: 'title' | 'heading' | 'paragraph'; start: number; end: number };

/**
 * Split the synthetic Markdown contract into blocks while keeping offsets into the
 * original text, so located quotation spans can be drawn inside rendered headings
 * and paragraphs. `start` skips the Markdown heading marker.
 */
export function contractBlocks(source: string): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  const separator = /\n[ \t]*\n+/g;
  let cursor = 0;
  for (const match of [...source.matchAll(separator), null]) {
    const end = match ? match.index : source.length;
    const raw = source.slice(cursor, end);
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) {
      const start = cursor + leading;
      const marker = /^(#{1,6})[ \t]+/.exec(text);
      blocks.push(marker
        ? { kind: marker[1].length === 1 ? 'title' : 'heading', start: start + marker[0].length, end: start + text.length }
        : { kind: 'paragraph', start, end: start + text.length });
    }
    if (match) cursor = match.index + match[0].length;
  }
  return blocks;
}

export type Mark = { id: number; span: [number, number] };
export type Segment = { start: number; end: number; ids: number[] };

/** Partition [start, end) at every mark boundary. Each segment lists the marks covering it. */
export function segmentRange(start: number, end: number, marks: Mark[]): Segment[] {
  const inside = marks.filter(mark => mark.span[0] < end && mark.span[1] > start);
  const cuts = new Set([start, end]);
  for (const { span } of inside) {
    if (span[0] > start && span[0] < end) cuts.add(span[0]);
    if (span[1] > start && span[1] < end) cuts.add(span[1]);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const [from, to] = [points[index], points[index + 1]];
    segments.push({ start: from, end: to, ids: inside.filter(mark => mark.span[0] < to && mark.span[1] > from).map(mark => mark.id) });
  }
  return segments;
}
