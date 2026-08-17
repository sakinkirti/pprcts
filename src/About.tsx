import SupportButton from './components/SupportButton'

export default function About() {
    return (
        <main className="about-container page-stack">
            <section className="page-heading">
                <p className="eyebrow">About pprcts</p>
                <h1>Less noise. More signal.</h1>
                <p>A research companion built to make discovery across fields easier to follow.</p>
            </section>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Why this exists</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    Keeping up with the growth of research across disciplines is a challenge for researchers and students alike.
                    <strong><em> pprcts</em></strong> (pronounced "papercuts") exists to streamline this process. By leveraging AI to curate personalized research briefings
                    and summarize complex papers, I hope this tool helps you stay informed without the overwhelm.
                </p>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>How to use</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    In <strong>Settings</strong>, add an OpenAI API key and list keywords for topics you'd like to follow.
                    Then, search for papers that interest you and add them to your library. This will generate an audio summary of the paper that you can listen to at your convenience.
                    With these set, you can generate a <strong>Research Briefing</strong> whenever you want, or ask pprcts to prepare one automatically each day or week.
                </p>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Built on open research</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    Thank you to <a href="https://openalex.org" target="_blank" rel="noreferrer">OpenAlex</a> for maintaining an open catalog that makes research across disciplines easier to discover and access.
                </p>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Support the project</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    This project is currently self-funded. It allows me to explore new technologies while building something useful for the community. To keep the database active, infrastructure running, and briefings free of ads, consider supporting the development.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <SupportButton />
                </div>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>The author</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    I'm Sakin, a PhD student at <a href="https://ucla.edu">UCLA</a>. I created this tool to help streamline my own research process and make staying updated with scientific literature more efficient and accessible. Feel free to check out my <a href="https://sakinkirti.github.io">website</a> or connect with me on <a href="https://linkedin.com/in/sakinkirti">linkedin</a>.
                </p>
            </div>
        </main>
    )
}
