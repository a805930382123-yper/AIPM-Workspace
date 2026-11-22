import { sliceMatches } from '../../services/llm/chunk.ts';
const norm = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const matches = (text, rule) =>
  rule.variants.some((variant) => variant.every((term) => norm(text).includes(norm(term)))) &&
  !(rule.exclude ?? []).some((term) => norm(text).includes(norm(term)));
// Only rules with explicit exclusions use clause-local matching. Offsets refer to the original field.
function forbiddenMatch(text, rule) {
  if (!rule.exclude?.length) return matches(text, rule) ? { spans: [], exclusions: [] } : null;
  const spans = [],
    exclusions = [];
  const boundaries = /[。.!！?？;；,，\n\r]|但是|然而|不过|而实际上|而实际|事实上|并且|但/gu;
  let offset = 0;
  const clauses = [];
  for (const boundary of text.matchAll(boundaries)) {
    clauses.push({ start: offset, text: text.slice(offset, boundary.index) });
    offset = boundary.index + boundary[0].length;
  }
  clauses.push({ start: offset, text: text.slice(offset) });
  for (const { start, text: clause } of clauses) {
    let normalized = '',
      positions = [];
    for (let i = 0; i < clause.length;) {
      const cp = clause.codePointAt(i),
        original = String.fromCodePoint(cp),
        piece = original.normalize('NFKC');
      for (let j = 0; j < piece.length; j++) {
        const ch = piece[j],
          space = /\s/u.test(ch);
        if (space && normalized.endsWith(' ')) {
          positions.at(-1)[1] = i + original.length;
          continue;
        }
        normalized += space ? ' ' : ch;
        positions.push([i, i + original.length]);
      }
      i += original.length;
    }
    for (const variant of rule.variants) {
      const terms = variant.map(norm);
      const occurrences = terms.map((term) => {
        const found = [];
        for (let at = normalized.indexOf(term); at !== -1; at = normalized.indexOf(term, at + 1))
          found.push([at, at + term.length]);
        return found;
      });
      if (occurrences.some((items) => !items.length)) continue;
      const combinations = occurrences.reduce(
        (acc, items) => acc.flatMap((xs) => items.map((item) => [...xs, item])),
        [[]],
      );
      for (const parts of combinations) {
        const first = Math.min(...parts.map((x) => x[0])),
          last = Math.max(...parts.map((x) => x[1]));
        const segment = normalized.slice(first, last),
          before = normalized.slice(0, first);
        let reason;
        for (const excluded of rule.exclude) {
          const ex = norm(excluded);
          let pos = normalized.indexOf(ex);
          while (pos !== -1) {
            if (pos <= first && pos + ex.length >= last) {
              reason = ex;
              break;
            }
            pos = normalized.indexOf(ex, pos + 1);
          }
          if (reason) break;
          if (ex.startsWith('不证明')) {
            const rest = ex.slice('不证明'.length),
              ordered = [...parts].sort((a, b) => a[0] - b[0]);
            const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
            const sequence = ordered.map(([a, b]) => escape(normalized.slice(a, b))).join('(?:\\s|都|会)*');
            if (
              new RegExp(`^${sequence}$`, 'u').test(rest) &&
              new RegExp(`^${sequence}$`, 'u').test(segment) &&
              /(?:不证明|不能证明|不能据此证明|不能由此证明|无法证明|不足以证明)\s*$/u.test(before)
            ) {
              reason = '局部否定';
              break;
            }
          }
        }
        const range = { start: start + positions[first][0], end: start + positions[last - 1][1] };
        if (reason) exclusions.push({ ...range, reason });
        else spans.push(range);
      }
    }
  }
  return spans.length || exclusions.length ? { spans, exclusions } : null;
}
export function score(outcome, body, rawId, gold) {
  const locations = {
    document: Object.entries(outcome.document)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => ({ path: `document.${k}`, text: v })),
    source_facts: [],
    open_questions: [],
    ai_organized: [],
    ai_inferences: [],
    'templateFields.aiContent': [],
  };
  const invalidFields = [],
    evidenceFailures = [],
    refs = [],
    facts = [],
    signatures = new Set();
  let duplicates = 0,
    emptyTopics = 0,
    evidenceTotal = 0;
  for (const key of gold.requiredFields.document)
    if (typeof outcome.document?.[key] !== 'string' || !outcome.document[key].trim())
      invalidFields.push(`document.${key}`);
  if (!Array.isArray(outcome.pages) || !outcome.pages.length) invalidFields.push('pages');
  for (const [i, p] of (outcome.pages ?? []).entries()) {
    const prefix = `pages[${i}]`;
    for (const key of gold.requiredFields.pages) {
      const v = p[key],
        stringField = ['title', 'type', 'category'].includes(key);
      if (stringField ? typeof v !== 'string' || !v.trim() : !Array.isArray(v)) invalidFields.push(`${prefix}.${key}`);
    }
    const ev = p.source_evidence ?? [],
      byId = new Map(ev.map((e) => [e.id, e]));
    for (const [j, e] of ev.entries()) {
      evidenceTotal++;
      if (e.rawId !== rawId || !sliceMatches(body, e.start, e.end, e.quote))
        evidenceFailures.push(`${prefix}.source_evidence[${j}]`);
    }
    if (byId.size !== ev.length) invalidFields.push(`${prefix}.source_evidence duplicate id`);
    for (const [j, f] of (p.source_facts ?? []).entries()) {
      const at = `${prefix}.source_facts[${j}]`;
      if (typeof f.text !== 'string' || !f.text.trim() || !Array.isArray(f.evidenceIds) || !f.evidenceIds.length) {
        invalidFields.push(at);
        continue;
      }
      locations.source_facts.push({ path: at, text: f.text });
      facts.push(f);
      for (const id of f.evidenceIds) if (!byId.has(id)) refs.push(`${at}:${id}`);
      const sig = JSON.stringify([
        norm(f.text),
        f.evidenceIds
          .map((id) => {
            const e = byId.get(id);
            return e ? [e.start, e.end] : null;
          })
          .sort(),
      ]);
      if (signatures.has(sig)) duplicates++;
      else signatures.add(sig);
    }
    if (!p.title?.trim() || !(p.source_facts ?? []).some((f) => f.text?.trim())) emptyTopics++;
    for (const key of ['open_questions', 'ai_organized', 'ai_inferences'])
      for (const [j, text] of (p[key] ?? []).entries()) {
        if (typeof text !== 'string' || !text.trim()) invalidFields.push(`${prefix}.${key}[${j}]`);
        else locations[key].push({ path: `${prefix}.${key}[${j}]`, text });
      }
    for (const [key, field] of Object.entries(p.templateFields ?? {}))
      if (field.aiContent) {
        const ai = field.aiContent;
        const factIds = new Set(
          (outcome.reviewBasis?.units ?? []).flatMap((unit) => (unit.records ?? []).map((record) => record.id)),
        );
        if (
          typeof ai.text !== 'string' ||
          !ai.text.trim() ||
          !Array.isArray(ai.evidenceIds) ||
          !ai.evidenceIds.length ||
          ai.evidenceIds.some((id) => !byId.has(id)) ||
          !Array.isArray(ai.factIds) ||
          !ai.factIds.length ||
          ai.factIds.some((id) => !factIds.has(id))
        )
          invalidFields.push(`${prefix}.templateFields.${key}.aiContent`);
        if (typeof ai.text === 'string')
          locations['templateFields.aiContent'].push({
            path: `${prefix}.templateFields.${key}.aiContent`,
            text: ai.text,
          });
      }
  }
  const coverage = (rules, scope) =>
    rules.map((rule) => ({
      id: rule.id,
      locations: locations[scope].filter((x) => matches(x.text, rule)).map((x) => x.path),
    }));
  const factDetails = coverage(gold.requiredFacts, 'source_facts'),
    questionDetails = coverage(gold.requiredQuestions, 'open_questions');
  const forbiddenExclusions = [];
  const forbidden = gold.forbiddenAssertions.flatMap((rule) =>
    rule.scope.flatMap((scope) =>
      locations[scope].flatMap((x) => {
        const hit = forbiddenMatch(x.text, rule);
        if (!hit) return [];
        if (hit.exclusions.length) forbiddenExclusions.push({ id: rule.id, path: x.path, spans: hit.exclusions });
        return hit.spans.length || !rule.exclude?.length ? [{ id: rule.id, path: x.path, spans: hit.spans }] : [];
      }),
    ),
  );
  const partition = (gold.partitionRules ?? []).flatMap((rule) =>
    rule.scopes.flatMap((scope) =>
      locations[scope].filter((x) => matches(x.text, rule)).map((x) => ({ id: rule.id, path: x.path })),
    ),
  );
  return {
    validFields: { pass: !invalidFields.length && !refs.length, invalidFields, unresolvedReferences: refs },
    evidence: { passed: evidenceTotal - evidenceFailures.length, total: evidenceTotal, failures: evidenceFailures },
    facts: {
      passed: factDetails.filter((x) => x.locations.length).length,
      total: factDetails.length,
      details: factDetails,
    },
    questions: {
      passed: questionDetails.filter((x) => x.locations.length).length,
      total: questionDetails.length,
      details: questionDetails,
    },
    forbidden,
    forbiddenExclusions,
    partition,
    duplicates: { count: duplicates, total: facts.length },
    emptyTopics,
  };
}
