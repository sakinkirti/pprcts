const axios = require('axios');
const { getPaperIdentityKeys, normalizePaperIdentity } = require('./briefing-history');
const { hasReusableParsedFullText } = require('./content-license');

const OPENALEX_API_ORIGIN = 'https://api.openalex.org';
const EVIDENCE_PREFERENCE_BAND_SIZE = 3;
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
  const doi = String(value || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return doi || null;
}

function isDoi(value) {
  return /^10\.\d{4,9}\/\S+$/i.test(String(value || ''));
}

function normalizeAuthorId(value) {
  const match = String(value || '').match(/(?:^|\/)(A\d+)$/i);
  return match ? match[1].toUpperCase() : null;
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

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rankTitleMatches(papers, title) {
  const normalizedQuery = normalizeTitle(title);
  const queryTokens = new Set(normalizedQuery.split(' ').filter((token) => token.length >= 2));
  return papers
    .map((paper, index) => {
      const normalizedTitle = normalizeTitle(paper.title);
      const titleTokens = new Set(normalizedTitle.split(' ').filter(Boolean));
      const matchedTokens = [...queryTokens].filter((token) => titleTokens.has(token)).length;
      const exact = normalizedTitle === normalizedQuery;
      const contains = normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle);
      return {
        paper,
        index,
        score: (exact ? 10_000 : contains ? 5_000 : 0)
          + matchedTokens * 100
          - Math.abs(titleTokens.size - queryTokens.size),
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ paper }) => paper);
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
    has_reusable_full_text: hasReusableParsedFullText(work),
    full_text_license: work?.best_oa_location?.license || null,
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

function buildLibraryBriefingQueries(libraryPapers, maxQueries = 5) {
  const signals = [];
  for (const paper of libraryPapers || []) {
    if (paper?.primary_topic) signals.push(paper.primary_topic);
    if (paper?.title) signals.push(paper.title);
  }
  return buildBriefingQueries({ recentTitles: signals, maxQueries: maxQueries * 2 })
    .filter((query) => !isGenericLibraryQuery(query))
    .slice(0, maxQueries);
}

const BRIEFING_QUERY_STOP_WORDS = new Set([
  'and', 'for', 'from', 'into', 'study', 'the', 'using', 'with',
]);

const GENERIC_PROFILE_TOKENS = new Set([
  ...BRIEFING_QUERY_STOP_WORDS,
  'about', 'ai', 'analysis', 'approach', 'approaches', 'artificial', 'based', 'data', 'dataset',
  'deep', 'evaluation', 'framework', 'intelligence', 'learning', 'machine', 'method',
  'methods', 'ml', 'model', 'models', 'modelling', 'modeling', 'network', 'networks', 'new',
  'novel', 'paper', 'performance', 'predict', 'prediction', 'predictions', 'research',
  'results', 'system', 'systems', 'training', 'trained', 'use', 'via', 'work', 'works',
]);

const HEALTHCARE_DOMAIN_TOKENS = new Set([
  'clinical', 'clinician', 'clinicians', 'diagnosis', 'diagnostic', 'disease', 'diseases',
  'health', 'healthcare', 'hospital', 'hospitals', 'medical', 'medicine', 'patient',
  'patients', 'treatment', 'therapy', 'therapeutic',
]);

function getBriefingQueryTokens(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 2 && !BRIEFING_QUERY_STOP_WORDS.has(token)) || [];
}

function getProfileTokens(value) {
  return getBriefingQueryTokens(value)
    .filter((token) => !GENERIC_PROFILE_TOKENS.has(token));
}

function isGenericLibraryQuery(value) {
  const tokens = getBriefingQueryTokens(value);
  return tokens.length > 0 && tokens.every((token) => GENERIC_PROFILE_TOKENS.has(token));
}

function getCandidateResearchText(paper) {
  return [paper?.title, paper?.abstract, paper?.primary_topic, paper?.journal]
    .join(' ')
    .toLowerCase();
}

function buildResearchProfile({ libraryPapers = [], researchInterests = '' } = {}) {
  const explicitPhrases = buildBriefingQueries({ keywords: researchInterests, maxQueries: 20 });
  const explicitTokens = new Set(explicitPhrases.flatMap(getProfileTokens));
  const libraryTokenFrequency = new Map();

  for (const paper of libraryPapers) {
    const documentTokens = new Set(getProfileTokens([
      paper?.title,
      paper?.abstract,
      paper?.primary_topic,
    ].join(' ')));
    for (const token of documentTokens) {
      libraryTokenFrequency.set(token, (libraryTokenFrequency.get(token) || 0) + 1);
    }
  }

  const profileTokens = new Set([
    ...explicitTokens,
    ...libraryTokenFrequency.keys(),
  ]);
  const healthcareAffinity = [...HEALTHCARE_DOMAIN_TOKENS]
    .some((token) => profileTokens.has(token));

  return {
    explicitPhrases,
    explicitTokens,
    libraryTokenFrequency,
    healthcareAffinity,
    hasSignals: explicitTokens.size > 0 || libraryTokenFrequency.size > 0,
  };
}

function scoreCandidateAgainstProfile(paper, profile) {
  if (!profile?.hasSignals) return { eligible: true, score: 0 };

  const text = getCandidateResearchText(paper);
  const candidateTokens = new Set(getProfileTokens(text));
  const explicitPhraseMatches = profile.explicitPhrases
    .filter((phrase) => phrase.length >= 4 && text.includes(phrase.toLowerCase())).length;
  const explicitTokenMatches = [...profile.explicitTokens]
    .filter((token) => candidateTokens.has(token)).length;
  const libraryMatches = [...profile.libraryTokenFrequency.entries()]
    .filter(([token]) => candidateTokens.has(token));
  const libraryScore = libraryMatches.reduce(
    (total, [, frequency]) => total + Math.min(3, frequency),
    0,
  );
  const healthcareMatches = [...HEALTHCARE_DOMAIN_TOKENS]
    .filter((token) => candidateTokens.has(token)).length;
  const strongExplicitMatch = explicitPhraseMatches > 0 || explicitTokenMatches >= 2;
  const strongLibraryMatch = libraryMatches.length >= 3 || libraryScore >= 5;
  const healthcareMismatch = healthcareMatches > 0 && !profile.healthcareAffinity;
  const score = explicitPhraseMatches * 30
    + explicitTokenMatches * 8
    + libraryScore * 5
    - (healthcareMismatch ? 24 : 0);

  return {
    eligible: (strongExplicitMatch || strongLibraryMatch),
    score,
  };
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

function preferReusableEvidence(papers, { enabled = true } = {}) {
  if (!enabled) return [...papers];
  const preferred = [];

  // OpenAlex returns results in relevance order. Treat each small adjacent
  // cohort as effectively tied, preferring safely reusable parsed text only
  // inside that cohort so evidence availability cannot overwhelm relevance.
  for (let index = 0; index < papers.length; index += EVIDENCE_PREFERENCE_BAND_SIZE) {
    const band = papers.slice(index, index + EVIDENCE_PREFERENCE_BAND_SIZE);
    preferred.push(
      ...band.filter((paper) => paper.has_reusable_full_text),
      ...band.filter((paper) => !paper.has_reusable_full_text),
    );
  }
  return preferred;
}

function rankBriefingCandidates(papers, profile, { preferReusableFullText = true } = {}) {
  if (!profile?.hasSignals) return preferReusableEvidence(papers, { enabled: preferReusableFullText });
  const ranked = papers
    .map((paper, index) => ({ paper, index, ...scoreCandidateAgainstProfile(paper, profile) }))
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const result = [];

  // Full text remains a tie-breaker: it can only reorder candidates with the
  // same research-affinity score, never overcome a stronger profile match.
  for (let start = 0; start < ranked.length;) {
    const score = ranked[start].score;
    let end = start + 1;
    while (end < ranked.length && ranked[end].score === score) end += 1;
    result.push(...preferReusableEvidence(
      ranked.slice(start, end).map((candidate) => candidate.paper),
      { enabled: preferReusableFullText },
    ));
    start = end;
  }
  return result;
}

function buildWorkFilters({ fromPublicationDate, requireAbstract = true, additionalFilters = [] } = {}) {
  const filters = ['is_retracted:false', 'type:!paratext'];
  if (requireAbstract) filters.push('has_abstract:true');
  if (fromPublicationDate) filters.push(`from_publication_date:${fromPublicationDate}`);
  for (const filter of additionalFilters) {
    if (typeof filter === 'string' && filter.trim()) filters.push(filter.trim());
  }
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

async function searchOpenAlexAuthors(query, options = {}) {
  const httpClient = options.httpClient || axios;
  const apiKey = options.apiKey ?? process.env.OPENALEX_API_KEY ?? '';
  const response = await httpClient.get(`${OPENALEX_API_ORIGIN}/authors`, {
    params: {
      search: String(query || '').trim().slice(0, 300),
      per_page: Math.max(1, Math.min(10, Number(options.perPage) || 5)),
    },
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    timeout: 15_000,
    maxContentLength: 2 * 1024 * 1024,
    responseType: 'json',
  });
  return (Array.isArray(response?.data?.results) ? response.data.results : [])
    .map((author) => {
      const id = normalizeAuthorId(author?.id);
      if (!id) return null;
      return {
        id,
        name: String(author?.display_name || 'Unnamed author'),
        works_count: Number(author?.works_count) || 0,
        cited_by_count: Number(author?.cited_by_count) || 0,
        institution: author?.last_known_institutions?.[0]?.display_name || null,
      };
    })
    .filter(Boolean);
}

async function fetchOpenAlexWorksByAuthor(authorId, options = {}) {
  const normalizedAuthorId = normalizeAuthorId(authorId);
  if (!normalizedAuthorId) {
    const error = new Error('Unsupported author identifier');
    error.code = 'INVALID_AUTHOR_ID';
    throw error;
  }
  return fetchOpenAlexWorks('', {
    ...options,
    perPage: Math.max(1, Math.min(100, Number(options.perPage) || 50)),
    requireAbstract: options.requireAbstract ?? false,
    additionalFilters: [...(options.additionalFilters || []), `authorships.author.id:${normalizedAuthorId}`],
  });
}

async function searchOpenAlexWorksByTitle(title, options = {}) {
  const papers = await fetchOpenAlexWorks(title, {
    ...options,
    perPage: Math.max(1, Math.min(100, Number(options.perPage) || 50)),
    requireAbstract: options.requireAbstract ?? false,
  });
  return rankTitleMatches(papers, title);
}

async function fetchOpenAlexWork(identifier, options = {}) {
  const httpClient = options.httpClient || axios;
  const apiKey = options.apiKey ?? process.env.OPENALEX_API_KEY ?? '';
  const openAlexId = extractOpenAlexId(identifier);
  const doi = normalizeDoi(identifier);
  const pubmedId = /^\d{1,12}$/.test(String(identifier || ''))
    ? String(identifier)
    : null;
  const lookup = openAlexId || (pubmedId ? `pmid:${pubmedId}` : null)
    || (isDoi(doi) ? `https://doi.org/${doi}` : null);
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
  const perQuery = Math.max(1, Math.min(50, Number(options.perQuery) || 10));
  const now = options.now || new Date();
  const papersById = new Map();
  const canRetrievePreferredEvidence = Boolean(
    options.apiKey ?? process.env.OPENALEX_API_KEY ?? '',
  );
  const excludedPaperIds = new Set(
    Array.from(options.excludedPaperIds || [])
      .map(normalizePaperIdentity)
      .filter(Boolean),
  );

  for (const lookbackDays of lookbackWindows) {
    const batches = await Promise.all(normalizedQueries.map(async (query) => {
      const papers = await fetchOpenAlexWorks(query, {
        apiKey: options.apiKey,
        httpClient: options.httpClient,
        perPage: perQuery,
        fromPublicationDate: recentDate(lookbackDays, now),
      });
      const relevantPapers = papers.filter((paper) => isBriefingCandidateRelevant(paper, query));
      return rankBriefingCandidates(relevantPapers, options.researchProfile, {
        preferReusableFullText: canRetrievePreferredEvidence,
      });
    }));

    // Round-robin selection prevents one broad interest from dominating all
    // candidate slots before the user's other interests are considered.
    for (let index = 0; index < perQuery; index += 1) {
      for (const batch of batches) {
        const paper = batch[index];
        if (!paper || papersById.has(paper.paper_id)) continue;
        if (getPaperIdentityKeys(paper).some((identity) => excludedPaperIds.has(identity))) continue;
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

async function fetchPersonalizedBriefingCandidates({
  libraryPapers = [],
  researchInterests = '',
} = {}, options = {}) {
  const {
    fetchCandidates = fetchBriefingCandidates,
    ...candidateOptions
  } = options;
  const maxResults = Math.max(1, Math.min(10, Number(candidateOptions.maxResults) || 3));
  const excludedPaperIds = new Set(
    Array.from(candidateOptions.excludedPaperIds || [])
      .map(normalizePaperIdentity)
      .filter(Boolean),
  );

  // A saved paper is a preference signal, not a new discovery. Excluding all
  // of its known aliases lets OpenAlex return adjacent work instead of simply
  // placing that same library item into the briefing.
  for (const paper of libraryPapers || []) {
    for (const identity of getPaperIdentityKeys(paper)) excludedPaperIds.add(identity);
  }

  const libraryQueries = buildLibraryBriefingQueries(libraryPapers);
  const interestQueries = buildBriefingQueries({ keywords: researchInterests });
  const researchProfile = buildResearchProfile({ libraryPapers, researchInterests });
  const papers = [];
  const stages = [];

  const runStage = async (source, queries) => {
    if (queries.length === 0 || papers.length >= maxResults) return;
    const paperCountBeforeStage = papers.length;
    const result = await fetchCandidates(queries, {
      ...candidateOptions,
      maxResults: maxResults - papers.length,
      excludedPaperIds,
      researchProfile,
    });

    for (const paper of result.papers || []) {
      if (getPaperIdentityKeys(paper).some((identity) => excludedPaperIds.has(identity))) continue;
      papers.push(paper);
      for (const identity of getPaperIdentityKeys(paper)) excludedPaperIds.add(identity);
      if (papers.length >= maxResults) break;
    }
    stages.push({
      source,
      paperCount: papers.length - paperCountBeforeStage,
      lookbackDays: result.lookbackDays,
    });
  };

  await runStage('library', libraryQueries);
  await runStage('interests', interestQueries);

  return {
    papers,
    libraryQueries,
    interestQueries,
    stages,
    lookbackDays: stages.at(-1)?.lookbackDays || null,
  };
}

module.exports = {
  OPENALEX_WORK_FIELDS,
  buildBriefingQueries,
  buildLibraryBriefingQueries,
  buildResearchProfile,
  buildWorkFilters,
  extractOpenAlexId,
  extractPubmedId,
  fetchOpenAlexWorksByAuthor,
  fetchOpenAlexWork,
  fetchOpenAlexWorks,
  fetchBriefingCandidates,
  fetchPersonalizedBriefingCandidates,
  isBriefingCandidateRelevant,
  mapOpenAlexWork,
  normalizeDoi,
  normalizeAuthorId,
  normalizeTitle,
  preferReusableEvidence,
  rankBriefingCandidates,
  recentDate,
  reconstructAbstract,
  rankTitleMatches,
  searchOpenAlexAuthors,
  searchOpenAlexWorksByTitle,
  scoreCandidateAgainstProfile,
};
