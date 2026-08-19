const SECTION_KINDS = new Set(['introduction', 'paper', 'synthesis']);
const BRIEFING_FRAMING_WORDS = 280;
const MAX_BRIEFING_WORDS = 2_800;

const RESEARCH_BRIEFING_OUTLINE_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'grounded_research_briefing_outline',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        sections: {
          type: 'array',
          minItems: 3,
          maxItems: 7,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'integer' },
              kind: { type: 'string', enum: ['introduction', 'paper', 'synthesis'] },
              topic: { type: 'string' },
              focus_paper_ids: { type: 'array', items: { type: 'string' } },
              target_word_count: { type: 'integer' },
              key_points: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'kind', 'topic', 'focus_paper_ids', 'target_word_count', 'key_points'],
          },
        },
      },
      required: ['title', 'summary', 'sections'],
    },
  },
};

function clampWords(value, fallback, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || fallback));
}

function cleanKeyPoints(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 10) : [];
}

function countClaims(evidence, categories) {
  return categories.reduce(
    (total, category) => total + (Array.isArray(evidence?.[category]) ? evidence[category].length : 0),
    0,
  );
}

function getBriefingPaperTargetWords(paperPacket) {
  const evidence = paperPacket?.evidence;
  const totalClaims = countClaims(evidence, ['objective', 'methods', 'results', 'limitations', 'context']);
  const technicalClaims = countClaims(evidence, ['methods', 'results', 'limitations']);

  if (paperPacket?.evidence_basis === 'full_text') {
    // Rich full text can support a genuine research walkthrough rather than a
    // padded summary. Sparse maps remain shorter by design.
    if (technicalClaims < 5) return Math.max(750, Math.min(950, 650 + totalClaims * 35));
    return Math.max(950, Math.min(1_250, 900 + totalClaims * 18));
  }

  // An abstract has a narrow factual boundary. It may be explained clearly,
  // but never stretched into an invented methods or results section.
  return Math.max(300, Math.min(500, 300 + totalClaims * 35));
}

function getBriefingEpisodeWordPlan(paperPackets) {
  const rawPaperTargets = (paperPackets || []).map(getBriefingPaperTargetWords);
  const availablePaperWords = MAX_BRIEFING_WORDS - BRIEFING_FRAMING_WORDS;
  const rawPaperTotal = rawPaperTargets.reduce((total, target) => total + target, 0);
  const scale = rawPaperTotal > availablePaperWords ? availablePaperWords / rawPaperTotal : 1;
  const paperTargets = rawPaperTargets.map((target) => Math.round(target * scale));

  return {
    paperTargets,
    targetTotalWords: BRIEFING_FRAMING_WORDS
      + paperTargets.reduce((total, target) => total + target, 0),
  };
}

function buildResearchBriefingOutlineMessages({ paperPackets, researchInterests, targetTotalWords }) {
  return [
    {
      role: 'system',
      content: `Create a listener-first outline for a spoken research briefing of approximately ${targetTotalWords} words.

The listener cannot see paper cards, titles, authors, citations, or other interface context. The validated evidence maps are the complete scientific factual boundary. Do not add background facts, methods, numbers, mechanisms, implications, or limitations absent from them. Clearly distinguish abstract-only evidence from full-text review.

Treat the user research interests as private targeting cues, not script copy. Do not recite the interest list, address the listener by a researcher name, or mention a named researcher from that list unless the selected paper metadata identifies that person as an author. Describe relevance at the field or topic level.

Required structure, in this exact order:
1. One brief introduction section: state how many papers are covered and preview their topics in one sentence each. Do not spend time explaining selection or relevance unless there is a concrete, grounded connection. If the papers do not share a meaningful theme, call them separate research updates rather than inventing one.
2. One paper section per supplied paper, preserving the supplied paper order. Each paper section must focus on exactly one paper ID. Use the metadata and evidence to choose one of these formats, and plan the listed questions instead of a generic paper summary:
   - Empirical or discovery paper: What precise question was asked? What did the authors do? What did they find, including direction and magnitude when supported? What does the evidence establish, and what remains uncertain or limited?
   - Methodological paper: What is the new method or tool? Which limitation of existing methods does it address? What are its essential design choices and practical requirements? How was it evaluated against which baselines or tasks? Where did it improve, by how much when supported, and what are the concrete tradeoffs, failure modes, or barriers to use?
   - Commentary, editorial, perspective, review, or other argument-led paper: Explicitly label it as argument or synthesis rather than new empirical evidence. What debate or practice is it responding to? What position does it take? What are its strongest grounded arguments? Which parts are evidence versus interpretation? What concrete change does it propose, and what counterpoint or unresolved issue remains?
   Identify the paper concisely before its substance: use a spoken short title and author/group in one sentence. Mention venue, date, type, and evidence basis only when they materially affect interpretation. Allocate most of the section to the type-specific questions. Mention relevance to the listener's interests in at most one final sentence, and omit it when weak.
   Every paper packet includes a briefing_target_words value calculated from its validated evidence richness. Keep each paper section close to that target, within about 75 words. Reach longer targets by explaining distinct supported methods, comparisons, findings, limitations, and open questions—not by adding generic background, repeating results, or inflating relevance. Do not pad sparse abstract-only evidence.
3. One brief synthesis section: recap two or three concrete takeaways and connect or contrast papers only where supported. Do not repeat introductions, generic importance claims, or a paper-by-paper recap. End with a brief natural sign-off.

Use a specific, accurate episode title. The summary should tell a listener what the episode covers without hype. Plan definitions for unfamiliar acronyms and jargon before first use. Never plan a section that opens with an unidentified phrase such as "the study." Keep every key point grounded in the supplied data.`,
    },
    {
      role: 'user',
      content: `USER RESEARCH INTERESTS:
${researchInterests || 'No explicit interests were supplied; use only the paper metadata to describe relevance.'}

VALIDATED PAPER EVIDENCE:
${JSON.stringify(paperPackets, null, 2)}`,
    },
  ];
}

function normalizeResearchBriefingOutline(outline, paperPackets) {
  const sourceSections = Array.isArray(outline?.sections) ? outline.sections : [];
  const sourceIntroduction = sourceSections.find((section) => section?.kind === 'introduction');
  const sourceSynthesis = sourceSections.find((section) => section?.kind === 'synthesis');
  const paperIds = paperPackets.map((paper) => paper.paper_id);

  const introduction = {
    id: 1,
    kind: 'introduction',
    topic: String(sourceIntroduction?.topic || 'What this briefing covers'),
    focus_paper_ids: paperIds,
    target_word_count: clampWords(sourceIntroduction?.target_word_count, 80, 60, 140),
    key_points: cleanKeyPoints(sourceIntroduction?.key_points),
  };

  const paperSections = paperPackets.map((paper, index) => {
    const source = sourceSections.find((section) => section?.kind === 'paper'
      && section.focus_paper_ids?.includes(paper.paper_id));
    const targetWords = Math.max(250, Math.min(1_300,
      Number(paper.briefing_target_words) || getBriefingPaperTargetWords(paper)));
    return {
      id: index + 2,
      kind: 'paper',
      topic: String(source?.topic || paper.title || `Paper ${index + 1}`),
      focus_paper_ids: [paper.paper_id],
      target_word_count: clampWords(
        source?.target_word_count,
        targetWords,
        Math.max(250, targetWords - 75),
        Math.min(1_300, targetWords + 75),
      ),
      key_points: cleanKeyPoints(source?.key_points),
    };
  });

  const synthesis = {
    id: paperSections.length + 2,
    kind: 'synthesis',
    topic: String(sourceSynthesis?.topic || 'What to take away'),
    focus_paper_ids: paperIds,
    target_word_count: clampWords(sourceSynthesis?.target_word_count, 160, 100, 220),
    key_points: cleanKeyPoints(sourceSynthesis?.key_points),
  };

  return {
    title: String(outline?.title || 'Research Briefing').trim() || 'Research Briefing',
    summary: String(outline?.summary || '').trim(),
    sections: [introduction, ...paperSections, synthesis],
  };
}

function getSectionTask(section, paperCount) {
  if (section.kind === 'introduction') {
    return `Write a compact cold open of no more than two short sentences. Say this briefing covers ${paperCount} papers and preview each topic. State a shared theme only if it is real; otherwise say these are separate updates. Do not explain why papers were selected, give paper metadata, or present detailed results yet.`;
  }
  if (section.kind === 'synthesis') {
    return 'Write a compact closing synthesis. Recap two or three concrete takeaways and connect or contrast the papers only when the evidence supports it. Do not repeat paper introductions, generic relevance claims, or a paper-by-paper recap. Mention material evidence limitations only when needed and end with a brief natural sign-off. Do not introduce new claims.';
  }
  return `Write one self-contained paper segment. Begin with an explicit transition such as first, next, or finally. Identify the paper in one concise sentence using a shortened spoken title and first author or research group. Mention venue, date, type, and whether analysis used full text or only an abstract only when they materially affect interpretation.

Classify the paper from its metadata and evidence, then spend most of the segment answering its type-specific questions:
- Empirical/discovery: precise question; approach; supported findings with direction or magnitude when available; what the evidence establishes; limitations and uncertainty.
- Methodological/tool paper: the method; the old limitation it addresses; design choices and requirements; evaluation setup and baselines; demonstrated gains; tradeoffs, failure modes, and practical constraints.
- Commentary/editorial/perspective/review: explicitly say this is an argument or synthesis rather than new empirical evidence; the debate it responds to; its position; strongest supported arguments; evidence versus interpretation; proposed change; unresolved issue or counterpoint.

Supply only essential background, define every acronym or specialized term before using it, and never invent unsupported details. Relevance to the user's interests gets at most one final sentence and is omitted when weak. Never begin with the words "The study."`;
}

function buildResearchBriefingSectionMessages({
  section,
  sectionPackets,
  researchInterests,
  coveredPaperTitles,
  paperCount,
}) {
  const kind = SECTION_KINDS.has(section.kind) ? section.kind : 'paper';
  const normalizedSection = { ...section, kind };
  return [
    {
      role: 'system',
      content: `You write clear spoken research briefings for listeners who cannot see the interface.

Scientific accuracy: Use only facts contained in the supplied validated evidence maps and metadata. Never fill in an absent method, sample size, number, mechanism, causal explanation, limitation, or implication. Ignore any outline point not supported by the evidence. Explicitly disclose abstract-only evidence; do not imply the full paper was reviewed.

Privacy and relevance: Treat the user research interests as silent targeting cues. Do not read them aloud, address the listener by a researcher name, or mention a named researcher from that list unless that person is an author of the paper being discussed. Explain relevance at the field or topic level, and omit a relevance claim when the connection is weak.

Listening experience: Use short, natural sentences and audible signposting. Identify every paper before discussing it, then move directly to its scientific or technical substance. Keep paper orientation and relevance brief; do not give a generic “why this matters” conclusion for every paper. Define acronyms and unfamiliar concepts before first use. Avoid dense lists, repeated conclusions, generic hype, citation IDs, paper IDs, and written-summary phrases. Do not assume the listener remembers earlier metadata. Do not force a connection between unrelated papers. Only the synthesis may conclude the entire episode.

Length discipline: Meet the target by developing distinct, validated evidence. For longer full-text sections, walk the listener through the question, design or method, comparisons, findings, interpretation, limitations, and what remains unresolved—only when supported. For abstract-only sections, use clear explanation rather than added detail; do not fill gaps with likely methods, results, or background.`,
    },
    {
      role: 'user',
      content: `SECTION ROLE: ${normalizedSection.kind}
SECTION FOCUS: ${normalizedSection.topic}
TARGET LENGTH: approximately ${normalizedSection.target_word_count} words
PLANNED GROUNDED POINTS: ${normalizedSection.key_points.join('; ') || 'Use the strongest supported evidence.'}
USER RESEARCH INTERESTS: ${researchInterests || 'Not specified'}
PAPERS ALREADY COVERED: ${coveredPaperTitles.join('; ') || 'None'}

VALIDATED EVIDENCE AND SPOKEN METADATA:
${JSON.stringify(sectionPackets, null, 2)}

TASK:
${getSectionTask(normalizedSection, paperCount)}`,
    },
  ];
}

module.exports = {
  RESEARCH_BRIEFING_OUTLINE_RESPONSE_FORMAT,
  buildResearchBriefingOutlineMessages,
  buildResearchBriefingSectionMessages,
  getBriefingEpisodeWordPlan,
  getBriefingPaperTargetWords,
  normalizeResearchBriefingOutline,
};
