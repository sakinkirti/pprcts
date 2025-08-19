const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: 'http://localhost:5173' })); // Allow Vite frontend
app.use(express.json());

// Search endpoint for PubMed
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing search query' });
  }
  try {
    // Use PubMed E-utilities API
    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=20&retmode=json`;
    const esearchRes = await axios.get(esearchUrl);
    const idList = esearchRes.data.esearchresult.idlist;
    if (!idList || idList.length === 0) {
      return res.json({ results: [] });
    }
    // Fetch details for each PubMed ID
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
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch results', details: error.message });
  }
});

// Endpoint to summarize article using ChatGPT, split into sections
app.post('/api/summarize', async (req, res) => {
  const { title, abstract, journal, authors, publication_date } = req.body;
  if (!title || !abstract) {
    return res.status(400).json({ error: 'Missing title or abstract for summarization' });
  }
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    async function getSection(sectionName, instructions) {
      try {
        const prompt = `Write the ${sectionName} section of a detailed academic summary for the following article. ${instructions}\n\nTitle: ${title}\nAuthors: ${authors?.join(', ')}\nJournal: ${journal}\nPublication Date: ${publication_date}\nAbstract: ${abstract}`;
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-5',
          messages: [
            { role: 'system', content: 'You are an expert academic summarizer.' },
            { role: 'user', content: prompt }
          ],
          max_completion_tokens: 2048
        }, {
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.data.choices || !response.data.choices[0]?.message?.content) {
          throw new Error(`No content returned for section: ${sectionName}`);
        }
        return response.data.choices[0].message.content;
      } catch (err) {
        console.error(`Error generating ${sectionName} section:`, err?.response?.data || err.message);
        return `Error generating ${sectionName} section: ${err?.response?.data?.error?.message || err.message}`;
      }
    }
    // Get each section
    const intro = await getSection('Introduction', 'Explain the background, motivation, and context. Provide only the text; no titles. Provide your response as a single paragraph. Use 400-500 words.');
    const methods = await getSection('Methods', 'Describe the methodology in detail, including any novel techniques. Provide only the text; no titles. Provide your response as a single paragraph. Use 600-700 words.');
    const results = await getSection('Results', 'Summarize the main findings and outcomes. Provide only the text; no titles. Provide your response as a single paragraph. Use 400-500 words.');
    const discussion = await getSection('Discussion', 'Discuss the implications, limitations, and future directions. Provide only the text; no titles. Provide your response as a single paragraph. Use 400-500 words.');
    // Check for errors in any section
    const summaryChunks = [
      { section: 'Introduction', text: intro },
      { section: 'Methods', text: methods },
      { section: 'Results', text: results },
      { section: 'Discussion', text: discussion }
    ];
    const hasError = summaryChunks.some(chunk => chunk.text.startsWith('Error generating'));
    if (hasError) {
      return res.status(502).json({ error: 'One or more sections failed to generate.', summaryChunks });
    }
    res.json({ summaryChunks, summary: `Introduction\n${intro}\n\nMethods\n${methods}\n\nResults\n${results}\n\nDiscussion\n${discussion}`});
    //console.log(summaryChunks);
  } catch (error) {
    console.error('Summary generation error:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate summary', details: error?.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
