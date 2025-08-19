import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './App.css';

const PaperDetails: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const paper = location.state?.paper;
  const prevQuery = location.state?.query;
  const prevResults = location.state?.results;

  const [parsedDetails, setParsedDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (paper?.link) {
      setLoading(true);
      fetch(`http://localhost:5001/api/paper-details?url=${encodeURIComponent(paper.link)}`)
        .then(async res => {
          const data = await res.json();
          if (!res.ok) {
            setError(data.error + (data.details ? `: ${data.details}` : ''));
          } else {
            setParsedDetails(data);
          }
        })
        .catch((err) => setError('Failed to fetch details from landing page: ' + err.message))
        .finally(() => setLoading(false));
    }
  }, [paper]);

  if (!paper) {
    return (
      <div className="container">
        <h2>No paper data found.</h2>
        <button onClick={() => navigate('/', { state: { query: prevQuery, results: prevResults } })}>Go Back</button>
      </div>
    );
  }

  const details = parsedDetails || {};

  return (
    <div className="container">
      <button onClick={() => navigate('/', { state: { query: prevQuery, results: prevResults } })} style={{ marginBottom: 16 }}>&larr; Back to Results</button>
      <h2>{details.title || paper.title}</h2>
      <div style={{ marginBottom: 12 }}>
        <strong>Authors:</strong> {details.authors?.length ? details.authors.join(', ') : paper.authors?.map((a: any) => a.name).join(', ') || 'N/A'}
      </div>
      <div style={{ marginBottom: 12 }}>
        <strong>Publication:</strong> {details.journal || paper.publication_info?.summary || 'N/A'}
      </div>
      <div style={{ marginBottom: 12 }}>
        <strong>Publication Date:</strong> {details.publication_date || paper.year || 'N/A'}
      </div>
      <div style={{ marginBottom: 12 }}>
        <strong>Abstract:</strong> {details.abstract || paper.snippet || 'N/A'}
      </div>
      {paper.citation_count && (
        <div style={{ marginBottom: 12 }}>
          <strong>Citations:</strong> {paper.citation_count}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <a href={paper.link} target="_blank" rel="noopener noreferrer" className="pdf-link">Google Scholar Page</a>
      </div>
      {paper.pdfLink && (
        <div style={{ marginTop: 8 }}>
          <a href={paper.pdfLink} target="_blank" rel="noopener noreferrer" className="pdf-link">Download PDF</a>
        </div>
      )}
      {paper.fullTextLink && !paper.pdfLink && (
        <div style={{ marginTop: 8 }}>
          <a href={paper.fullTextLink} target="_blank" rel="noopener noreferrer" className="pdf-link">Read Full Text</a>
        </div>
      )}
      {loading && <p>Loading details from landing page...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
};

export default PaperDetails;
