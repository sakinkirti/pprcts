export interface SummaryProvenance {
  basis: 'full_text' | 'abstract'
  label: string
  source: string
  source_url?: string | null
  license?: string | null
  version?: string | null
  openalex_id?: string | null
  retrieval_reason?: string | null
  warning?: string | null
  evidence_sections: number
  evidence_claims: number
  word_count?: number
  estimated_minutes?: number
}

export interface Paper {
  pmid: string
  paper_id?: string
  openalex_id?: string | null
  pubmed_id?: string | null
  doi?: string | null
  title: string
  authors: string[]
  journal: string
  publication_date: string
  abstract: string
  link?: string
  work_type?: string | null
  source_type?: string | null
  primary_topic?: string | null
  indexed_in?: string[]
  cited_by_count?: number
  is_open_access?: boolean
  summary?: string
  summary_basis?: SummaryProvenance['basis']
  summary_metadata?: { provenance?: SummaryProvenance }
  summary_provenance?: SummaryProvenance
  saved_at?: string
}

export interface Podcast {
  id: string
  user_id: string
  date: string
  title: string
  summary?: string
  transcript?: string
  audio_path?: string
  audio_url?: string
  created_at?: string
  status: 'queued' | 'generating' | 'completed' | 'failed'
  papers_metadata?: Paper[]
}

export interface ApiKeyStatus {
  configured: boolean
  lastFour: string | null
}
