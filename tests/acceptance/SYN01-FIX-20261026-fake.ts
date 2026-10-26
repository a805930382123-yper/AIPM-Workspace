import assert from 'node:assert/strict';

/** SYNTHETIC fixture adapter only. Authored Raw/ranges select the containing
 * request anchor; this helper never searches quotes or repairs product output. */
export function synthesisFixture(request: { user: string }, authored: any) {
  const input = JSON.parse(request.user);
  assert.equal(input.synthesis_format_version, 1);
  const output = { ...authored, synthesis_format_version: 1 };
  for (const field of ['suggestedAdditions', 'conflicts', 'agreement']) {
    if (!Array.isArray(output[field])) continue;
    output[field] = output[field].map((item: any) => {
      const raw = input.raws.find((entry: any) => entry.id === item.rawId);
      const locator = raw?.locators.find((entry: any) => entry.start <= item.start && entry.end >= item.end);
      assert(locator, 'SYNTHETIC authored range must belong to the supplied Raw catalog');
      return { text: item.text, rawId: raw.id, locatorId: locator.id };
    });
  }
  return output;
}
