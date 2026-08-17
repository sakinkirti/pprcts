const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RESEARCH_BRIEFING_OUTLINE_RESPONSE_FORMAT,
  buildResearchBriefingOutlineMessages,
  buildResearchBriefingSectionMessages,
  normalizeResearchBriefingOutline,
} = require('../briefing-script');

const paperPackets = [
  { paper_id: 'W1', title: 'Paper one', authors: ['Ada Author'], evidence_basis: 'full_text' },
  { paper_id: 'W2', title: 'Paper two', authors: ['Grace Author'], evidence_basis: 'abstract' },
];

test('outline schema requires typed listener-oriented sections', () => {
  const sectionSchema = RESEARCH_BRIEFING_OUTLINE_RESPONSE_FORMAT.json_schema.schema.properties.sections.items;
  assert.deepEqual(sectionSchema.properties.kind.enum, ['introduction', 'paper', 'synthesis']);
  assert.ok(sectionSchema.required.includes('kind'));
});

test('outline normalization guarantees introduction, one section per paper, and synthesis', () => {
  const outline = normalizeResearchBriefingOutline({
    title: 'A useful title',
    summary: 'A useful summary',
    sections: [
      { kind: 'paper', topic: 'Second', focus_paper_ids: ['W2'], target_word_count: 900, key_points: ['Result'] },
      { kind: 'introduction', topic: 'Start', target_word_count: 50, key_points: [] },
      { kind: 'synthesis', topic: 'End', target_word_count: 500, key_points: [] },
    ],
  }, paperPackets);

  assert.deepEqual(outline.sections.map((section) => section.kind), ['introduction', 'paper', 'paper', 'synthesis']);
  assert.deepEqual(outline.sections.map((section) => section.focus_paper_ids), [['W1', 'W2'], ['W1'], ['W2'], ['W1', 'W2']]);
  assert.equal(outline.sections[0].target_word_count, 100);
  assert.equal(outline.sections[2].target_word_count, 600);
  assert.equal(outline.sections[3].target_word_count, 260);
});

test('prompt contracts orient cold listeners and prohibit unidentified paper openings', () => {
  const outlineMessages = buildResearchBriefingOutlineMessages({
    paperPackets,
    researchInterests: 'predictive coding, retina',
    targetTotalWords: 1_000,
  });
  assert.match(outlineMessages[0].content, /listener cannot see paper cards/i);
  assert.match(outlineMessages[0].content, /one paper section per supplied paper/i);

  const sectionMessages = buildResearchBriefingSectionMessages({
    section: {
      kind: 'paper',
      topic: 'Paper one',
      target_word_count: 320,
      key_points: ['Supported result'],
    },
    sectionPackets: paperPackets.slice(0, 1),
    researchInterests: 'predictive coding',
    coveredPaperTitles: [],
    paperCount: 2,
  });
  assert.match(sectionMessages[0].content, /Identify every paper before discussing it/i);
  assert.match(sectionMessages[0].content, /silent targeting cues/i);
  assert.match(sectionMessages[1].content, /Never begin with the words "The study\."/i);
  assert.match(sectionMessages[1].content, /full text or only an abstract/i);
});
