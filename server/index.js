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
const cors = require('cors');
const cheerio = require('cheerio');
const Bottleneck = require('bottleneck');
const { createClient } = require('@supabase/supabase-js');

const limiter = new Bottleneck({
  minTime: 334 // ~3 requests per second to stay within NCBI limits without API key
});

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); // Allow all origins (for local dev safety)
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Auth Middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  // Default to global anon client if no token
  req.supabase = supabase;

  if (token) {
    // Create authenticated client for this request
    const userSupabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    req.supabase = userSupabase;

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      req.user = user;
    }
  }
  next();
};

app.use(authMiddleware);

// Retrieve User Library
app.get('/api/library', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await req.supabase
    .from('user_library')
    .select('saved_at, papers(*)')
    .eq('user_id', req.user.id)
    .order('saved_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Flatten structure for frontend
  const library = data.map(item => ({
    ...item.papers,
    saved_at: item.saved_at
  }));

  res.json({ library });
});

// Helper function to fetch PubMed results
const fetchPubMedResults = async (query, retmax = 20) => {
  try {
    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&retmode=json`;
    const esearchRes = await limiter.schedule(() => axios.get(esearchUrl));
    const idList = esearchRes.data.esearchresult.idlist;

    if (!idList || idList.length === 0) {
      return [];
    }

    const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idList.join(',')}&retmode=xml`;
    const efetchRes = await limiter.schedule(() => axios.get(efetchUrl));
    const xml = efetchRes.data;
    const cheerioXml = cheerio.load(xml, { xmlMode: true });
    const articles = cheerioXml('PubmedArticle');
    const results = [];

    articles.each((i, el) => {
      const $a = cheerioXml(el);
      const title = $a.find('ArticleTitle').text();
      const authors = $a.find('AuthorList Author').map((i, el) => {
        const last = cheerioXml(el).find('LastName').text();
        const fore = cheerioXml(el).find('ForeName').text();
        return `${fore} ${last}`.trim();
      }).get();
      const journal = $a.find('Journal > Title').text();
      const pubDate = $a.find('PubDate Year').text() || $a.find('PubDate MedlineDate').text();
      const abstract = $a.find('Abstract AbstractText').text();
      const pmid = $a.find('PMID').text();

      results.push({
        title,
        authors,
        journal,
        publication_date: pubDate,
        abstract,
        pmid,
        link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      });
    });

    return results;
  } catch (error) {
    console.error('PubMed Fetch Error:', error.message);
    throw error;
  }
};

// Search endpoint for PubMed
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing search query' });
  }
  try {
    const results = await fetchPubMedResults(query);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch results', details: error.message });
  }
});

// Recommendations Endpoint
app.get('/api/recommendations', async (req, res) => {
  try {
    let searchTerm = '("Nature"[Journal] OR "Science"[Journal] OR "Cell"[Journal]) AND 2024/01:2025/12[dp]';
    let recommendationType = 'Trending Today';

    // 1. Check for Custom Keywords from Client
    const customKeywords = req.query.keywords;
    console.log('[DEBUG] Received Keywords:', customKeywords);

    if (customKeywords && customKeywords.trim() !== '') {
      searchTerm = customKeywords;
      recommendationType = `Based on your interest in "${customKeywords}"`;
    }

    console.log('[DEBUG] Searching PubMed for:', searchTerm);

    // 2. Search PubMed
    const results = await fetchPubMedResults(searchTerm);
    console.log('[DEBUG] Found Results:', results.length);
    res.json({ results, type: recommendationType });

  } catch (error) {
    console.error('Recommendations Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// Endpoint to summarize article using ChatGPT, split into sections
app.post('/api/summarize', async (req, res) => {
  const { pmid, title, abstract, journal, authors, publication_date } = req.body;
  if (!title && !abstract) {
    return res.status(400).json({ error: 'Missing title or abstract for summarization' });
  }

  try {
    // 1. Check Global Cache if PMID provided
    if (pmid) {
      const { data: cachedPaper } = await req.supabase
        .from('papers')
        .select('*')
        .eq('pmid', pmid)
        .single();

      if (cachedPaper && cachedPaper.summary) {
        console.log(`Cache hit for ${pmid}`);
        // If user logged in, add to library
        if (req.user) {
          await req.supabase.from('user_library').upsert({
            user_id: req.user.id,
            paper_pmid: pmid
          }, { onConflict: 'user_id, paper_pmid' });
        }
        return res.json({ summary: cachedPaper.summary });
      }
    }

    // 2. Fetch API Key from DB (User must be logged in)
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Please log in to generate summaries.' });
    }

    const token = req.headers.authorization?.split(' ')[1];
    const userSupabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: userSettings } = await userSupabase
      .from('user_settings')
      .select('openai_key')
      .eq('user_id', req.user.id)
      .single();

    const openaiApiKey = userSettings?.openai_key;

    if (!openaiApiKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured', details: 'Please add your API Key in Settings.' });
    }
    // Request a much longer, narrative-style summary (4096 tokens for ~15 min audio)
    const prompt = `You are an expert science communicator creating an audio summary of a research paper. Your goal is to tell the story of this research in a natural, flowing narrative that would be compelling to listen to.

Write a comprehensive summary (approximately 1000 words) that weaves together the background, methods, results, and discussion into a cohesive summary. Instead of breaking these into separate sections, flow naturally to create something similar to a podcast episode.

Focus on:
- The journey of discovery: What question drove this research? Why does it matter?
- The narrative arc: How did the researchers approach the problem? What did they find?
- The results: What experiments did the researchers perform? What did they find? How did they interpret their findings?
- The broader context: How does this project impact the field moving forward?

Your should dedicate 3/4 of the summary to the results and 1/4 to everything else. Maintain scientific accuracy while making it engaging and accessible.

Article Details:
Title: ${title}
Authors: ${authors?.join(', ')}
Journal: ${journal}
Publication Date: ${publication_date}
Abstract: ${abstract}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert science communicator who creates engaging, narrative-driven summaries of research papers for audio consumption.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 8192
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    let summary = response.data.choices?.[0]?.message?.content || '';
    // Limit to 30000 characters for longer narrative summaries (~15 min audio)
    // if (summary.length > 30000) {
    //   summary = summary.slice(0, 30000);
    // }

    // 2. Persist to Global Papers
    if (pmid) {
      const { error: upsertError } = await req.supabase.from('papers').upsert({
        pmid,
        title,
        authors,
        journal,
        publication_date,
        abstract,
        summary
      }, { onConflict: 'pmid' });

      if (upsertError) console.error('Supabase upsert error:', upsertError);

      // 3. Add to User Library if logged in
      if (req.user) {
        await req.supabase.from('user_library').upsert({
          user_id: req.user.id,
          paper_pmid: pmid
        }, { onConflict: 'user_id, paper_pmid' });
      }
    }

    res.json({ summary });
  } catch (error) {
    console.error('Summary generation error:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    res.status(status).json({ error: 'Failed to generate summary', details: error?.response?.data || error.message });
  }
});

// Endpoint to convert summary to speech using OpenAI TTS
app.post('/api/tts', async (req, res) => {
  const { summary, pmid } = req.body;
  console.log(`[TTS] Request received for PMID: ${pmid || 'none'}. Summary length: ${summary?.length || 0}`);

  if (!summary) {
    return res.status(400).json({ error: 'Missing summary text for TTS' });
  }
  try {
    // 1. Check if audio already exists in DB
    if (pmid) {
      const { data: paper } = await req.supabase
        .from('papers')
        .select('audio_path')
        .eq('pmid', pmid)
        .single();

      if (paper && paper.audio_path) {
        console.log(`Audio Cache hit for ${pmid}`);
        const { data: fileData, error: downloadError } = await req.supabase.storage
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
    }

    // Generate audio as before (split into chunks, stitch together)
    const chunkSize = 2000;
    const chunks = [];
    for (let i = 0; i < summary.length; i += chunkSize) {
      chunks.push(summary.slice(i, i + chunkSize));
    }

    console.log(`[TTS] Generating audio for ${pmid || 'unsaved paper'} in ${chunks.length} chunks...`);

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Please log in to generate audio.' });
    }

    const { data: userSettings } = await req.supabase
      .from('user_settings')
      .select('openai_key')
      .eq('user_id', req.user.id)
      .single();

    const openaiApiKey = userSettings?.openai_key;

    if (!openaiApiKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured', details: 'Please add your API Key in Settings.' });
    }
    const audioBuffers = [];
    for (const chunk of chunks) {
      const ttsRes = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: 'tts-1',
        input: chunk,
        voice: 'echo',
        speed: 1.15,
        response_format: 'mp3'
      }, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });
      audioBuffers.push(Buffer.from(ttsRes.data));
    }
    const stitchedAudio = Buffer.concat(audioBuffers);

    // 2. Upload to Supabase Storage and Update DB if PMID exists
    if (pmid) {
      const fileName = `${pmid}_${Date.now()}.mp3`;
      console.log(`[TTS] Uploading ${fileName} to storage (using user auth)...`);
      const { error: uploadError } = await req.supabase.storage
        .from('audio-summaries')
        .upload(fileName, stitchedAudio, {
          contentType: 'audio/mpeg',
          upsert: true
        });

      if (!uploadError) {
        console.log(`[TTS] Successfully uploaded ${fileName}. Updating papers table...`);
        // Use user's req.supabase to update the papers table
        const { error: updateError } = await req.supabase
          .from('papers')
          .upsert({ pmid, audio_path: fileName }, { onConflict: 'pmid' });

        if (updateError) console.error('[TTS] Error updating papers table:', updateError.message);
      } else {
        console.error('[TTS] Storage upload error:', uploadError);
      }
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="summary.mp3"'
    });
    console.log(`[TTS] Sending ${stitchedAudio.length} bytes of audio back to client.`);
    res.send(stitchedAudio);
  } catch (error) {
    console.error('TTS error:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate TTS audio', details: error?.response?.data || error.message });
  }
});

// Endpoint to fetch user's briefing history
app.get('/api/briefings/history', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const briefingsWithUrls = await Promise.all(briefings.map(async (b) => {
      let audio_url = null;
      if (b.audio_path) {
        const { data } = await req.supabase.storage
          .from('daily-podcasts')
          .createSignedUrl(b.audio_path, 3600 * 24); // 24 hours
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


// Endpoint to get or generate the Daily Podcast
// Helper to generate daily podcast
const generateDailyPodcast = async (userId, supabaseClient, userDate = null) => {
  const today = userDate || new Date().toISOString().split('T')[0];
  console.log('Generating Daily Podcast for user:', userId, 'Date:', today);

  try {
    // 1. Fetch User Interests from Library
    const { data: libraryData } = await supabaseClient
      .from('user_library')
      .select('papers(title, abstract)')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false })
      .limit(20);

    const interests = libraryData?.map(i => i.papers?.title).join('\n') || '';

    // 2. Fetch API Key
    const { data: userSettings } = await supabaseClient
      .from('user_settings')
      .select('openai_key')
      .eq('user_id', userId)
      .single();

    const openaiApiKey = userSettings?.openai_key;
    if (!openaiApiKey) {
      throw new Error('OpenAI API key required for podcast generation');
    }

    // 3. Generate Search Terms
    const termRes = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a research assistant. Generate 3 specific, compound search terms for PubMed based on the user\'s recent paper titles. The terms should be related but distinct from the exact titles to find new, adjacent research. Return ONLY the 3 terms separated by OR.' },
        { role: 'user', content: `User's recent papers:\n${interests || 'Trending Today'}` }
      ],
      temperature: 0.9
    }, { headers: { 'Authorization': `Bearer ${openaiApiKey}` } });

    const searchTerms = termRes.data.choices[0].message.content;
    const fullQuery = `(${searchTerms}) AND 2024/01:2025/12[dp]`;

    // 4. Search PubMed
    const papers = await fetchPubMedResults(fullQuery, 3); // Fetch top 3 papers

    if (papers.length === 0) {
      throw new Error('No new papers found for daily podcast today.');
    }

    const papersText = papers.map((p, i) => `Paper ${i + 1}: ${p.title} by ${p.authors.slice(0, 2).join(', ')}. Abstract: ${p.abstract}`).join('\n\n');

    // --- HIERARCHICAL GENERATION START ---

    // 5a. Step 1: Generate Outline
    console.log('[Daily Podcast] Generating Outline...');
    const outlineRes = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert science communicator and podcast producer. Create a detailed outline for a 15-minute daily research briefing. Structure it into 5-7 distinct sections. \n\nReturn valid JSON with:\n1. "title": Catchy episode title.\n2. "summary": 1-3 sentence summary.\n3. "sections": Array of objects { "id": number, "topic": string, "key_points": string[] }.'
        },
        { role: 'user', content: `Here are the papers to cover:\n${papersText}` }
      ],
      response_format: { type: "json_object" }
    }, { headers: { 'Authorization': `Bearer ${openaiApiKey}` } });

    const outlineData = JSON.parse(outlineRes.data.choices[0].message.content);

    // 5b. Step 2: Generate Script Section by Section
    let fullScript = "";
    let previousContext = "This is the start of the episode.";

    for (const section of outlineData.sections) {
      console.log(`[Daily Podcast] Generating Section ${section.id}: ${section.topic}`);
      const sectionRes = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a charismatic podcast host. Write the spoken script for ONE section of a 15-minute daily research update. Write ONLY the spoken text. Ensure a smooth transition from the previous section.'
          },
          {
            role: 'user',
            content: `Current Section: ${section.topic}\nKey Points: ${section.key_points.join(', ')}\n\nContext/Previous Section Ended With: "...${previousContext.slice(-300)}"\n\nFull Paper Context:\n${papersText}\n\nReturn the 500 word script for this section.`
          }
        ]
      }, { headers: { 'Authorization': `Bearer ${openaiApiKey}` } });

      const sectionText = sectionRes.data.choices[0].message.content;
      fullScript += sectionText + "\n\n";
      previousContext = sectionText;
    }

    const transcript = fullScript;
    const chunkSize = 4096;
    const chunks = [];
    for (let i = 0; i < transcript.length; i += chunkSize) {
      chunks.push(transcript.slice(i, i + chunkSize));
    }

    const audioBuffers = [];
    console.log(`[Daily Podcast] Generating Audio chunk by chunk...`);
    for (const chunk of chunks) {
      const ttsRes = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: 'tts-1',
        input: chunk,
        voice: 'echo',
        response_format: 'mp3'
      }, {
        headers: { 'Authorization': `Bearer ${openaiApiKey}` },
        responseType: 'arraybuffer'
      });
      audioBuffers.push(Buffer.from(ttsRes.data));
    }
    const finalAudio = Buffer.concat(audioBuffers);
    const fileName = `daily_${userId}_${today}.mp3`;

    console.log(`[Daily Podcast] Uploading audio to storage bucket...`);
    const { error: uploadError } = await supabaseClient.storage
      .from('daily-podcasts')
      .upload(fileName, finalAudio, { contentType: 'audio/mpeg', upsert: true });

    if (uploadError) throw uploadError;

    console.log(`[Daily Podcast] Inserting podcast metadata into DB...`);
    const { data: newPodcast, error: insertError } = await supabaseClient
      .from('daily_podcasts')
      .upsert({
        user_id: userId,
        date: today,
        title: outlineData.title || `Daily Research Update: ${today}`,
        summary: outlineData.summary,
        transcript: transcript,
        audio_path: fileName,
        paper_ids: papers.map(p => p.pmid),
        papers_metadata: papers,
        status: 'completed'
      }, { onConflict: 'user_id, date' })
      .select()
      .single();

    if (insertError) throw insertError;
    return newPodcast;

  } catch (error) {
    console.error('Generation Job Error:', error.message);
    await supabaseClient
      .from('daily_podcasts')
      .upsert({
        user_id: userId,
        date: today,
        status: 'failed',
        summary: `Error: ${error.message}`
      }, { onConflict: 'user_id, date' });
    throw error;
  }
};

// Endpoint to CHECK for Daily Podcast
app.get('/api/daily-podcast', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const queryDate = req.query.date || new Date().toISOString().split('T')[0];
    const { data: existingPodcast } = await req.supabase
      .from('daily_podcasts')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('date', queryDate)
      .single();

    if (existingPodcast) {
      let audio_url = null;
      if (existingPodcast.audio_path) {
        console.log(`[GET /api/daily-podcast] Cache hit: serving audio for ${queryDate}`);
        const { data: signedUrlData } = await req.supabase.storage
          .from('daily-podcasts')
          .createSignedUrl(existingPodcast.audio_path, 3600 * 24);
        audio_url = signedUrlData?.signedUrl;
      } else {
        console.log(`[GET /api/daily-podcast] Polling status: ${existingPodcast.status} for ${queryDate}`);
      }

      return res.json({
        ...existingPodcast,
        audio_url
      });
    }

    // New Behavior: Return 404 explicitly to trigger "Generate" button UI
    res.status(404).json({ error: 'Daily briefing not yet generated for today.', code: 'not_generated' });
  } catch (error) {
    console.error('Daily Podcast Check Error:', error.message);
    res.status(500).json({ error: 'Failed to check daily podcast status' });
  }
});

// Endpoint to GENERATE Daily Podcast explicitly
app.post('/api/daily-podcast/generate', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { date } = req.body;
  if (!date) {
    return res.status(400).json({ error: 'Missing date' });
  }

  try {
    // 1. Create/Update a 'generating' row
    const { data: placeholder, error } = await req.supabase
      .from('daily_podcasts')
      .upsert({
        user_id: req.user.id,
        date: date,
        status: 'generating',
        title: 'Generating Briefing...',
        summary: 'We are curating your personalized research update. This usually takes a few minutes.'
      }, { onConflict: 'user_id, date' })
      .select()
      .single();

    if (error) throw error;

    // 2. Start generation in background (DO NOT AWAIT)
    generateDailyPodcast(req.user.id, req.supabase, date)
      .then(() => console.log(`Background generation success for ${req.user.id}`))
      .catch(err => console.error(`Background generation failure for ${req.user.id}:`, err));

    // 3. Return the placeholder immediately
    res.json(placeholder);
  } catch (error) {
    console.error('Daily Podcast Generation Init Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to initialize daily podcast' });
  }
});

// Scheduler for 6 AM Briefings
setInterval(async () => {
  const now = new Date();
  // Check if it's 6:00 AM (Server Time)
  if (now.getHours() === 6 && now.getMinutes() === 0) {
    console.log('[Scheduler] Running 6 AM Briefing Generation...');

    // Fetch users who have enabled briefings
    const { data: users, error } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('briefing_enabled', true);

    if (error) {
      console.error('[Scheduler] Failed to fetch settings:', error);
      return;
    }

    if (users && users.length > 0) {
      console.log(`[Scheduler] Found ${users.length} users with briefings enabled.`);
      const today = new Date().toISOString().split('T')[0];

      for (const user of users) {
        // Check if already generated today
        const { data: existing } = await supabase
          .from('daily_podcasts')
          .select('id')
          .eq('user_id', user.user_id)
          .eq('date', today)
          .single();

        if (!existing) {
          try {
            console.log(`[Scheduler] Generating for user ${user.user_id}...`);
            // Note: using global 'supabase' client. Ensure SUPABASE_KEY is service_role or RLS allows this.
            await generateDailyPodcast(user.user_id, supabase);
            console.log(`[Scheduler] Success for user ${user.user_id}`);
          } catch (e) {
            console.error(`[Scheduler] Failed for user ${user.user_id}:`, e.message);
          }
        } else {
          console.log(`[Scheduler] Already exists for user ${user.user_id}`);
        }
      }
    } else {
      console.log('[Scheduler] No users have briefings enabled.');
    }
  }
}, 60000); // Check every minute

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
