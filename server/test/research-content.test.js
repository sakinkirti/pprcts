const assert = require('node:assert/strict');
const test = require('node:test');
const { gzipSync } = require('node:zlib');
const {
  formatEvidenceForPrompt,
  parseTeiSections,
  retrieveResearchEvidence,
} = require('../research-content');

const sampleTei = `<?xml version="1.0"?>
<TEI><text><body>
  <div><head>Methods</head><p>The investigators enrolled 120 adults and randomly assigned them to treatment or placebo.</p></div>
  <div><head>Results</head><p>The treatment group improved by 4.2 points compared with 1.1 points in the placebo group.</p></div>
  <div><head>References</head><p>This reference paragraph is deliberately long enough to otherwise be included in the extracted content.</p></div>
</body></text></TEI>`;

test('parseTeiSections extracts substantive sections and excludes references', () => {
  const sections = parseTeiSections(sampleTei);
  assert.deepEqual(sections.map((section) => section.heading), ['Methods', 'Results']);
  assert.match(sections[0].text, /120 adults/);
});

test('formatEvidenceForPrompt prioritizes methods and results within its budget', () => {
  const formatted = formatEvidenceForPrompt({
    sections: [
      { id: 'S1', heading: 'Introduction', text: 'Background '.repeat(40) },
      { id: 'S2', heading: 'Results', text: 'Measured result '.repeat(30) },
      { id: 'S3', heading: 'Methods', text: 'Study procedure '.repeat(30) },
    ],
  }, { maxChars: 700 });
  assert.equal(formatted.sections[0].id, 'S3');
  assert.equal(formatted.sections[1].id, 'S2');
});

test('retrieveResearchEvidence downloads parsed text only for a clearly reusable license', async () => {
  const calls = [];
  const httpClient = {
    async get(url) {
      calls.push(url);
      if (url.includes('api.openalex.org')) {
        return {
          data: {
            id: 'https://openalex.org/W123',
            has_content: { grobid_xml: true },
            content_urls: { grobid_xml: 'https://content.openalex.org/works/W123.grobid-xml' },
            best_oa_location: {
              license: 'cc-by',
              version: 'publishedVersion',
              landing_page_url: 'https://example.test/article',
            },
          },
        };
      }
      return { data: sampleTei };
    },
  };

  const evidence = await retrieveResearchEvidence({
    pmid: '30049270',
    abstract: 'A short abstract.',
    link: 'https://pubmed.ncbi.nlm.nih.gov/30049270/',
  }, { httpClient, apiKey: 'test-key' });

  assert.equal(evidence.basis, 'full_text');
  assert.equal(evidence.openAlexId, 'W123');
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'https://content.openalex.org/works/W123.grobid-xml');
});

test('retrieveResearchEvidence decompresses gzipped OpenAlex TEI content', async () => {
  const httpClient = {
    async get(url) {
      if (url.includes('api.openalex.org')) {
        return {
          data: {
            id: 'https://openalex.org/W456',
            has_content: { grobid_xml: true },
            best_oa_location: {
              license: 'cc-by',
              version: 'submittedVersion',
              landing_page_url: 'https://example.test/preprint',
            },
          },
        };
      }
      return { data: gzipSync(Buffer.from(sampleTei)) };
    },
  };

  const evidence = await retrieveResearchEvidence({
    openalex_id: 'W456',
    abstract: 'A short abstract.',
  }, { httpClient, apiKey: 'test-key' });

  assert.equal(evidence.basis, 'full_text');
  assert.equal(evidence.sections.length, 2);
  assert.match(evidence.warning, /submitted manuscript or preprint/);
});

test('retrieveResearchEvidence preserves provenance when downloaded content cannot be parsed', async () => {
  const httpClient = {
    async get(url) {
      if (url.includes('api.openalex.org')) {
        return {
          data: {
            id: 'https://openalex.org/W654',
            has_content: { grobid_xml: true },
            best_oa_location: {
              license: 'cc-by',
              version: 'publishedVersion',
              landing_page_url: 'https://example.test/article',
            },
          },
        };
      }
      return { data: Buffer.from('<TEI><text><body /></text></TEI>') };
    },
  };

  const evidence = await retrieveResearchEvidence({
    openalex_id: 'W654',
    abstract: 'Fallback abstract evidence.',
  }, { httpClient, apiKey: 'test-key' });

  assert.equal(evidence.basis, 'abstract');
  assert.equal(evidence.reason, 'full_text_parse_failed');
  assert.equal(evidence.license, 'cc-by');
  assert.equal(evidence.version, 'publishedVersion');
  assert.equal(evidence.sourceUrl, 'https://example.test/article');
});

test('retrieveResearchEvidence falls back to the abstract for an unknown license', async () => {
  const httpClient = {
    async get() {
      return {
        data: {
          id: 'https://openalex.org/W123',
          has_content: { grobid_xml: true },
          best_oa_location: { license: null, version: 'acceptedVersion' },
        },
      };
    },
  };
  const evidence = await retrieveResearchEvidence({ pmid: '123', abstract: 'Reported abstract evidence.' }, { httpClient });
  assert.equal(evidence.basis, 'abstract');
  assert.equal(evidence.reason, 'license_not_confirmed');
  assert.equal(evidence.sections[0].id, 'A1');
});

test('retrieveResearchEvidence resolves non-PubMed works directly by OpenAlex ID', async () => {
  const calls = [];
  const httpClient = {
    async get(url) {
      calls.push(url);
      return {
        data: {
          id: 'https://openalex.org/W987',
          has_content: { grobid_xml: false },
          best_oa_location: { landing_page_url: 'https://arxiv.org/abs/2608.00001' },
        },
      };
    },
  };
  const evidence = await retrieveResearchEvidence({
    paper_id: 'W987',
    openalex_id: 'W987',
    abstract: 'Cross-disciplinary indexed abstract.',
  }, { httpClient });
  assert.equal(calls[0], 'https://api.openalex.org/works/W987');
  assert.equal(evidence.source, 'Indexed abstract');
  assert.equal(evidence.openAlexId, 'W987');
});

test('retrieveResearchEvidence explains when an OpenAlex key is required for content', async () => {
  const httpClient = {
    async get() {
      return {
        data: {
          id: 'https://openalex.org/W987',
          has_content: { grobid_xml: true },
          best_oa_location: { license: 'cc-by', version: 'submittedVersion' },
        },
      };
    },
  };
  const evidence = await retrieveResearchEvidence({
    openalex_id: 'W987',
    abstract: 'Indexed abstract evidence.',
  }, { httpClient, apiKey: '' });
  assert.equal(evidence.basis, 'abstract');
  assert.equal(evidence.reason, 'openalex_key_required_for_content');
  assert.match(evidence.warning, /requires a research-catalog API key/);
});
