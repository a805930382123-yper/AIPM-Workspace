// B07: deterministic `{{变量}}` handling for the Prompt Library.
//
// Frozen syntax (also documented in README and docs/reports/B07-build.md):
//   * A variable is `{{` + name + `}}`. The name is trimmed, so `{{ 客户名称 }}` and
//     `{{客户名称}}` are the same variable; inner spaces are kept as typed.
//   * The name must be non-empty after trimming and may not contain `{`, `}` or a line break.
//   * A placeholder with an empty name, nested braces or a newline inside is *malformed*: it is
//     never treated as a variable and is left byte-for-byte in the body.
//   * An unclosed `{{` is left as text as well.
//   * `variables` is the first-appearance order of distinct names, extracted by the server.
//   * The body is only ever checked with `trim()` for emptiness; the stored string is untouched.

export type PlaceholderSpan = { name: string; start: number; end: number };
export type MalformedSpan = {
  text: string;
  start: number;
  end: number;
  reason: 'empty' | 'braces' | 'newline' | 'unclosed';
};
export type PlaceholderScan = { variables: PlaceholderSpan[]; malformed: MalformedSpan[] };

/**
 * Scans the body once from left to right. A malformed candidate consumes its own `{{ ... }}`
 * span, so nested braces can never be re-read as a smaller valid placeholder.
 */
export function scanPlaceholders(body: string): PlaceholderScan {
  const variables: PlaceholderSpan[] = [];
  const malformed: MalformedSpan[] = [];
  let index = 0;
  while (index < body.length - 1) {
    if (body[index] !== '{' || body[index + 1] !== '{') {
      index += 1;
      continue;
    }
    const close = body.indexOf('}}', index + 2);
    if (close < 0) {
      malformed.push({ text: body.slice(index), start: index, end: body.length, reason: 'unclosed' });
      break;
    }
    const end = close + 2;
    const content = body.slice(index + 2, close);
    const name = content.trim();
    if (!name) malformed.push({ text: body.slice(index, end), start: index, end, reason: 'empty' });
    else if (/[{}]/.test(content))
      malformed.push({ text: body.slice(index, end), start: index, end, reason: 'braces' });
    else if (/[\r\n]/.test(content))
      malformed.push({ text: body.slice(index, end), start: index, end, reason: 'newline' });
    else variables.push({ name, start: index, end });
    index = end;
  }
  return { variables, malformed };
}

/** Distinct variable names in first-appearance order. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const span of scanPlaceholders(body).variables) {
    if (seen.has(span.name)) continue;
    seen.add(span.name);
    names.push(span.name);
  }
  return names;
}

export type RenderResult = { body: string; missingVariables: string[] };

/** A value counts as filled only when it is a string with non-whitespace content; `0` is valid. */
export function isFilledValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Replaces every occurrence of every variable in **one** pass, with literal string
 * concatenation — never `String.replace`, which would interpret `$&`, `$1` in the value.
 * Values are inserted verbatim: backslashes, newlines and `{{...}}` inside a value are kept
 * as data and are never re-scanned.
 */
export function renderTemplate(body: string, values: Record<string, string>): RenderResult {
  const spans = scanPlaceholders(body).variables;
  const names = [...new Set(spans.map((span) => span.name))];
  const missingVariables = names.filter((name) => !isFilledValue(values[name]));
  let rendered = '';
  let cursor = 0;
  for (const span of spans) {
    rendered += body.slice(cursor, span.start);
    rendered += values[span.name];
    cursor = span.end;
  }
  rendered += body.slice(cursor);
  return { body: rendered, missingVariables };
}
