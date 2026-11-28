export function wikiCreatedText(markdown: string): string | undefined {
  const created = /^created:\s*["']?([^\r\n"']+)/m.exec(markdown);
  const camelCase = /^createdAt:\s*["']?([^\r\n"']+)/m.exec(markdown);
  const snakeCase = /^created_at:\s*["']?([^\r\n"']+)/m.exec(markdown);
  return created?.[1] ?? camelCase?.[1] ?? snakeCase?.[1];
}
