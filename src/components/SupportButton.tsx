
export default function SupportButton() {
    return (
        <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: '10px' }}>
            <a
                href="https://buymeacoffee.com/sakinkirti"
                target="_blank"
                rel="noopener noreferrer"
                className="support-btn-unified"
            >
                <span style={{ fontSize: '1.2rem' }}>☕</span> Buy me a coffee
            </a>
        </div>
    );
}
