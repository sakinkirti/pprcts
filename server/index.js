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
const { createClient } = require('@supabase/supabase-js');

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
  if (token) {
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

  const { data, error } = await supabase
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
    const esearchRes = await axios.get(esearchUrl);
    const idList = esearchRes.data.esearchresult.idlist;

    if (!idList || idList.length === 0) {
      return [];
    }

    const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idList.join(',')}&retmode=xml`;
    const efetchRes = await axios.get(efetchUrl);
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
  if (!title || !abstract) {
    return res.status(400).json({ error: 'Missing title or abstract for summarization' });
  }

  try {
    // 1. Check Global Cache if PMID provided
    if (pmid) {
      const { data: cachedPaper } = await supabase
        .from('papers')
        .select('*')
        .eq('pmid', pmid)
        .single();

      if (cachedPaper && cachedPaper.summary) {
        console.log(`Cache hit for ${pmid}`);
        // If user logged in, add to library
        if (req.user) {
          await supabase.from('user_library').upsert({
            user_id: req.user.id,
            paper_pmid: pmid
          }, { onConflict: 'user_id, paper_pmid' });
        }
        return res.json({ summary: cachedPaper.summary });
      }
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    // Request a longer summary (2048 tokens)
    const prompt = `Write a detailed academic summary (aim for 2048 tokens, up to 12000 characters) for the following article. Include background, methods, results, and discussion in a single, comprehensive narrative.\n\nTitle: ${title}\nAuthors: ${authors?.join(', ')}\nJournal: ${journal}\nPublication Date: ${publication_date}`;
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert academic summarizer.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2048
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    let summary = response.data.choices?.[0]?.message?.content || '';
    // Limit to 8000 characters for safety
    if (summary.length > 12000) {
      summary = summary.slice(0, 12000);
    }

    // 2. Persist to Global Papers
    if (pmid) {
      const { error: upsertError } = await supabase.from('papers').upsert({
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
        await supabase.from('user_library').upsert({
          user_id: req.user.id,
          paper_pmid: pmid
        }, { onConflict: 'user_id, paper_pmid' });
      }
    }

    res.json({ summary });
  } catch (error) {
    console.error('Summary generation error:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate summary', details: error?.response?.data || error.message });
  }
});

// Endpoint to convert summary to speech using OpenAI TTS
app.post('/api/tts', async (req, res) => {
  const { summary, pmid } = req.body;
  if (!summary) {
    return res.status(400).json({ error: 'Missing summary text for TTS' });
  }
  try {
    // 1. Check if audio already exists in DB
    if (pmid) {
      const { data: paper } = await supabase
        .from('papers')
        .select('audio_path')
        .eq('pmid', pmid)
        .single();

      if (paper && paper.audio_path) {
        console.log(`Audio Cache hit for ${pmid}`);
        const { data: fileData, error: downloadError } = await supabase.storage
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
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const audioBuffers = [];
    for (const chunk of chunks) {
      const ttsRes = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: 'tts-1',
        input: chunk,
        voice: 'alloy',
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
      const { error: uploadError } = await supabase.storage
        .from('audio-summaries')
        .upload(fileName, stitchedAudio, {
          contentType: 'audio/mpeg'
        });

      if (!uploadError) {
        await supabase
          .from('papers')
          .update({ audio_path: fileName })
          .eq('pmid', pmid);
      } else {
        console.error('Storage upload error:', uploadError);
      }
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="summary.mp3"'
    });
    res.send(stitchedAudio);
  } catch (error) {
    console.error('TTS error:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate TTS audio', details: error?.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
