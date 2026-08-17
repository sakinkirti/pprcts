const SECTION_KINDS = new Set(['introduction', 'paper', 'synthesis']);

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

function buildResearchBriefingOutlineMessages({ paperPackets, researchInterests, targetTotalWords }) {
  return [
    {
      role: 'system',
      content: `Create a listener-first outline for a spoken research briefing of approximately ${targetTotalWords} words.

The listener cannot see paper cards, titles, authors, citations, or other interface context. The validated evidence maps are the complete scientific factual boundary. Do not add background facts, methods, numbers, mechanisms, implications, or limitations absent from them. Clearly distinguish abstract-only evidence from full-text review.

Treat the user research interests as private targeting cues, not script copy. Do not recite the interest list, address the listener by a researcher name, or mention a named researcher from that list unless the selected paper metadata identifies that person as an author. Describe relevance at the field or topic level.

Required structure, in this exact order:
1. One introduction section: orient the listener, state how many papers are covered, preview each topic, and explain the honest connection to the user's interests. If the papers do not share a meaningful theme, call them separate research updates rather than inventing one.
2. One paper section per supplied paper, preserving the supplied paper order. Each paper section must focus on exactly one paper ID and plan this spoken sequence: transition; shortened title plus first author or group, venue/date/type when available, and evidence basis; research question in plain language; essential background; methods; supported results; limitations; and why it matters for the user's interests.
3. One synthesis section: recap the main takeaways, compare papers only where supported, identify the most relevant takeaway, restate important evidence limitations, and end with a brief natural sign-off.

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
    target_word_count: clampWords(sourceIntroduction?.target_word_count, 140, 100, 220),
    key_points: cleanKeyPoints(sourceIntroduction?.key_points),
  };

  const paperSections = paperPackets.map((paper, index) => {
    const source = sourceSections.find((section) => section?.kind === 'paper'
      && section.focus_paper_ids?.includes(paper.paper_id));
    return {
      id: index + 2,
      kind: 'paper',
      topic: String(source?.topic || paper.title || `Paper ${index + 1}`),
      focus_paper_ids: [paper.paper_id],
      target_word_count: clampWords(source?.target_word_count, 320, 220, 600),
      key_points: cleanKeyPoints(source?.key_points),
    };
  });

  const synthesis = {
    id: paperSections.length + 2,
    kind: 'synthesis',
    topic: String(sourceSynthesis?.topic || 'What to take away'),
    focus_paper_ids: paperIds,
    target_word_count: clampWords(sourceSynthesis?.target_word_count, 170, 100, 260),
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
    return `Write the cold open. Welcome the listener briefly, say this briefing covers ${paperCount} papers, and provide a clear verbal map. Preview each paper by a short intelligible title or topic and explain why it was selected. State a shared theme only if it is real; otherwise say these are separate updates. Do not present detailed results yet.`;
  }
  if (section.kind === 'synthesis') {
    return 'Write the closing synthesis. Signal that the briefing is wrapping up, recap two or three concrete takeaways, connect or contrast the papers only when the evidence supports it, identify what is most relevant at the field or topic level, remind the listener of material evidence limitations, and end with a brief natural sign-off. Do not introduce new claims.';
  }
  return 'Write one self-contained paper segment. Begin with an explicit transition such as first, next, or finally. Identify the paper using a shortened spoken title, first author or research group, venue/date/type when available, and whether the analysis used full text or only an abstract. Then explain the research question before technical detail, supply only essential background, define every acronym or specialized term before using it, describe supported methods and results, state limitations, and finish with why the result matters for the user interests. Never begin with the words "The study."';
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

Listening experience: Use short, natural sentences and audible signposting. Identify every paper before discussing it. Define acronyms and unfamiliar concepts before first use. Avoid dense lists, repeated conclusions, generic hype, citation IDs, paper IDs, and written-summary phrases. Do not assume the listener remembers earlier metadata. Do not force a connection between unrelated papers. Only the synthesis may conclude the entire episode.`,
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
  normalizeResearchBriefingOutline,
};
