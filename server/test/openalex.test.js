const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBriefingQueries,
  buildWorkFilters,
  fetchBriefingCandidates,
  fetchOpenAlexWork,
  fetchOpenAlexWorks,
  isBriefingCandidateRelevant,
  mapOpenAlexWork,
  reconstructAbstract,
} = require('../openalex');

const sampleWork = {
  id: 'https://openalex.org/W123456',
  ids: {
    openalex: 'https://openalex.org/W123456',
    pmid: 'https://pubmed.ncbi.nlm.nih.gov/12345',
  },
  doi: 'https://doi.org/10.1000/example',
  display_name: 'A cross-disciplinary research result',
  type: 'preprint',
  publication_date: '2026-08-01',
  abstract_inverted_index: { Broad: [0], research: [1], coverage: [2] },
  authorships: [{ author: { display_name: 'Ada Researcher' } }],
  primary_location: {
    landing_page_url: 'https://arxiv.org/abs/2608.00001',
    source: { display_name: 'arXiv', type: 'repository' },
  },
  primary_topic: { display_name: 'Machine Learning' },
  indexed_in: ['arxiv'],
  cited_by_count: 7,
  open_access: { is_oa: true },
};

test('reconstructAbstract restores OpenAlex word ordering', () => {
  assert.equal(reconstructAbstract({ second: [1], first: [0], twice: [2, 3] }), 'first second twice twice');
});

test('mapOpenAlexWork exposes broad work metadata and preserves a PubMed compatibility key', () => {
  const paper = mapOpenAlexWork(sampleWork);
  assert.equal(paper.pmid, '12345');
  assert.equal(paper.openalex_id, 'W123456');
  assert.equal(paper.doi, '10.1000/example');
  assert.equal(paper.journal, 'arXiv');
  assert.equal(paper.abstract, 'Broad research coverage');
  assert.equal(paper.work_type, 'preprint');
});

test('mapOpenAlexWork uses the OpenAlex ID for works without a PMID', () => {
  const paper = mapOpenAlexWork({ ...sampleWork, ids: { openalex: sampleWork.id } });
  assert.equal(paper.pmid, 'W123456');
  assert.equal(paper.paper_id, 'W123456');
});

test('buildWorkFilters keeps search cross-disciplinary while excluding unsafe records', () => {
  assert.equal(
    buildWorkFilters({ fromPublicationDate: '2026-07-01' }),
    'is_retracted:false,type:!paratext,has_abstract:true,from_publication_date:2026-07-01',
  );
});

test('buildBriefingQueries prioritizes explicit interests and strips Boolean syntax', () => {
  assert.deepEqual(buildBriefingQueries({
    keywords: 'predictive coding, retina AND computer vision, predictive coding',
    recentTitles: ['A saved paper title'],
  }), [
    'predictive coding',
    'retina computer vision',
    'A saved paper title',
  ]);
});

test('isBriefingCandidateRelevant rejects single-token fuzzy matches for compound interests', () => {
  assert.equal(isBriefingCandidateRelevant({
    title: 'A predictive design framework for air cleaners',
    abstract: 'Engineering ventilation systems.',
    authors: [],
  }, 'predictive coding'), false);
  assert.equal(isBriefingCandidateRelevant({
    title: 'Predictive coding in visual cortex',
    abstract: 'Neural representations of sensory inputs.',
    authors: [],
  }, 'predictive coding'), true);
  assert.equal(isBriefingCandidateRelevant({
    title: 'A model of visual learning',
    abstract: '',
    authors: ['Joel Zylberberg'],
  }, 'Joel Zylberberg'), true);
});

test('fetchOpenAlexWorks sends one bounded Works query and maps the response', async () => {
  let request;
  const httpClient = {
    async get(url, config) {
      request = { url, config };
      return { data: { results: [sampleWork] } };
    },
  };
  const papers = await fetchOpenAlexWorks('machine learning OR topology', {
    httpClient,
    apiKey: 'oa-key',
    perPage: 250,
    fromPublicationDate: '2026-07-01',
  });
  assert.equal(request.url, 'https://api.openalex.org/works');
  assert.equal(request.config.params.per_page, 100);
  assert.equal(request.config.params.api_key, undefined);
  assert.equal(request.config.headers.Authorization, 'Bearer oa-key');
  assert.equal(request.config.params.search, 'machine learning OR topology');
  assert.equal(papers[0].openalex_id, 'W123456');
});

test('fetchOpenAlexWork resolves a canonical record by validated identifier', async () => {
  let request;
  const httpClient = {
    async get(url, config) {
      request = { url, config };
      return { data: sampleWork };
    },
  };
  const paper = await fetchOpenAlexWork('W123456', { httpClient, apiKey: 'oa-key' });
  assert.equal(request.url, 'https://api.openalex.org/works/W123456');
  assert.equal(request.config.headers.Authorization, 'Bearer oa-key');
  assert.equal(paper.title, sampleWork.display_name);
  assert.equal(paper.abstract, 'Broad research coverage');
});

test('fetchOpenAlexWork rejects identifiers that cannot be sent to the fixed OpenAlex endpoint', async () => {
  await assert.rejects(
    fetchOpenAlexWork('https://evil.example/work'),
    (error) => error.code === 'INVALID_PAPER_ID',
  );
});

test('fetchBriefingCandidates searches interests separately and widens recency when needed', async () => {
  const requests = [];
  const httpClient = {
    async get(_url, config) {
      requests.push(config.params);
      const isWiderWindow = config.params.filter.includes('from_publication_date:2026-02-18');
      if (!isWiderWindow) return { data: { results: [] } };
      const suffix = config.params.search === 'retina' ? '1' : '2';
      return {
        data: {
          results: [{
            ...sampleWork,
            id: `https://openalex.org/W${suffix}`,
            ids: { openalex: `https://openalex.org/W${suffix}` },
            display_name: `${config.params.search} result`,
          }],
        },
      };
    },
  };

  const result = await fetchBriefingCandidates(['retina', 'predictive coding'], {
    httpClient,
    apiKey: 'test-key',
    maxResults: 2,
    perQuery: 1,
    lookbackWindows: [45, 180],
    now: new Date('2026-08-17T00:00:00Z'),
  });

  assert.equal(result.lookbackDays, 180);
  assert.deepEqual(result.papers.map((paper) => paper.title), ['retina result', 'predictive coding result']);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map((request) => request.search), [
    'retina',
    'predictive coding',
    'retina',
    'predictive coding',
  ]);
});

test('fetchBriefingCandidates excludes previously briefed works across catalog aliases', async () => {
  const httpClient = {
    async get() {
      return {
        data: {
          results: [
            sampleWork,
            {
              ...sampleWork,
              id: 'https://openalex.org/W999',
              ids: { openalex: 'https://openalex.org/W999' },
              display_name: 'A fresh research result',
            },
          ],
        },
      };
    },
  };

  const result = await fetchBriefingCandidates(['research'], {
    httpClient,
    maxResults: 1,
    perQuery: 2,
    lookbackWindows: [45],
    excludedPaperIds: new Set(['W123456']),
  });

  assert.deepEqual(result.papers.map((paper) => paper.openalex_id), ['W999']);
});
