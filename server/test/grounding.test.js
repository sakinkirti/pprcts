const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildSummaryProvenance,
  getSummaryTargetWords,
  supportingQuoteExists,
  validateEvidenceMap,
} = require('../grounding');

test('supportingQuoteExists accepts exact normalized source text and rejects invented text', () => {
  const source = 'The investigators enrolled 120 adults, then randomly assigned participants.';
  assert.equal(supportingQuoteExists('investigators enrolled 120 adults', source), true);
  assert.equal(supportingQuoteExists('investigators enrolled 240 children', source), false);
});

test('validateEvidenceMap drops claims without a verifiable supporting quote', () => {
  const candidate = {
    objective: [],
    methods: [
      { claim: 'The study enrolled 120 adults.', source_ids: ['S1'], supporting_quote: 'investigators enrolled 120 adults' },
      { claim: 'The study was double blind.', source_ids: ['S1'], supporting_quote: 'study was double blind' },
    ],
    results: [],
    limitations: [],
    context: [],
  };
  const validated = validateEvidenceMap(candidate, [{
    id: 'S1',
    text: 'The investigators enrolled 120 adults and randomly assigned participants.',
  }]);
  assert.equal(validated.methods.length, 1);
  assert.equal(validated.methods[0].claim, 'The study enrolled 120 adults.');
});

test('abstract-only output stays short while rich full text can support a longer briefing', () => {
  const map = {
    objective: [{ claim: 'Objective', source_ids: ['S1'] }],
    methods: Array.from({ length: 8 }, (_, index) => ({ claim: `Method ${index}`, source_ids: ['S1'] })),
    results: Array.from({ length: 12 }, (_, index) => ({ claim: `Result ${index}`, source_ids: ['S2'] })),
    limitations: [{ claim: 'Limitation', source_ids: ['S3'] }],
    context: [],
  };
  assert.ok(getSummaryTargetWords({ basis: 'abstract' }, map) <= 500);
  assert.ok(getSummaryTargetWords({ basis: 'full_text' }, map) >= 1_500);
});

test('buildSummaryProvenance exposes the evidence basis and estimated duration', () => {
  const provenance = buildSummaryProvenance(
    { basis: 'abstract', source: 'OpenAlex abstract', sections: [{ id: 'A1' }] },
    { objective: [], methods: [], results: [], limitations: [], context: [] },
    'word '.repeat(300),
  );
  assert.equal(provenance.label, 'Abstract only');
  assert.equal(provenance.estimated_minutes, 2);
});
