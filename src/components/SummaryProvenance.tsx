import type { SummaryProvenance as SummaryProvenanceData } from '../types'

interface SummaryProvenanceProps {
  provenance: SummaryProvenanceData
  compact?: boolean
}

export default function SummaryProvenance({ provenance, compact = false }: SummaryProvenanceProps) {
  const isFullText = provenance.basis === 'full_text'
  const displaySource = provenance.source
    ?.replace(/^OpenAlex abstract$/i, 'Indexed abstract')
    .replace(/^OpenAlex full text$/i, 'Open-access full text')
  const displayWarning = provenance.warning?.replaceAll('OpenAlex', 'The research catalog')
  const details = [
    displaySource,
    provenance.version,
    provenance.license,
    provenance.estimated_minutes ? `~${provenance.estimated_minutes} min` : null,
  ].filter(Boolean)

  return (
    <aside className={`summary-provenance ${compact ? 'summary-provenance-compact' : ''}`} aria-label="Summary source information">
      <div className="summary-provenance-heading">
        <span className={`provenance-badge ${isFullText ? 'provenance-badge-full' : 'provenance-badge-abstract'}`}>
          {provenance.label}
        </span>
        {details.length > 0 && <span className="summary-provenance-details">{details.join(' · ')}</span>}
      </div>
      {!compact && displayWarning && <p>{displayWarning}</p>}
      {!compact && provenance.source_url && (
        <a href={provenance.source_url} target="_blank" rel="noreferrer">
          View source record
        </a>
      )}
    </aside>
  )
}
