// B07: single source of truth for the Prompt Library size limits shared by server, UI text and
// the 施工 report. The store, the HTTP layer and the UI all import these numbers; no second copy.
export const MAX_NAME_CHARS = 200;
export const MAX_SCENARIO_CHARS = 2_000;
/** The body must support at least 10,000 characters of a real template. */
export const MAX_BODY_CHARS = 100_000;
export const MAX_REQUIREMENT_CHARS = 10_000;
export const MAX_EXAMPLES_CHARS = 50_000;
export const MAX_TAG_CHARS = 60;
export const MAX_TAGS = 50;
export const MAX_RELATED_WIKI = 50;

export const PROMPT_LIMITS = {
  name: MAX_NAME_CHARS,
  scenario: MAX_SCENARIO_CHARS,
  body: MAX_BODY_CHARS,
  inputRequirements: MAX_REQUIREMENT_CHARS,
  outputRequirements: MAX_REQUIREMENT_CHARS,
  examples: MAX_EXAMPLES_CHARS,
  tagChars: MAX_TAG_CHARS,
  tags: MAX_TAGS,
  relatedWikiIds: MAX_RELATED_WIKI,
} as const;
