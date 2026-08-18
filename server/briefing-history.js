const BRIEFING_HISTORY_PAGE_SIZE = 500;

function normalizePaperIdentity(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  const openAlexMatch = rawValue.match(/(?:^|\/)(W\d+)\/?$/i);
  if (openAlexMatch) return openAlexMatch[1].toUpperCase();

  const pubmedMatch = rawValue.match(/(?:^|\/)(\d+)\/?$/);
  if (pubmedMatch) return pubmedMatch[1];

  const doi = rawValue.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  if (/^10\.\d{4,9}\//i.test(doi)) return doi.toLowerCase();

  return rawValue;
}

function getPaperIdentityKeys(paper) {
  if (typeof paper === 'string' || typeof paper === 'number') {
    const identity = normalizePaperIdentity(paper);
    return identity ? [identity] : [];
  }

  const identities = new Set();
  for (const value of [
    paper?.paper_id,
    paper?.pmid,
    paper?.pubmed_id,
    paper?.openalex_id,
    paper?.doi,
  ]) {
    const identity = normalizePaperIdentity(value);
    if (identity) identities.add(identity);
  }
  return Array.from(identities);
}

function collectPreviouslyBriefedPaperIds(briefings) {
  const paperIds = new Set();
  for (const briefing of briefings || []) {
    if (briefing?.status !== 'completed') continue;
    for (const paperId of briefing.paper_ids || []) {
      const identity = normalizePaperIdentity(paperId);
      if (identity) paperIds.add(identity);
    }
  }
  return paperIds;
}

async function loadPreviouslyBriefedPaperIds(client, userId, pageSize = BRIEFING_HISTORY_PAGE_SIZE) {
  const briefings = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from('daily_podcasts')
      .select('status, paper_ids')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = data || [];
    briefings.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return collectPreviouslyBriefedPaperIds(briefings);
}

module.exports = {
  BRIEFING_HISTORY_PAGE_SIZE,
  collectPreviouslyBriefedPaperIds,
  getPaperIdentityKeys,
  loadPreviouslyBriefedPaperIds,
  normalizePaperIdentity,
};
