const assert = require('node:assert/strict');
const test = require('node:test');
const {
  collectPreviouslyBriefedPaperIds,
  getPaperIdentityKeys,
  loadPreviouslyBriefedPaperIds,
  normalizePaperIdentity,
} = require('../briefing-history');

test('paper identities normalize OpenAlex, PubMed, and DOI aliases', () => {
  assert.equal(normalizePaperIdentity('https://openalex.org/w123'), 'W123');
  assert.equal(normalizePaperIdentity('https://pubmed.ncbi.nlm.nih.gov/456/'), '456');
  assert.equal(normalizePaperIdentity('https://doi.org/10.1000/EXAMPLE'), '10.1000/example');
  assert.deepEqual(getPaperIdentityKeys({
    paper_id: '456',
    openalex_id: 'W123',
    doi: '10.1000/EXAMPLE',
  }), ['456', 'W123', '10.1000/example']);
});

test('only papers from completed briefings are treated as previously used', () => {
  const usedPaperIds = collectPreviouslyBriefedPaperIds([
    { status: 'completed', paper_ids: ['W1', '123'] },
    { status: 'failed', paper_ids: ['W2'] },
    { status: 'generating', paper_ids: ['W3'] },
  ]);

  assert.deepEqual(Array.from(usedPaperIds), ['W1', '123']);
});

test('briefing history pagination collects every completed paper ID', async () => {
  const pages = [
    [{ status: 'completed', paper_ids: ['W1'] }, { status: 'completed', paper_ids: ['W2'] }],
    [{ status: 'completed', paper_ids: ['W3'] }],
  ];
  const requestedRanges = [];
  const client = {
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async (from, to) => {
          requestedRanges.push([from, to]);
          return { data: pages.shift(), error: null };
        },
      };
      return query;
    },
  };

  const paperIds = await loadPreviouslyBriefedPaperIds(client, 'user-1', 2);

  assert.deepEqual(requestedRanges, [[0, 1], [2, 3]]);
  assert.deepEqual(Array.from(paperIds), ['W1', 'W2', 'W3']);
});
