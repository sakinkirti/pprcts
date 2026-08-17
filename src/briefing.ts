export function getBriefingTitle(title: string | null | undefined) {
  const normalized = title
    ?.replace(/^Title:\s*/i, '')
    .replace(/^Daily Research Briefing(?=\s*:|$)/i, 'Research Briefing')
    .replace(/^Daily Research Update(?=\s*:|$)/i, 'Research Update')
    .trim()
  return normalized || 'Research Briefing'
}
