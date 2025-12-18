import SupportButton from './components/SupportButton'

export default function About() {
    return (
        <div className="container" style={{ maxWidth: '700px', margin: '0 auto', padding: '0px' }}>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Why this exists</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    Keeping up with the exponential growth of scientific literature is a challenge for researchers and students alike.
                    <strong><em> pprcts</em></strong> (pronounced "papercuts") exists to streamline this process. By leveraging AI to curate personalized daily briefings
                    and summarize complex papers, I hope this tool helps you stay informed without the overwhelm.
                </p>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>How to use</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    In <strong>Settings</strong>, add an OpenAI API key and list keywords for topics you'd like to follow.
                    Then, search for papers that interest you and add them to your library. This will generate an audio summary of the paper that you can listen to at your convenience.
                    With these set, you can generate a <strong>Daily Briefing</strong>, a personalized AI-guided podcast that summarizes the latest research findings curated just for you.
                </p>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Support the Project</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    This project is currently self-funded. It allows me to explore new technologies while building something useful for the community. To keep the database active, infrastructure running, and briefings free of ads, consider supporting the development.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <SupportButton />
                </div>
            </div>

            <div className="result-item" style={{ marginBottom: '0px' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>The Author</h2>
                <p style={{ marginTop: 0, marginBottom: 0, lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    I'm Sakin, a PhD student at <a href="https://ucla.edu">UCLA</a>. I created this tool to help streamline my own research process and make staying updated with scientific literature more efficient and accessible. Feel free to check out my <a href="https://sakinkirti.github.io">website</a> or connect with me on <a href="https://linkedin.com/in/sakinkirti">linkedin</a>.
                </p>
            </div>
        </div>
    )
}
