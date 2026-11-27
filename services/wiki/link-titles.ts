import { fromMarkdown } from 'mdast-util-from-markdown';

export function wikiLinkTitles(body: string): Set<string> {
  const titles = new Set<string>();
  if (!body.includes('[[')) return titles;

  // Match the source spelling and use CommonMark offsets to skip code and other non-link contexts.
  const tree = fromMarkdown(body);
  const excluded: Array<{ start: number; end: number }> = [];
  function collect(node: (typeof tree.children)[number] | typeof tree) {
    switch (node.type) {
      case 'code':
      case 'inlineCode':
      case 'html':
      case 'definition':
      case 'image':
      case 'imageReference':
      case 'link':
      case 'linkReference': {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) excluded.push({ start, end });
        break;
      }
      default:
        if ('children' in node) for (const child of node.children) collect(child);
    }
  }
  collect(tree);

  let next = 0;
  for (const match of body.matchAll(/(?<!\[)\[\[([^\][\r\n]+)\]\](?!\])/gu)) {
    const start = match.index;
    while (excluded[next]?.end <= start) next += 1;
    if (excluded[next]?.start < start + match[0].length) continue;
    let before = start;
    while (body[before - 1] === '\\') before -= 1;
    if ((start - before) % 2 !== 0) continue;
    const title = match[1].trim();
    if (title) titles.add(title);
  }
  return titles;
}
