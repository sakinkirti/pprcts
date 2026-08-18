require('dotenv').config();

const express = require('express');
// Polyfill for Node 18 environment where File is missing (needed by Supabase/Undici)
const { Blob } = require('buffer');
if (!global.Blob) global.Blob = Blob;
if (!global.File) {
  global.File = class File extends Blob {
    constructor(parts, filename, properties) {
      super(parts, properties);
      this.name = filename;
    }
  };
}
const axios = require('axios');
const crypto = require('crypto');
const {
  publicClient,
  adminClient,
  createUserClient,
  requireAdminClient,
} = require('./supabase');
const { encryptSecret, decryptSecret, getEncryptionKey } = require('./secrets');
const {
  fetchOpenAlexWork,
  fetchOpenAlexWorks,
  fetchPersonalizedBriefingCandidates,
  recentDate,
} = require('./openalex');
const { addPaperToLibrary } = require('./library');
const { loadPreviouslyBriefedPaperIds } = require('./briefing-history');
const {
  getZonedDateTime,
  isBriefingStale,
  normalizeBriefingCadence,
  shouldGenerateScheduledBriefing,
  shouldRunSchedulerForUser,
} = require('./briefing-schedule');
const {
  formatEvidenceForPrompt,
  retrieveResearchEvidence,
} = require('./research-content');
const {
  EVIDENCE_MAP_RESPONSE_FORMAT,
  buildEvidenceExtractionMessages,
  buildGroundedSummaryMessages,
  buildSummaryProvenance,
  countEvidenceClaims,
  getSummaryTargetWords,
  validateEvidenceMap,
} = require('./grounding');
const {
  RESEARCH_BRIEFING_OUTLINE_RESPONSE_FORMAT,
  buildResearchBriefingOutlineMessages,
  buildResearchBriefingSectionMessages,
  normalizeResearchBriefingOutline,
} = require('./briefing-script');
const {
  securityHeaders,
  corsAllowlist,
  rateLimit,
  requireAuth,
  isIsoDate,
} = require('./security');
const { buildSpeechRequest } = require('./speech');

const app = express();
const PORT = process.env.PORT || 5000;

app.disable('x-powered-by');

function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  requireAdminClient();
  getEncryptionKey();
  if (!process.env.RATE_LIMIT_HASH_SALT || process.env.RATE_LIMIT_HASH_SALT.length < 32) {
    throw new Error('RATE_LIMIT_HASH_SALT must contain at least 32 characters in production');
  }
  const origins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('ALLOWED_ORIGINS must contain explicit HTTPS origins in production');
  }
}

assertProductionConfiguration();

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(corsAllowlist);
app.use(express.json({ limit: '256kb', strict: true }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyPrefix: 'global',
  client: adminClient,
}));

// Auth Middleware
const authMiddleware = async (req, res, next) => {
  const authorization = req.get('authorization');
  req.supabase = publicClient;

  if (!authorization) return next();
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return res.status(401).json({ error: 'Malformed authorization header' });

  const token = match[1];
  const { data: { user }, error } = await publicClient.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }
  req.user = user;
  req.accessToken = token;
  req.supabase = createUserClient(token);
  next();
};

app.use(authMiddleware);

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

const BRIEFING_FAILURE_SUMMARY = 'Generation failed. You can try again.';

async function markBriefingFailed(client, userId, date) {
  const { error } = await client
    .from('daily_podcasts')
    .update({ status: 'failed', summary: BRIEFING_FAILURE_SUMMARY })
    .eq('user_id', userId)
    .eq('date', date);
  if (error) throw error;
}

async function recoverStaleBriefing(client, briefing) {
  if (!isBriefingStale(briefing)) return briefing;
  await markBriefingFailed(client, briefing.user_id, briefing.date);
  return { ...briefing, status: 'failed', summary: BRIEFING_FAILURE_SUMMARY };
}

const aiRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyPrefix: 'ai',
  client: adminClient,
  failClosed: Boolean(adminClient),
});

async function getOpenAIKey(userId) {
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from('user_settings')
    .select('openai_key_ciphertext')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (data?.openai_key_ciphertext) return decryptSecret(data.openai_key_ciphertext);
  return null;
}

async function getOpenAlexKey(userId) {
  if (!userId) return null;
  if (!adminClient) return process.env.OPENALEX_API_KEY || null;
  const { data, error } = await adminClient
    .from('user_settings')
    .select('openalex_key_ciphertext')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data?.openalex_key_ciphertext
    ? decryptSecret(data.openalex_key_ciphertext)
    : process.env.OPENALEX_API_KEY || null;
}

function openAIRequestConfig(apiKey, requestId, extra = {}) {
  return {
    ...extra,
    timeout: 90_000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Client-Request-Id': requestId,
      ...(extra.headers || {}),
    },
  };
}

const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o';
const isSupportedPaperId = (value) => /^(?:\d{1,12}|W\d+)$/i.test(String(value || ''));
async function extractValidatedEvidence(apiKey, paper, evidence, requestId, maxChars = 120_000) {
  const formatted = formatEvidenceForPrompt(evidence, { maxChars });
  if (!formatted.document || formatted.sections.length === 0) {
    const error = new Error('No source evidence is available for a grounded summary');
    error.code = 'INSUFFICIENT_EVIDENCE';
    throw error;
  }

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: SUMMARY_MODEL,
    messages: buildEvidenceExtractionMessages(paper, formatted.document, evidence),
    response_format: EVIDENCE_MAP_RESPONSE_FORMAT,
    temperature: 0,
    max_tokens: 5_000,
  }, openAIRequestConfig(apiKey, `${requestId}-evidence`));

  const raw = response.data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(raw || '{}');
  const evidenceMap = validateEvidenceMap(parsed, formatted.sections);
  if (countEvidenceClaims(evidenceMap) === 0) {
    const error = new Error('The model could not verify any claims against the available source');
    error.code = 'INSUFFICIENT_EVIDENCE';
    throw error;
  }
  return evidenceMap;
}

async function generateGroundedBriefing(apiKey, paper, evidence, evidenceMap, requestId) {
  const targetWords = getSummaryTargetWords(evidence, evidenceMap);
  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: SUMMARY_MODEL,
    messages: buildGroundedSummaryMessages(paper, evidence, evidenceMap, targetWords),
    temperature: 0.1,
    max_tokens: Math.min(8_192, Math.max(1_200, targetWords * 2)),
  }, openAIRequestConfig(apiKey, `${requestId}-briefing`));
  return response.data.choices?.[0]?.message?.content?.trim() || '';
}

async function prepareGroundedPaper(apiKey, openAlexApiKey, paper, requestId, maxChars) {
  const evidence = await retrieveResearchEvidence(paper, {
    apiKey: openAlexApiKey,
  });
  const evidenceMap = await extractValidatedEvidence(apiKey, paper, evidence, requestId, maxChars);
  return { evidence, evidenceMap };
}

app.get('/api/settings/openai-key/status', requireAuth, async (req, res) => {
  try {
    const admin = requireAdminClient();
    const { data, error } = await admin
      .from('user_settings')
      .select('openai_key_ciphertext, openai_key_last_four')
      .eq('user_id', req.user.id)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.set('Cache-Control', 'no-store');
    res.json({
      configured: Boolean(data?.openai_key_ciphertext),
      lastFour: data?.openai_key_last_four || null,
    });
  } catch (error) {
    console.error(`[${req.requestId}] OpenAI key status error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Unable to load API key status' });
  }
});

app.put('/api/settings/openai-key', requireAuth, async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!/^sk-[A-Za-z0-9_-]{20,200}$/.test(key)) {
    return res.status(400).json({ error: 'Enter a valid OpenAI API key' });
  }
  try {
    const admin = requireAdminClient();
    const { error } = await admin.from('user_settings').upsert({
      user_id: req.user.id,
      openai_key_ciphertext: encryptSecret(key),
      openai_key_last_four: key.slice(-4),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json({ configured: true, lastFour: key.slice(-4) });
  } catch (error) {
    console.error(`[${req.requestId}] OpenAI key save error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Unable to save API key' });
  }
});

app.delete('/api/settings/openai-key', requireAuth, async (req, res) => {
  try {
    const admin = requireAdminClient();
    const { error } = await admin
      .from('user_settings')
      .update({
        openai_key_ciphertext: null,
        openai_key_last_four: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    console.error(`[${req.requestId}] OpenAI key delete error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Unable to delete API key' });
  }
});

app.get('/api/settings/openalex-key/status', requireAuth, async (req, res) => {
  try {
    const admin = requireAdminClient();
    const { data, error } = await admin
      .from('user_settings')
      .select('openalex_key_ciphertext, openalex_key_last_four')
      .eq('user_id', req.user.id)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.set('Cache-Control', 'no-store');
    res.json({
      configured: Boolean(data?.openalex_key_ciphertext),
      lastFour: data?.openalex_key_last_four || null,
    });
  } catch (error) {
    console.error(`[${req.requestId}] OpenAlex key status error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Unable to load OpenAlex key status' });
  }
});

app.put('/api/settings/openalex-key', requireAuth, async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!/^[A-Za-z0-9._-]{12,256}$/.test(key)) {
    return res.status(400).json({ error: 'Enter a valid OpenAlex API key' });
  }
  try {
    const admin = requireAdminClient();
    const { error } = await admin.from('user_settings').upsert({
      user_id: req.user.id,
      openalex_key_ciphertext: encryptSecret(key),
      openalex_key_last_four: key.slice(-4),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json({ configured: true, lastFour: key.slice(-4) });
  } catch (error) {
    console.error(`[${req.requestId}] OpenAlex key save error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Unable to save OpenAlex key' });
  }
});

app.delete('/api/settings/openalex-key', requireAuth, async (req, res) => {
  try {
    const admin = requireAdminClient();
    const { error } = await admin
      .from('user_settings')
      .update({
        openalex_key_ciphertext: null,
        openalex_key_last_four: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    console.error(`[${req.requestId}] OpenAlex key delete error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Unable to delete OpenAlex key' });
  }
});

// Retrieve User Library
app.get('/api/library', requireAuth, async (req, res) => {
  const { data, error } = await req.supabase
    .from('user_library')
    .select('saved_at, papers(*)')
    .eq('user_id', req.user.id)
    .order('saved_at', { ascending: false });

  if (error) {
    console.error(`[${req.requestId}] Library query error:`, error.message);
    return res.status(500).json({ error: 'Unable to load library' });
  }

  // Flatten structure for frontend
  const library = data.map(item => ({
    ...item.papers,
    saved_at: item.saved_at
  }));

  res.json({ library });
});

// Search OpenAlex across titles, abstracts, and indexed full text. OpenAlex's
// core corpus includes journal articles, conference papers, books, theses, and
// trusted preprint repositories such as arXiv.
app.get('/api/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 300) {
    return res.status(400).json({ error: 'Search query must be between 1 and 300 characters' });
  }
  try {
    const openAlexApiKey = await getOpenAlexKey(req.user?.id);
    const results = await fetchOpenAlexWorks(query, { perPage: 20, apiKey: openAlexApiKey });
    res.json({ results, source: 'OpenAlex' });
  } catch (error) {
    console.error(`[${req.requestId}] OpenAlex search error:`, error?.response?.status || error.message);
    res.status(502).json({ error: 'Unable to reach the research catalog' });
  }
});

// Recommendations Endpoint
app.get('/api/recommendations', async (req, res) => {
  try {
    let searchTerm = '';
    let recommendationType = 'Noteworthy new research';

    let customKeywords = '';
    if (req.user) {
      const { data, error: settingsError } = await req.supabase
        .from('user_settings')
        .select('keywords')
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (settingsError) throw settingsError;
      customKeywords = data?.keywords || '';
    }

    if (customKeywords && customKeywords.trim() !== '') {
      const keywordsArray = customKeywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 20);
      searchTerm = keywordsArray.map((keyword) => keyword.includes(' ') ? `"${keyword}"` : keyword).join(' OR ');
      recommendationType = 'Based on your research interests';
    }

    const openAlexApiKey = await getOpenAlexKey(req.user?.id);
    const results = await fetchOpenAlexWorks(searchTerm, {
      apiKey: openAlexApiKey,
      perPage: 20,
      fromPublicationDate: recentDate(60),
      sort: searchTerm ? undefined : 'cited_by_count:desc',
    });
    res.json({ results, type: recommendationType, source: 'OpenAlex' });

  } catch (error) {
    console.error('OpenAlex Recommendations Error:', error?.response?.status || error.message);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// Generate an evidence-grounded paper briefing. Full text is retrieved transiently
// and only provenance plus the derived summary are persisted.
app.post('/api/summarize', requireAuth, aiRateLimit, async (req, res) => {
  const requestedPaperId = String(
    req.body?.paper_id || req.body?.pmid || req.body?.openalex_id || '',
  );
  if (!isSupportedPaperId(requestedPaperId)) {
    return res.status(400).json({ error: 'A supported paper identifier is required' });
  }

  try {
    const admin = requireAdminClient();
    const openAlexApiKey = await getOpenAlexKey(req.user.id);
    // Treat the browser payload as an identifier only. Metadata and abstracts
    // are resolved from OpenAlex before they can enter the shared cache.
    const paper = await fetchOpenAlexWork(requestedPaperId, { apiKey: openAlexApiKey });
    const paperId = paper.paper_id;
    // 1. Check the global cache. Legacy abstract-stretched summaries have no
    // summary_basis and are intentionally regenerated.
    const { data: cachedPaper } = await admin
      .from('papers')
      .select('summary, summary_basis, summary_metadata')
      .eq('pmid', paperId)
      .maybeSingle();

    if (cachedPaper?.summary && cachedPaper?.summary_basis) {
      console.log(`Cache hit for ${paperId}`);
      await addPaperToLibrary(req.supabase, req.user.id, paperId);
      return res.json({
        summary: cachedPaper.summary,
        provenance: cachedPaper.summary_metadata?.provenance || null,
      });
    }

    const openaiApiKey = await getOpenAIKey(req.user.id);

    if (!openaiApiKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }

    const { evidence, evidenceMap } = await prepareGroundedPaper(
      openaiApiKey,
      openAlexApiKey,
      paper,
      `summary-${req.requestId}`,
      120_000,
    );
    const summary = await generateGroundedBriefing(
      openaiApiKey,
      paper,
      evidence,
      evidenceMap,
      `summary-${req.requestId}`,
    );
    if (!summary) throw new Error('The summary model returned no content');

    const provenance = buildSummaryProvenance(evidence, evidenceMap, summary);
    const summaryFingerprint = crypto.createHash('sha256').update(summary).digest('hex');

    // 2. Persist to Global Papers
    if (paperId) {
      const { error: upsertError } = await admin.from('papers').upsert({
        pmid: paperId,
        openalex_id: paper.openalex_id,
        pubmed_id: paper.pubmed_id,
        doi: paper.doi,
        title: paper.title,
        authors: paper.authors,
        journal: paper.journal,
        publication_date: paper.publication_date,
        abstract: paper.abstract,
        summary,
        summary_basis: evidence.basis,
        summary_metadata: { provenance },
        summary_fingerprint: summaryFingerprint,
        content_status: evidence.contentStatus,
        content_source: evidence.source,
        content_url: evidence.sourceUrl,
        content_license: evidence.license,
        content_version: evidence.version,
        content_retrieved_at: new Date().toISOString(),
        work_type: paper.work_type,
        source_type: paper.source_type,
        primary_topic: paper.primary_topic,
        audio_path: null,
      }, { onConflict: 'pmid' });

      if (upsertError) console.error('Supabase upsert error:', upsertError);

      await addPaperToLibrary(req.supabase, req.user.id, paperId);
    }

    res.json({ summary, provenance });
  } catch (error) {
    console.error(`[${req.requestId}] Summary generation error:`, error?.response?.status || error.message);
    const status = error.code === 'SERVER_CONFIGURATION_ERROR' ? 503
      : error.code === 'INVALID_PAPER_ID' ? 400
        : error.code === 'PAPER_NOT_FOUND' || error.code === 'UNSUPPORTED_WORK' ? 422
      : error.code === 'INSUFFICIENT_EVIDENCE' ? 422
        : error?.response?.status === 429 ? 429 : 502;
    const message = error.code === 'PAPER_NOT_FOUND' || error.code === 'UNSUPPORTED_WORK'
      ? 'This paper could not be verified in the research catalog.'
      : error.code === 'INSUFFICIENT_EVIDENCE'
        ? 'There was not enough verifiable source material to create a reliable summary.'
        : 'Failed to generate summary';
    res.status(status).json({ error: message });
  }
});

// Endpoint to convert summary to speech using OpenAI TTS
app.post('/api/tts', requireAuth, aiRateLimit, async (req, res) => {
  const paperId = String(req.body?.paper_id || req.body?.pmid || '');
  console.log(`[TTS] Request received for paper: ${paperId || 'none'}.`);

  if (!isSupportedPaperId(paperId)) {
    return res.status(400).json({ error: 'A supported paper identifier is required' });
  }
  try {
    const admin = requireAdminClient();
    // The persistent audio cache is derived only from a server-stored summary.
    // Caller-provided text is intentionally ignored to prevent cache poisoning.
    const { data: paper, error: paperError } = await admin
      .from('papers')
      .select('summary, summary_fingerprint, audio_path')
      .eq('pmid', paperId)
      .maybeSingle();
    if (paperError) throw paperError;
    if (!paper?.summary || !paper.summary_fingerprint) {
      return res.status(409).json({ error: 'Generate a grounded summary before requesting audio' });
    }
    const summary = paper.summary;
    if (summary.length > 40_000) {
      return res.status(422).json({ error: 'Stored summary is too long for audio generation' });
    }

    if (paper.audio_path) {
      console.log(`Audio Cache hit for ${paperId}`);
      const { data: fileData, error: downloadError } = await admin.storage
        .from('audio-summaries')
        .download(paper.audio_path);

      if (!downloadError && fileData) {
        const buffer = Buffer.from(await fileData.arrayBuffer());
        res.set({
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': 'inline; filename="summary.mp3"'
        });
        return res.send(buffer);
      }
    }

    // Generate audio as before (split into chunks, stitch together)
    const chunkSize = 2000;
    const chunks = [];
    for (let i = 0; i < summary.length; i += chunkSize) {
      chunks.push(summary.slice(i, i + chunkSize));
    }

    console.log(`[TTS] Generating audio for ${paperId || 'unsaved paper'} in ${chunks.length} chunks...`);

    const openaiApiKey = await getOpenAIKey(req.user.id);

    if (!openaiApiKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }
    const audioBuffers = [];
    for (const chunk of chunks) {
      const ttsRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        buildSpeechRequest(chunk),
        {
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
            'X-Client-Request-Id': req.requestId,
          },
          responseType: 'arraybuffer',
          timeout: 90_000,
        },
      );
      audioBuffers.push(Buffer.from(ttsRes.data));
    }
    const stitchedAudio = Buffer.concat(audioBuffers);

    // 2. Upload to Supabase Storage and update the cached paper when identified.
    const fileName = `${paperId}_${paper.summary_fingerprint.slice(0, 20)}.mp3`;
    console.log(`[TTS] Uploading ${fileName} to private storage...`);
    const { error: uploadError } = await admin.storage
      .from('audio-summaries')
      .upload(fileName, stitchedAudio, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (uploadError) throw uploadError;
    console.log(`[TTS] Successfully uploaded ${fileName}. Updating papers table...`);
    const { error: updateError } = await admin
      .from('papers')
      .update({ audio_path: fileName })
      .eq('pmid', paperId)
      .eq('summary_fingerprint', paper.summary_fingerprint);

    if (updateError) {
      console.error('[TTS] Error updating papers table:', updateError.message);
      throw updateError;
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="summary.mp3"'
    });
    console.log(`[TTS] Sending ${stitchedAudio.length} bytes of audio back to client.`);
    res.send(stitchedAudio);
  } catch (error) {
    console.error(`[${req.requestId}] TTS error:`, error?.response?.status || error.message);
    const status = error.code === 'SERVER_CONFIGURATION_ERROR' ? 503
      : error?.response?.status === 429 ? 429 : 502;
    res.status(status).json({ error: 'Failed to generate TTS audio' });
  }
});

// Endpoint to fetch user's briefing history
app.get('/api/briefings/history', requireAuth, async (req, res) => {
  try {
    const { data: briefings, error } = await req.supabase
      .from('daily_podcasts')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Generate signed URLs for all audio paths
    // Note: Creating many signed URLs in a loop might be slow if list is huge, 
    // but for personal history it's fine for now. 
    // Optimization: Create signed URLs only when playing? 
    // For now, let's just send the data. The frontend might need to request a specific URL when playing 
    // OR we generate them here if the token lifespan is long enough. 
    // Let's generate them here for simplicity as we do in single-fetch.

    const admin = requireAdminClient();
    const briefingsWithUrls = await Promise.all(briefings.map(async (briefing) => {
      const b = await recoverStaleBriefing(admin, briefing);
      let audio_url = null;
      if (b.audio_path) {
        const { data } = await req.supabase.storage
          .from('daily-podcasts')
          .createSignedUrl(b.audio_path, 3600);
        audio_url = data?.signedUrl;
      }
      return { ...b, audio_url };
    }));

    res.json({ briefings: briefingsWithUrls });
  } catch (error) {
    console.error('Briefing History Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch briefing history' });
  }
});


// Generate an on-demand or automatically scheduled research briefing.
const generateResearchBriefing = async (userId, supabaseClient, userDate = null) => {
  const today = userDate || new Date().toISOString().split('T')[0];
  console.log('Generating research briefing for user:', userId, 'Date:', today);

  try {
    // 1. Fetch User Interests from Library
    const [libraryResult, settingsResult, previouslyBriefedPaperIds] = await Promise.all([
      supabaseClient
        .from('user_library')
        .select('papers(pmid, pubmed_id, openalex_id, doi, title, abstract, primary_topic)')
        .eq('user_id', userId)
        .order('saved_at', { ascending: false })
        .limit(20),
      supabaseClient
        .from('user_settings')
        .select('keywords')
        .eq('user_id', userId)
        .maybeSingle(),
      loadPreviouslyBriefedPaperIds(supabaseClient, userId),
    ]);
    if (libraryResult.error) throw libraryResult.error;
    if (settingsResult.error) throw settingsResult.error;

    const libraryPapers = (libraryResult.data || [])
      .map((item) => item.papers)
      .filter(Boolean);
    const researchInterests = String(settingsResult.data?.keywords || '').trim();
    if (libraryPapers.length === 0 && !researchInterests) {
      throw new Error('Add research interests or save a paper before generating a briefing.');
    }

    // 2. Fetch and decrypt the user's API key on the trusted server only.
    const openaiApiKey = await getOpenAIKey(userId);
    if (!openaiApiKey) {
      throw new Error('OpenAI API key required for podcast generation');
    }
    const openAlexApiKey = await getOpenAlexKey(userId);

    // 3. Let the recent research library drive discovery first. Broader saved
    // interests only fill slots that library-derived searches cannot supply.
    const discovery = await fetchPersonalizedBriefingCandidates({
      libraryPapers,
      researchInterests,
    }, {
      apiKey: openAlexApiKey,
      maxResults: 3,
      perQuery: 25,
      excludedPaperIds: previouslyBriefedPaperIds,
    });
    const papers = discovery.papers;
    const discoveryStages = discovery.stages
      .map((stage) => `${stage.source}:${stage.paperCount}`)
      .join(', ');
    console.log(`[Research Briefing] Discovery found ${papers.length} unused candidates (${discoveryStages || 'no search stage'}) using a ${discovery.lookbackDays}-day window; library papers: ${libraryPapers.length}; excluded previous briefing papers: ${previouslyBriefedPaperIds.size}.`);

    if (papers.length === 0) {
      throw new Error('No new papers with abstracts matched the research library or saved interests. Papers from completed briefings are not reused.');
    }

    const groundedPapers = [];
    for (const paper of papers) {
      console.log(`[Research Briefing] Preparing evidence for paper ${paper.paper_id}...`);
      try {
        const { evidence, evidenceMap } = await prepareGroundedPaper(
          openaiApiKey,
          openAlexApiKey,
          paper,
          `podcast-${userId}-${today}-${paper.paper_id}`,
          55_000,
        );
        groundedPapers.push({ paper, evidence, evidenceMap });
      } catch (error) {
        console.warn(`[Research Briefing] Skipping paper ${paper.paper_id}: ${error.message}`);
      }
    }

    if (groundedPapers.length === 0) {
      throw new Error('No papers had enough verifiable evidence for this briefing.');
    }

    const paperPackets = groundedPapers.map(({ paper, evidence, evidenceMap }) => ({
      paper_id: paper.paper_id,
      openalex_id: paper.openalex_id,
      title: paper.title,
      authors: paper.authors?.slice(0, 4) || [],
      journal: paper.journal,
      publication_date: paper.publication_date,
      work_type: paper.work_type,
      source_type: paper.source_type,
      primary_topic: paper.primary_topic,
      evidence_basis: evidence.basis,
      manuscript_version: evidence.version,
      content_source: evidence.source,
      content_license: evidence.license,
      evidence_warning: evidence.warning,
      evidence: evidenceMap,
    }));
    const targetTotalWords = Math.max(600, Math.min(2_200,
      220 + groundedPapers.reduce((total, item) => total + Math.min(
        item.evidence.basis === 'full_text' ? 650 : 240,
        getSummaryTargetWords(item.evidence, item.evidenceMap),
      ), 0)));

    // --- HIERARCHICAL GENERATION START ---

    // 5a. Step 1: Generate Outline
    console.log('[Research Briefing] Generating outline...');
    const outlineRes = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: SUMMARY_MODEL,
      messages: buildResearchBriefingOutlineMessages({
        paperPackets,
        researchInterests,
        targetTotalWords,
      }),
      response_format: RESEARCH_BRIEFING_OUTLINE_RESPONSE_FORMAT,
      temperature: 0,
    }, openAIRequestConfig(openaiApiKey, `podcast-outline-${userId}-${today}`));

    const outlineData = normalizeResearchBriefingOutline(
      JSON.parse(outlineRes.data.choices[0].message.content),
      paperPackets,
    );

    // 5b. Step 2: Generate Script Section by Section
    let fullScript = "";
    const coveredPaperTitles = new Set();

    for (const section of outlineData.sections) {
      console.log(`[Research Briefing] Generating section ${section.id}: ${section.topic}`);

      const focusPapers = groundedPapers.filter(({ paper }) => section.focus_paper_ids?.includes(paper.paper_id));
      const sectionPackets = (focusPapers.length > 0 ? focusPapers : groundedPapers).map(({ paper, evidence, evidenceMap }) => ({
        paper_id: paper.paper_id,
        openalex_id: paper.openalex_id,
        title: paper.title,
        authors: paper.authors?.slice(0, 4) || [],
        journal: paper.journal,
        publication_date: paper.publication_date,
        work_type: paper.work_type,
        source_type: paper.source_type,
        primary_topic: paper.primary_topic,
        evidence_basis: evidence.basis,
        manuscript_version: evidence.version,
        content_source: evidence.source,
        content_license: evidence.license,
        evidence_warning: evidence.warning,
        evidence: evidenceMap,
      }));

      const sectionRes = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: SUMMARY_MODEL,
        messages: buildResearchBriefingSectionMessages({
          section,
          sectionPackets,
          researchInterests,
          coveredPaperTitles: Array.from(coveredPaperTitles),
          paperCount: groundedPapers.length,
        }),
        temperature: 0.1,
      }, openAIRequestConfig(openaiApiKey, `podcast-section-${userId}-${today}-${section.id}`));

      const sectionText = sectionRes.data.choices[0].message.content;
      fullScript += sectionText + "\n\n";

      // Track covered papers
      if (section.kind === 'paper') {
        focusPapers.forEach(({ paper }) => coveredPaperTitles.add(paper.title));
      }
    }

    const transcript = fullScript;
    const chunkSize = 4096;
    const chunks = [];
    for (let i = 0; i < transcript.length; i += chunkSize) {
      chunks.push(transcript.slice(i, i + chunkSize));
    }

    const audioBuffers = [];
    console.log('[Research Briefing] Generating audio chunk by chunk...');
    for (const chunk of chunks) {
      const ttsRes = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        buildSpeechRequest(chunk),
        openAIRequestConfig(openaiApiKey, `podcast-audio-${userId}-${today}`, {
          responseType: 'arraybuffer',
        }),
      );
      audioBuffers.push(Buffer.from(ttsRes.data));
    }
    const finalAudio = Buffer.concat(audioBuffers);
    const fileName = `${userId}/${today}/briefing.mp3`;

    console.log('[Research Briefing] Uploading audio to storage...');
    const { error: uploadError } = await requireAdminClient().storage
      .from('daily-podcasts')
      .upload(fileName, finalAudio, { contentType: 'audio/mpeg', upsert: true });

    if (uploadError) throw uploadError;

    console.log('[Research Briefing] Saving briefing metadata...');
    const { data: newPodcast, error: insertError } = await supabaseClient
      .from('daily_podcasts')
      .upsert({
        user_id: userId,
        date: today,
        title: outlineData.title || `Research Briefing: ${today}`,
        summary: outlineData.summary,
        transcript: transcript,
        audio_path: fileName,
        paper_ids: groundedPapers.map(({ paper }) => paper.paper_id),
        papers_metadata: groundedPapers.map(({ paper, evidence, evidenceMap }) => {
          const contentProvenance = { ...buildSummaryProvenance(evidence, evidenceMap, '') };
          delete contentProvenance.word_count;
          delete contentProvenance.estimated_minutes;
          return {
            ...paper,
            summary_provenance: contentProvenance,
          };
        }),
        status: 'completed'
      }, { onConflict: 'user_id, date' })
      .select()
      .single();

    if (insertError) throw insertError;
    return newPodcast;

  } catch (error) {
    console.error('Generation Job Error:', error.message);
    try {
      await markBriefingFailed(supabaseClient, userId, today);
    } catch (recoveryError) {
      console.error('Could not persist failed briefing status:', recoveryError.message);
    }
    throw error;
  }
};

// Return a requested briefing date, or the user's latest briefing when no date is supplied.
app.get('/api/daily-podcast', requireAuth, async (req, res) => {
  try {
    const queryDate = req.query.date;
    if (queryDate && !isIsoDate(queryDate)) return res.status(400).json({ error: 'Invalid date' });
    let briefingQuery = req.supabase
      .from('daily_podcasts')
      .select('*')
      .eq('user_id', req.user.id);

    briefingQuery = queryDate
      ? briefingQuery.eq('date', queryDate)
      : briefingQuery.order('date', { ascending: false }).limit(1);

    const { data: queriedPodcast, error: queryError } = await briefingQuery.maybeSingle();
    if (queryError) throw queryError;

    if (queriedPodcast) {
      const existingPodcast = await recoverStaleBriefing(requireAdminClient(), queriedPodcast);
      let audio_url = null;
      if (existingPodcast.audio_path) {
        console.log(`[Research Briefing] Cache hit: serving audio for ${existingPodcast.date}`);
        const { data: signedUrlData } = await req.supabase.storage
          .from('daily-podcasts')
          .createSignedUrl(existingPodcast.audio_path, 3600);
        audio_url = signedUrlData?.signedUrl;
      } else {
        console.log(`[Research Briefing] Polling status: ${existingPodcast.status} for ${existingPodcast.date}`);
      }

      return res.json({
        ...existingPodcast,
        audio_url
      });
    }

    res.status(404).json({ error: 'No research briefing has been generated yet.', code: 'not_generated' });
  } catch (error) {
    console.error('Research Briefing Check Error:', error.message);
    res.status(500).json({ error: 'Failed to check research briefing status' });
  }
});

// Generate a research briefing explicitly. Manual generation is available at every cadence.
app.post('/api/daily-podcast/generate', requireAuth, aiRateLimit, async (req, res) => {
  const { date } = req.body;
  if (!isIsoDate(date)) {
    return res.status(400).json({ error: 'A valid date is required' });
  }

  try {
    const admin = requireAdminClient();
    const { data: existing, error: existingError } = await admin
      .from('daily_podcasts')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('date', date)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing?.status === 'completed') return res.json(existing);
    if (existing?.status === 'generating') {
      if (!isBriefingStale(existing)) {
        return res.status(409).json({ error: 'Briefing generation is already in progress', podcast: existing });
      }
      await markBriefingFailed(admin, req.user.id, date);
    }

    const { data: placeholder, error } = await admin
      .from('daily_podcasts')
      .upsert({
        user_id: req.user.id,
        date: date,
        status: 'generating',
        title: 'Generating Briefing...',
        summary: 'We are curating your personalized research update. This usually takes a few minutes.',
        created_at: new Date().toISOString(),
      }, { onConflict: 'user_id, date' })
      .select()
      .single();

    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Briefing generation is already in progress' });
    }
    if (error) throw error;

    // 2. Start generation in background (DO NOT AWAIT)
    generateResearchBriefing(req.user.id, admin, date)
      .then(() => console.log(`Background generation success for ${req.user.id}`))
      .catch(err => console.error(`Background generation failure for ${req.user.id}:`, err));

    // 3. Return the placeholder immediately
    res.status(202).json(placeholder);
  } catch (error) {
    console.error(`[${req.requestId}] Research Briefing Generation Init Error:`, error.message);
    res.status(error.code === 'SERVER_CONFIGURATION_ERROR' ? 503 : 500)
      .json({ error: 'Failed to initialize research briefing' });
  }
});

const processedSchedulerDates = new Map();

async function runScheduledResearchBriefings(now, client) {
  const { data: users, error } = await client
    .from('user_settings')
    .select('user_id, briefing_cadence, briefing_timezone, briefing_time, briefing_weekday, briefing_enabled')
    .neq('briefing_cadence', 'off');

  if (error) throw error;

  for (const user of users || []) {
    const localSchedule = getZonedDateTime(now, user.briefing_timezone);
    if (!shouldRunSchedulerForUser({
      now,
      timezone: localSchedule.timezone,
      cadence: user.briefing_cadence,
      scheduledTime: user.briefing_time,
      scheduledWeekday: user.briefing_weekday,
      lastRunDate: processedSchedulerDates.get(user.user_id),
    })) continue;

    const today = localSchedule.date;
    const cadence = normalizeBriefingCadence(user.briefing_cadence, user.briefing_enabled);
    const { data: latest, error: latestError } = await client
      .from('daily_podcasts')
      .select('date, status, created_at')
      .eq('user_id', user.user_id)
      .in('status', ['completed', 'generating'])
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error(`[Scheduler] Could not read latest briefing for ${user.user_id}:`, latestError.message);
      continue;
    }
    let latestDate = latest?.date;
    if (latest && isBriefingStale(latest, now)) {
      try {
        await markBriefingFailed(client, user.user_id, latest.date);
        latestDate = null;
      } catch (staleError) {
        console.error(`[Scheduler] Could not recover stale briefing for ${user.user_id}:`, staleError.message);
        continue;
      }
    }
    if (!shouldGenerateScheduledBriefing({ cadence, latestDate, today })) {
      processedSchedulerDates.set(user.user_id, today);
      continue;
    }

    const { error: claimError } = await client
      .from('daily_podcasts')
      .insert({
        user_id: user.user_id,
        date: today,
        status: 'generating',
        title: 'Generating Research Briefing...',
        summary: 'We are curating your personalized research update. This usually takes a few minutes.',
      });

    if (claimError?.code === '23505') {
      processedSchedulerDates.set(user.user_id, today);
      continue;
    }
    if (claimError) {
      console.error(`[Scheduler] Could not claim briefing for ${user.user_id}:`, claimError.message);
      continue;
    }

    try {
      console.log(`[Scheduler] Generating ${cadence} research briefing for ${user.user_id} at ${user.briefing_time} ${localSchedule.timezone}...`);
      await generateResearchBriefing(user.user_id, client, today);
      console.log(`[Scheduler] Research briefing completed for ${user.user_id}`);
    } catch (error) {
      console.error(`[Scheduler] Research briefing failed for ${user.user_id}:`, error.message);
    } finally {
      processedSchedulerDates.set(user.user_id, today);
    }
  }
}

let schedulerInProgress = false;

async function researchBriefingSchedulerTick(now = new Date()) {
  if (!adminClient || schedulerInProgress) return;
  schedulerInProgress = true;
  try {
    await runScheduledResearchBriefings(now, adminClient);
  } catch (error) {
    console.error('[Scheduler] Failed to run research briefing schedule:', error.message);
  } finally {
    schedulerInProgress = false;
  }
}

if (process.env.ENABLE_SCHEDULER === 'true' && adminClient) {
  researchBriefingSchedulerTick();
  setInterval(researchBriefingSchedulerTick, 60_000);
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = {
  app,
  getOpenAIKey,
  openAIRequestConfig,
  runScheduledResearchBriefings,
};
