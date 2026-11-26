import type { Prompt, PromptInput } from '../../api';

export const csv = (value: string) => [
  ...new Set(
    value
      .split(/[，,、;；]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
export const emptyInput = (category: string): PromptInput => ({
  name: '',
  category,
  scenario: '',
  body: '',
  inputRequirements: '',
  outputRequirements: '',
  relatedWikiIds: [],
  examples: '',
  tags: [],
  favorite: false,
});
export const inputOf = (prompt: Prompt): PromptInput => ({
  name: prompt.name,
  category: prompt.category,
  scenario: prompt.scenario,
  body: prompt.body,
  inputRequirements: prompt.inputRequirements,
  outputRequirements: prompt.outputRequirements,
  relatedWikiIds: prompt.relatedWikiIds,
  examples: prompt.examples,
  tags: prompt.tags,
  favorite: prompt.favorite,
});
export function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === 'function') return random.call(globalThis.crypto);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export type CopyState = { status: 'idle' | 'done' | 'failed'; text: string; message: string };
/**
 * B07 repair (F07-02): a rendered body belongs to one template version *and* one exact set of values.
 * Keeping both in the preview lets copy verify that the result on screen is still the result of the
 * current input, instead of handing the user an earlier answer after they changed a variable.
 */
export type Preview = { body: string; version: number; promptId: string; signature: string };
/** Unambiguous signature of "these variables have these values" (JSON, so no separator can collide). */
export const signatureOf = (names: string[], values: Record<string, string>) =>
  JSON.stringify(names.map((name) => [name, values[name] ?? '']));
