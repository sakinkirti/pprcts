const axios = require('axios');

const OPENALEX_API_ORIGIN = 'https://api.openalex.org';
const OPENALEX_WORK_FIELDS = [
  'id',
  'ids',
  'doi',
  'display_name',
  'title',
  'type',
  'publication_date',
  'abstract_inverted_index',
  'authorships',
  'primary_location',
  'best_oa_location',
  'open_access',
  'primary_topic',
  'indexed_in',
  'has_content',
  'content_urls',
  'cited_by_count',
  'is_retracted',
].join(',');

function extractOpenAlexId(value) {
  const match = String(value || '').match(/(?:^|\/)(W\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function extractPubmedId(value) {
  const match = String(value || '').match(/(?:^|\/)(\d+)\/?$/);
  return match ? match[1] : null;
}

function normalizeDoi(value) {
  const doi = String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return doi || null;
}

function reconstructAbstract(invertedIndex, maxChars = 60_000) {
  if (!invertedIndex || typeof invertedIndex !== 'object' || Array.isArray(invertedIndex)) return '';
  const positionedWords = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 20_000) {
        positionedWords.push([position, String(word)]);
      }
    }
  }
  positionedWords.sort((left, right) => left[0] - right[0]);
  return positionedWords.map(([, word]) => word).join(' ').slice(0, maxChars).trim();
}

function getLocationUrl(work) {
  return work?.primary_location?.landing_page_url
    || work?.best_oa_location?.landing_page_url
    || work?.open_access?.oa_url
    || work?.doi
    || work?.id
    || null;
}

function mapOpenAlexWork(work) {
  const openAlexId = extractOpenAlexId(work?.id || work?.ids?.openalex);
  if (!openAlexId) return null;
  const pubmedId = extractPubmedId(work?.ids?.pmid);
  const doi = normalizeDoi(work?.doi || work?.ids?.doi);
  const primarySource = work?.primary_location?.source;
  const authors = Array.isArray(work?.authorships)
    ? work.authorships
      .map((authorship) => authorship?.author?.display_name || authorship?.raw_author_name)
      .filter(Boolean)
      .slice(0, 100)
    : [];

  return {
    // `pmid` remains the legacy database relationship key. New non-PubMed works
    // use their stable OpenAlex W identifier here until that column is renamed.
    pmid: pubmedId || openAlexId,
    paper_id: pubmedId || openAlexId,
    openalex_id: openAlexId,
    pubmed_id: pubmedId,
    doi,
    title: String(work?.display_name || work?.title || 'Untitled work').slice(0, 1_000),
    authors,
    journal: primarySource?.display_name || 'Indexed research source',
    publication_date: String(work?.publication_date || ''),
    abstract: reconstructAbstract(work?.abstract_inverted_index),
    link: getLocationUrl(work),
    work_type: work?.type || null,
    source_type: primarySource?.type || null,
    primary_topic: work?.primary_topic?.display_name || null,
    indexed_in: Array.isArray(work?.indexed_in) ? work.indexed_in : [],
    cited_by_count: Number(work?.cited_by_count) || 0,
    is_open_access: Boolean(work?.open_access?.is_oa),
  };
}

function recentDate(days = 45, now = new Date()) {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

function normalizeBriefingQuery(value) {
  return String(value || '')
    .replace(/^[\s\d.)'"`-]+|[\s'"`]+$/g, '')
    .replace(/\b(?:AND|OR)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function buildBriefingQueries({ keywords, recentTitles = [], maxQueries = 5 } = {}) {
  const keywordQueries = String(keywords || '').split(/[,;\n]+/);
  const candidates = [...keywordQueries, ...(recentTitles || [])];
  const seen = new Set();
  const queries = [];

  for (const candidate of candidates) {
    const query = normalizeBriefingQuery(candidate);
    const key = query.toLowerCase();
    if (query.length < 3 || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length >= maxQueries) break;
  }
  return queries;
}

const BRIEFING_QUERY_STOP_WORDS = new Set([
  'and', 'for', 'from', 'into', 'study', 'the', 'using', 'with',
]);

function getBriefingQueryTokens(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 2 && !BRIEFING_QUERY_STOP_WORDS.has(token)) || [];
}

function isBriefingCandidateRelevant(paper, query) {
  const tokens = Array.from(new Set(getBriefingQueryTokens(query)));
  if (tokens.length === 0) return true;
  const searchableText = [
    paper?.title,
    paper?.abstract,
    paper?.primary_topic,
    paper?.journal,
    ...(paper?.authors || []),
  ].join(' ').toLowerCase();
  const matches = tokens.filter((token) => searchableText.includes(token)).length;
  return matches >= Math.min(2, tokens.length);
}

function buildWorkFilters({ fromPublicationDate, requireAbstract = true } = {}) {
  const filters = ['is_retracted:false', 'type:!paratext'];
  if (requireAbstract) filters.push('has_abstract:true');
  if (fromPublicationDate) filters.push(`from_publication_date:${fromPublicationDate}`);
  return filters.join(',');
}

async function fetchOpenAlexWorks(query, options = {}) {
  const httpClient = options.httpClient || axios;
  const apiKey = options.apiKey ?? process.env.OPENALEX_API_KEY ?? '';
  const perPage = Math.max(1, Math.min(100, Number(options.perPage) || 20));
  const params = {
    per_page: perPage,
    select: OPENALEX_WORK_FIELDS,
    filter: buildWorkFilters(options),
  };
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery) params.search = normalizedQuery.slice(0, 3_000);
  if (options.sort) params.sort = options.sort;
  const response = await httpClient.get(`${OPENALEX_API_ORIGIN}/works`, {
    params,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    timeout: 15_000,
    maxContentLength: 12 * 1024 * 1024,
    responseType: 'json',
  });
  const works = Array.isArray(response?.data?.results) ? response.data.results : [];
  return works.map(mapOpenAlexWork).filter(Boolean);
}

async function fetchOpenAlexWork(identifier, options = {}) {
  const httpClient = options.httpClient || axios;
  const apiKey = options.apiKey ?? process.env.OPENALEX_API_KEY ?? '';
  const openAlexId = extractOpenAlexId(identifier);
  const pubmedId = /^\d{1,12}$/.test(String(identifier || ''))
    ? String(identifier)
    : null;
  const lookup = openAlexId || (pubmedId ? `pmid:${pubmedId}` : null);
  if (!lookup) {
    const error = new Error('Unsupported paper identifier');
    error.code = 'INVALID_PAPER_ID';
    throw error;
  }

  try {
    const response = await httpClient.get(`${OPENALEX_API_ORIGIN}/works/${lookup}`, {
      params: { select: OPENALEX_WORK_FIELDS },
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeout: 15_000,
      maxContentLength: 12 * 1024 * 1024,
      responseType: 'json',
    });
    const work = response?.data;
    if (work?.is_retracted || work?.type === 'paratext') {
      const error = new Error('This work is not eligible for summarization');
      error.code = 'UNSUPPORTED_WORK';
      throw error;
    }
    const paper = mapOpenAlexWork(work);
    if (!paper) {
      const error = new Error('OpenAlex returned an invalid work record');
      error.code = 'PAPER_NOT_FOUND';
      throw error;
    }
    return paper;
  } catch (error) {
    if (['INVALID_PAPER_ID', 'UNSUPPORTED_WORK', 'PAPER_NOT_FOUND'].includes(error.code)) throw error;
    if (error?.response?.status === 404) {
      const notFoundError = new Error('Paper not found in OpenAlex');
      notFoundError.code = 'PAPER_NOT_FOUND';
      throw notFoundError;
    }
    throw error;
  }
}

async function fetchBriefingCandidates(queries, options = {}) {
  const normalizedQueries = (Array.isArray(queries) ? queries : [queries])
    .map(normalizeBriefingQuery)
    .filter(Boolean)
    .slice(0, 5);
  if (normalizedQueries.length === 0) return { papers: [], lookbackDays: null };

  const lookbackWindows = options.lookbackWindows || [45, 180, 730];
  const maxResults = Math.max(1, Math.min(10, Number(options.maxResults) || 3));
  const perQuery = Math.max(1, Math.min(5, Number(options.perQuery) || 2));
  const now = options.now || new Date();
  const papersById = new Map();

  for (const lookbackDays of lookbackWindows) {
    const batches = await Promise.all(normalizedQueries.map(async (query) => {
      const papers = await fetchOpenAlexWorks(query, {
        apiKey: options.apiKey,
        httpClient: options.httpClient,
        perPage: perQuery,
        fromPublicationDate: recentDate(lookbackDays, now),
      });
      return papers.filter((paper) => isBriefingCandidateRelevant(paper, query));
    }));

    // Round-robin selection prevents one broad interest from dominating all
    // candidate slots before the user's other interests are considered.
    for (let index = 0; index < perQuery; index += 1) {
      for (const batch of batches) {
        const paper = batch[index];
        if (!paper || papersById.has(paper.paper_id)) continue;
        papersById.set(paper.paper_id, paper);
      }
    }

    if (papersById.size >= maxResults) {
      return {
        papers: Array.from(papersById.values()).slice(0, maxResults),
        lookbackDays,
      };
    }
  }

  return {
    papers: Array.from(papersById.values()).slice(0, maxResults),
    lookbackDays: lookbackWindows.at(-1) || null,
  };
}

module.exports = {
  OPENALEX_WORK_FIELDS,
  buildBriefingQueries,
  buildWorkFilters,
  extractOpenAlexId,
  extractPubmedId,
  fetchOpenAlexWork,
  fetchOpenAlexWorks,
  fetchBriefingCandidates,
  isBriefingCandidateRelevant,
  mapOpenAlexWork,
  normalizeDoi,
  recentDate,
  reconstructAbstract,
};
