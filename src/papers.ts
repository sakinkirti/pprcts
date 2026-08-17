import type { Paper } from './types'

export function getPaperId(paper: Paper) {
  return paper.paper_id || paper.pmid || paper.openalex_id || ''
}

export function getPaperSource(paper: Paper) {
  const source = paper.journal || ''
  return /^OpenAlex indexed source$/i.test(source) ? 'Indexed research source' : source
}
