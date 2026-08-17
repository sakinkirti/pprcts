const axios = require('axios');
const cheerio = require('cheerio');
const { gunzipSync } = require('node:zlib');

const OPENALEX_API_ORIGIN = 'https://api.openalex.org';
const OPENALEX_CONTENT_ORIGIN = 'https://content.openalex.org';
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_CONTENT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_EVIDENCE_CHARS = 120_000;

const CLEARLY_REUSABLE_LICENSES = new Set([
  'cc0',
  'cc-0',
  'cc-by',
  'public-domain',
  'public_domain',
  'pd',
]);

const SKIPPED_SECTION_PATTERN = /^(references?|bibliography|acknowledg(?:e)?ments?|funding|author contributions?|supplementary|appendi(?:x|ces)|conflicts? of interest|competing interests?)\b/i;

function cleanText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLicense(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '-');
}

function isClearlyReusableLicense(value) {
  const license = normalizeLicense(value);
  return CLEARLY_REUSABLE_LICENSES.has(license)
    || license.startsWith('cc-by-4')
    || license.startsWith('cc0-1');
}

function getOpenAlexWorkId(value) {
  const match = String(value || '').match(/(?:^|\/)(W\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function buildOpenAlexHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function sectionPriority(heading) {
  const value = cleanText(heading).toLowerCase();
  if (/abstract|summary/.test(value)) return 0;
  if (/method|material|experimental|procedure|study design|data collection|statistical analysis/.test(value)) return 1;
  if (/result|finding|outcome|observation/.test(value)) return 2;
  if (/limitation|strength/.test(value)) return 3;
  if (/discussion|conclusion|implication/.test(value)) return 4;
  if (/introduction|background|related work/.test(value)) return 5;
  return 6;
}

function parseTeiSections(xml, { maxSections = 28, maxSectionChars = 12_000 } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const sections = [];
  const candidates = $('text > body > div').length ? $('text > body > div') : $('body > div');

  candidates.each((_index, element) => {
    if (sections.length >= maxSections) return false;
    const node = $(element);
    const heading = cleanText(node.children('head').first().text()) || `Section ${sections.length + 1}`;
    if (SKIPPED_SECTION_PATTERN.test(heading)) return undefined;

    const paragraphs = [];
    node.find('p').each((_paragraphIndex, paragraph) => {
      const text = cleanText($(paragraph).text());
      if (text.length >= 40) paragraphs.push(text);
    });
    const text = cleanText(paragraphs.join('\n')).slice(0, maxSectionChars);
    if (text.length < 80) return undefined;
    sections.push({ id: `S${sections.length + 1}`, heading, text });
    return undefined;
  });

  if (sections.length === 0) {
    const bodyText = cleanText($('text > body').text() || $('body').text());
    for (let start = 0; start < bodyText.length && sections.length < maxSections; start += maxSectionChars) {
      const text = bodyText.slice(start, start + maxSectionChars).trim();
      if (text.length >= 80) sections.push({ id: `S${sections.length + 1}`, heading: `Full text ${sections.length + 1}`, text });
    }
  }

  return sections;
}

function decodeContentPayload(value) {
  const buffer = Buffer.isBuffer(value)
    ? value
    : value instanceof ArrayBuffer
      ? Buffer.from(value)
      : ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : Buffer.from(String(value || ''), 'utf8');

  if (buffer.length > MAX_CONTENT_BYTES) {
    throw new Error('Downloaded full text exceeds the compressed size limit');
  }

  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const decoded = isGzip
    ? gunzipSync(buffer, { maxOutputLength: MAX_DECOMPRESSED_CONTENT_BYTES })
    : buffer;

  if (decoded.length > MAX_DECOMPRESSED_CONTENT_BYTES) {
    throw new Error('Downloaded full text exceeds the decompressed size limit');
  }
  return decoded.toString('utf8');
}

function applyWorkProvenance(fallback, work, workId) {
  fallback.openAlexId = workId;
  fallback.sourceUrl = work?.best_oa_location?.landing_page_url
    || work?.best_oa_location?.url
    || fallback.sourceUrl;
  fallback.license = work?.best_oa_location?.license || null;
  fallback.version = work?.best_oa_location?.version || fallback.version;
  return fallback;
}

function makeAbstractEvidence(paper, reason = 'full_text_unavailable') {
  const abstract = cleanText(paper?.abstract);
  const openAlexId = getOpenAlexWorkId(paper?.openalex_id || paper?.paper_id || paper?.pmid);
  return {
    basis: 'abstract',
    contentStatus: abstract ? 'abstract_only' : 'metadata_only',
    source: 'Indexed abstract',
    sourceUrl: paper?.link || (openAlexId ? `https://openalex.org/works/${openAlexId}` : null),
    license: null,
    version: 'abstract',
    openAlexId,
    reason,
    warning: abstract
      ? 'Full text was unavailable for grounded analysis. This briefing is limited to claims explicitly reported in the abstract.'
      : 'No abstract or full text was available. A technical summary cannot be generated safely.',
    sections: abstract ? [{ id: 'A1', heading: 'Abstract', text: abstract }] : [],
  };
}

function workAllowsContent(work, allowUnlicensed) {
  if (allowUnlicensed) return true;
  return isClearlyReusableLicense(work?.best_oa_location?.license);
}

async function retrieveResearchEvidence(paper, options = {}) {
  const httpClient = options.httpClient || axios;
  const apiKey = options.apiKey || process.env.OPENALEX_API_KEY || '';
  const allowUnlicensed = options.allowUnlicensed
    ?? String(process.env.OPENALEX_ALLOW_UNLICENSED_FULLTEXT || '').toLowerCase() === 'true';

  const directOpenAlexId = getOpenAlexWorkId(paper?.openalex_id || paper?.paper_id || paper?.pmid);
  const pubmedId = /^\d{1,12}$/.test(String(paper?.pubmed_id || paper?.pmid || ''))
    ? String(paper?.pubmed_id || paper?.pmid)
    : null;
  if (!directOpenAlexId && !pubmedId) {
    return makeAbstractEvidence(paper, 'missing_supported_identifier');
  }

  let work;
  try {
    const workLookup = directOpenAlexId ? directOpenAlexId : `pmid:${pubmedId}`;
    const response = await httpClient.get(`${OPENALEX_API_ORIGIN}/works/${workLookup}`, {
      params: {
        select: 'id,doi,title,has_content,content_urls,best_oa_location,open_access',
      },
      headers: buildOpenAlexHeaders(apiKey),
      timeout: 12_000,
      maxContentLength: 2 * 1024 * 1024,
      responseType: 'json',
    });
    work = response.data;
  } catch (error) {
    const status = error?.response?.status;
    const reason = status === 404 ? 'not_indexed_by_openalex'
      : status === 401 || status === 403 ? 'openalex_key_required'
        : 'openalex_lookup_failed';
    return makeAbstractEvidence(paper, reason);
  }

  const workId = getOpenAlexWorkId(work?.id);
  const hasParsedContent = Boolean(work?.has_content?.grobid_xml || work?.content_urls?.grobid_xml);
  if (!workId || !hasParsedContent) {
    return applyWorkProvenance(
      makeAbstractEvidence(paper, 'parsed_full_text_unavailable'),
      work,
      workId,
    );
  }

  if (!workAllowsContent(work, allowUnlicensed)) {
    const fallback = applyWorkProvenance(makeAbstractEvidence(paper, 'license_not_confirmed'), work, workId);
    fallback.warning = 'A full-text copy was located, but its reuse license was not clearly compatible with automatic processing. This briefing uses only the abstract.';
    return fallback;
  }

  if (!apiKey) {
    const fallback = applyWorkProvenance(
      makeAbstractEvidence(paper, 'openalex_key_required_for_content'),
      work,
      workId,
    );
    fallback.warning = 'Parsed full text is available, but downloading it requires a research-catalog API key. This briefing uses the indexed abstract.';
    return fallback;
  }

  try {
    const response = await httpClient.get(`${OPENALEX_CONTENT_ORIGIN}/works/${workId}.grobid-xml`, {
      headers: buildOpenAlexHeaders(apiKey),
      timeout: 25_000,
      maxContentLength: MAX_CONTENT_BYTES,
      maxBodyLength: MAX_CONTENT_BYTES,
      responseType: 'arraybuffer',
      transformResponse: [(value) => value],
    });
    const sections = parseTeiSections(decodeContentPayload(response.data));
    if (sections.length === 0) {
      return applyWorkProvenance(makeAbstractEvidence(paper, 'full_text_parse_failed'), work, workId);
    }

    return {
      basis: 'full_text',
      contentStatus: 'full_text',
      source: 'Open-access full text',
      sourceUrl: work?.best_oa_location?.landing_page_url
        || work?.best_oa_location?.url
        || `https://openalex.org/works/${workId}`,
      license: work?.best_oa_location?.license || null,
      version: work?.best_oa_location?.version || 'unknown',
      openAlexId: workId,
      reason: 'full_text_retrieved',
      warning: work?.best_oa_location?.version === 'submittedVersion'
        ? 'This summary is grounded in a submitted manuscript or preprint, which may differ from the final peer-reviewed version.'
        : null,
      sections,
    };
  } catch (_error) {
    return applyWorkProvenance(makeAbstractEvidence(paper, 'full_text_download_failed'), work, workId);
  }
}

function formatEvidenceForPrompt(evidence, { maxChars = DEFAULT_MAX_EVIDENCE_CHARS } = {}) {
  const ordered = [...(evidence?.sections || [])]
    .map((section, index) => ({ ...section, originalIndex: index }))
    .sort((left, right) => sectionPriority(left.heading) - sectionPriority(right.heading)
      || left.originalIndex - right.originalIndex);

  let remaining = Math.max(0, maxChars);
  const selected = [];
  for (const section of ordered) {
    if (remaining < 120) break;
    const prefix = `[${section.id}] ${cleanText(section.heading)}\n`;
    const available = Math.max(0, remaining - prefix.length);
    const text = cleanText(section.text).slice(0, available);
    if (text.length < 80) continue;
    selected.push({ id: section.id, heading: section.heading, text });
    remaining -= prefix.length + text.length + 2;
  }

  const document = selected
    .map((section) => `[${section.id}] ${cleanText(section.heading)}\n${section.text}`)
    .join('\n\n');
  return { document, sections: selected };
}

module.exports = {
  cleanText,
  decodeContentPayload,
  formatEvidenceForPrompt,
  getOpenAlexWorkId,
  isClearlyReusableLicense,
  makeAbstractEvidence,
  parseTeiSections,
  retrieveResearchEvidence,
};
