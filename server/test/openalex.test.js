const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBriefingQueries,
  buildLibraryBriefingQueries,
  buildResearchProfile,
  buildWorkFilters,
  fetchBriefingCandidates,
  fetchPersonalizedBriefingCandidates,
  fetchOpenAlexWorksByAuthor,
  fetchOpenAlexWork,
  fetchOpenAlexWorks,
  isBriefingCandidateRelevant,
  mapOpenAlexWork,
  preferReusableEvidence,
  rankBriefingCandidates,
  rankTitleMatches,
  reconstructAbstract,
  scoreCandidateAgainstProfile,
  searchOpenAlexAuthors,
  searchOpenAlexWorksByTitle,
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
  assert.equal(paper.has_reusable_full_text, false);
});

test('mapOpenAlexWork identifies parsed full text only with a clearly reusable license', () => {
  const paper = mapOpenAlexWork({
    ...sampleWork,
    has_content: { grobid_xml: true },
    best_oa_location: { license: 'cc-by', landing_page_url: 'https://example.test/paper' },
  });

  assert.equal(paper.has_reusable_full_text, true);
  assert.equal(paper.full_text_license, 'cc-by');
});

test('evidence preference only reorders papers inside small relevance cohorts', () => {
  const papers = [
    { paper_id: 'W1', has_reusable_full_text: false },
    { paper_id: 'W2', has_reusable_full_text: false },
    { paper_id: 'W3', has_reusable_full_text: true },
    { paper_id: 'W4', has_reusable_full_text: true },
  ];

  assert.deepEqual(
    preferReusableEvidence(papers).map((paper) => paper.paper_id),
    ['W3', 'W1', 'W2', 'W4'],
  );
  assert.deepEqual(
    preferReusableEvidence(papers, { enabled: false }).map((paper) => paper.paper_id),
    ['W1', 'W2', 'W3', 'W4'],
  );
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

test('buildWorkFilters accepts validated additional search constraints', () => {
  assert.equal(
    buildWorkFilters({ additionalFilters: ['authorships.author.id:A123'] }),
    'is_retracted:false,type:!paratext,has_abstract:true,authorships.author.id:A123',
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

test('buildLibraryBriefingQueries prefers catalog topics and falls back to paper titles', () => {
  assert.deepEqual(buildLibraryBriefingQueries([
    { title: 'A saved paper title', primary_topic: 'Predictive coding' },
    { title: 'A second saved paper' },
  ]), [
    'Predictive coding',
    'A saved paper title',
    'A second saved paper',
  ]);
});

test('buildLibraryBriefingQueries skips broad catalog topics that would attract generic AI results', () => {
  assert.deepEqual(buildLibraryBriefingQueries([
    { primary_topic: 'Machine Learning', title: 'Spiking dynamics in visual cortex' },
  ]), ['Spiking dynamics in visual cortex']);
});

test('profile scoring keeps neuro-computational candidates and rejects mismatched healthcare AI', () => {
  const profile = buildResearchProfile({
    researchInterests: 'computational neuroscience, predictive coding',
    libraryPapers: [{
      title: 'Spiking dynamics in visual cortex',
      abstract: 'Neurons in visual cortex encode predictive errors.',
      primary_topic: 'Neuroscience',
    }],
  });
  const neuroCandidate = {
    paper_id: 'W-neuro',
    title: 'Predictive coding in cortical spiking networks',
    abstract: 'A computational neuroscience model of visual cortex neurons.',
    primary_topic: 'Neuroscience',
  };
  const healthcareCandidate = {
    paper_id: 'W-health',
    title: 'Deep learning for hospital patient diagnosis',
    abstract: 'A medical model predicts disease in clinical healthcare records.',
    primary_topic: 'Machine Learning',
  };

  assert.equal(scoreCandidateAgainstProfile(neuroCandidate, profile).eligible, true);
  assert.equal(scoreCandidateAgainstProfile(healthcareCandidate, profile).eligible, false);
  assert.deepEqual(rankBriefingCandidates([healthcareCandidate, neuroCandidate], profile)
    .map((paper) => paper.paper_id), ['W-neuro']);
});

test('profile scoring keeps healthcare candidates for users with healthcare interests', () => {
  const profile = buildResearchProfile({
    researchInterests: 'clinical diagnosis, healthcare',
    libraryPapers: [{
      title: 'Clinical decision support for patient diagnosis',
      abstract: 'Healthcare systems support clinicians in hospital medicine.',
      primary_topic: 'Medicine',
    }],
  });
  const healthcareCandidate = {
    paper_id: 'W-health',
    title: 'Deep learning for hospital patient diagnosis',
    abstract: 'A medical model predicts disease in clinical healthcare records.',
    primary_topic: 'Medicine',
  };

  assert.equal(profile.healthcareAffinity, true);
  assert.equal(scoreCandidateAgainstProfile(healthcareCandidate, profile).eligible, true);
  assert.deepEqual(rankBriefingCandidates([healthcareCandidate], profile)
    .map((paper) => paper.paper_id), ['W-health']);
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

test('fetchOpenAlexWork resolves a DOI through its canonical DOI URL', async () => {
  let request;
  const httpClient = {
    async get(url, config) {
      request = { url, config };
      return { data: sampleWork };
    },
  };
  const paper = await fetchOpenAlexWork('doi:10.1000/example', { httpClient });
  assert.equal(request.url, 'https://api.openalex.org/works/https://doi.org/10.1000/example');
  assert.equal(paper.doi, '10.1000/example');
});

test('author search resolves people before filtering their works', async () => {
  const requests = [];
  const httpClient = {
    async get(url, config) {
      requests.push({ url, config });
      if (url.endsWith('/authors')) {
        return { data: { results: [{
          id: 'https://openalex.org/A123',
          display_name: 'Ada Author',
          works_count: 12,
          cited_by_count: 34,
          last_known_institutions: [{ display_name: 'Example University' }],
        }] } };
      }
      return { data: { results: [sampleWork] } };
    },
  };
  const authors = await searchOpenAlexAuthors('Ada Author', { httpClient });
  const works = await fetchOpenAlexWorksByAuthor(authors[0].id, { httpClient });

  assert.deepEqual(authors, [{
    id: 'A123', name: 'Ada Author', works_count: 12, cited_by_count: 34, institution: 'Example University',
  }]);
  assert.equal(requests[1].config.params.filter.includes('authorships.author.id:A123'), true);
  assert.equal(requests[1].config.params.filter.includes('has_abstract:true'), false);
  assert.equal(works[0].openalex_id, 'W123456');
});

test('title search fetches a wider candidate pool and ranks an exact title first', async () => {
  let request;
  const httpClient = {
    async get(_url, config) {
      request = config;
      return { data: { results: [
        { ...sampleWork, display_name: 'Predictive coding in a broader context' },
        { ...sampleWork, id: 'https://openalex.org/W999', ids: { openalex: 'https://openalex.org/W999' }, display_name: 'Predictive coding in visual cortex' },
      ] } };
    },
  };
  const papers = await searchOpenAlexWorksByTitle('Predictive coding in visual cortex', { httpClient });
  assert.equal(request.params.per_page, 50);
  assert.equal(request.params.filter.includes('has_abstract:true'), false);
  assert.equal(papers[0].openalex_id, 'W999');
  assert.deepEqual(rankTitleMatches(papers, 'Predictive coding in visual cortex')
    .map((paper) => paper.openalex_id), ['W999', 'W123456']);
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

test('widening recency never lets older full text displace newer abstract-only candidates', async () => {
  const recentWorks = [1, 2].map((suffix) => ({
    ...sampleWork,
    id: `https://openalex.org/W${suffix}`,
    ids: { openalex: `https://openalex.org/W${suffix}` },
    display_name: `research result ${suffix}`,
  }));
  const olderFullTextWork = {
    ...sampleWork,
    id: 'https://openalex.org/W3',
    ids: { openalex: 'https://openalex.org/W3' },
    display_name: 'older research result',
    publication_date: '2026-01-15',
    has_content: { grobid_xml: true },
    best_oa_location: { license: 'cc-by' },
  };
  const httpClient = {
    async get(_url, config) {
      const isWiderWindow = config.params.filter.includes('from_publication_date:2026-02-18');
      return { data: { results: isWiderWindow ? [...recentWorks, olderFullTextWork] : recentWorks } };
    },
  };

  const result = await fetchBriefingCandidates(['research'], {
    httpClient,
    apiKey: 'test-key',
    maxResults: 3,
    perQuery: 3,
    lookbackWindows: [45, 180],
    now: new Date('2026-08-17T00:00:00Z'),
  });

  assert.equal(result.lookbackDays, 180);
  assert.deepEqual(result.papers.map((paper) => paper.openalex_id), ['W1', 'W2', 'W3']);
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

test('personalized discovery uses the library first and interests only to fill sparse results', async () => {
  const calls = [];
  const libraryPaper = { paper_id: 'W1', openalex_id: 'W1', title: 'Saved visual learning paper' };
  const libraryResult = { paper_id: 'W2', openalex_id: 'W2', title: 'Adjacent visual learning result' };
  const interestResult = { paper_id: 'W3', openalex_id: 'W3', title: 'Broader neuroscience result' };
  const fetchCandidates = async (queries, options) => {
    calls.push({
      queries,
      excludedPaperIds: new Set(options.excludedPaperIds),
      researchProfile: options.researchProfile,
    });
    return calls.length === 1
      ? { papers: [libraryPaper, libraryResult], lookbackDays: 45 }
      : { papers: [interestResult], lookbackDays: 180 };
  };

  const result = await fetchPersonalizedBriefingCandidates({
    libraryPapers: [libraryPaper],
    researchInterests: 'neuroscience',
  }, {
    maxResults: 2,
    fetchCandidates,
    excludedPaperIds: new Set(['W0']),
  });

  assert.deepEqual(calls.map((call) => call.queries), [
    ['Saved visual learning paper'],
    ['neuroscience'],
  ]);
  assert.equal(calls[0].excludedPaperIds.has('W1'), true);
  assert.equal(calls[0].researchProfile.hasSignals, true);
  assert.equal(calls[1].excludedPaperIds.has('W2'), true);
  assert.deepEqual(result.papers.map((paper) => paper.paper_id), ['W2', 'W3']);
  assert.deepEqual(result.stages.map((stage) => stage.source), ['library', 'interests']);
});

test('personalized discovery falls back directly to interests when the library is empty', async () => {
  const calls = [];
  const fetchCandidates = async (queries) => {
    calls.push(queries);
    return {
      papers: [{ paper_id: 'W9', openalex_id: 'W9', title: 'Interest result' }],
      lookbackDays: 45,
    };
  };

  const result = await fetchPersonalizedBriefingCandidates({
    libraryPapers: [],
    researchInterests: 'economic history',
  }, { fetchCandidates });

  assert.deepEqual(calls, [['economic history']]);
  assert.deepEqual(result.papers.map((paper) => paper.paper_id), ['W9']);
  assert.deepEqual(result.stages.map((stage) => stage.source), ['interests']);
});
