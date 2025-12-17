import { useState, useEffect, useRef } from 'react'
import SupportButton from './components/SupportButton'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'

interface SettingsProps {
    session: Session | null;
}

export default function Settings({ session }: SettingsProps) {
    const [keywordTags, setKeywordTags] = useState<string[]>([])
    const [keywordInput, setKeywordInput] = useState('')
    const [briefingEnabled, setBriefingEnabled] = useState(false)
    const [openaiKey, setOpenaiKey] = useState('')
    const [hasExistingKey, setHasExistingKey] = useState(false)
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const isInitialLoad = useRef(true)

    useEffect(() => {
        const fetchSettings = async () => {
            if (!session) return;
            setLoading(true)
            try {
                const { data, error } = await supabase
                    .from('user_settings')
                    .select('keywords, openai_key, briefing_enabled')
                    .eq('user_id', session.user.id)
                    .single()

                if (error && error.code !== 'PGRST116') { // Ignore "Row not found" error
                    console.error('Error fetching settings:', error)
                }

                if (data) {
                    // Parse comma-separated keywords into array
                    const tags = data.keywords ? data.keywords.split(',').map((k: string) => k.trim()).filter((k: string) => k) : []
                    setKeywordTags(tags)
                    setBriefingEnabled(data.briefing_enabled || false)
                    // Don't load the actual key, just track if it exists
                    if (data.openai_key) {
                        setHasExistingKey(true)
                        setOpenaiKey('') // Keep input empty
                    }
                }
            } catch (err: any) {
                console.error('Unexpected error:', err)
            } finally {
                setLoading(false)
                isInitialLoad.current = false
            }
        }

        fetchSettings()
    }, [session])

    const handleAddKeyword = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            const newKeyword = keywordInput.trim()
            if (newKeyword && !keywordTags.includes(newKeyword)) {
                setKeywordTags([...keywordTags, newKeyword])
                setKeywordInput('')
            }
        }
    }

    const handleRemoveKeyword = (tagToRemove: string) => {
        setKeywordTags(keywordTags.filter(tag => tag !== tagToRemove))
    }

    // Auto-save keywords and briefing preference whenever they change
    useEffect(() => {
        const saveSettings = async () => {
            if (!session || isInitialLoad.current) return;

            try {
                await supabase
                    .from('user_settings')
                    .upsert({
                        user_id: session.user.id,
                        keywords: keywordTags.join(', '),
                        briefing_enabled: briefingEnabled,
                        updated_at: new Date().toISOString()
                    })
            } catch (err: any) {
                console.error('Failed to auto-save settings:', err)
            }
        }

        saveSettings()
    }, [keywordTags, briefingEnabled, session])

    const handleResetKey = () => {
        setHasExistingKey(false)
        setOpenaiKey('')
        setMessage('')
        setError('')
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!session) return;

        if (!openaiKey.trim()) {
            setError('Please enter an API key')
            return
        }

        setLoading(true)
        setMessage('')
        setError('')

        try {
            const { error } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: session.user.id,
                    keywords: keywordTags.join(', '),
                    openai_key: openaiKey.trim(),
                    updated_at: new Date().toISOString()
                })

            if (!error) {
                setMessage('API key saved successfully!')
                setHasExistingKey(true)
                setOpenaiKey('') // Clear input after save
                setTimeout(() => setMessage(''), 3000)
            } else {
                setError('Failed to save API key: ' + error.message)
            }
        } catch (err: any) {
            setError('Failed to save settings: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    if (!session) {
        return <div className="container" style={{ textAlign: 'center', marginTop: '50px' }}>Please log in to manage settings.</div>
    }

    return (
        <div className="settings-container" style={{ maxWidth: '700px', margin: '0 auto' }}>

            {/* Tile 1: Recommendations */}
            <div className="result-item" style={{ marginBottom: '4px', padding: '24px', width: '100%', boxSizing: 'border-box' }}>
                <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Recommendation Preferences</h2>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: '1.5', flex: 1, fontSize: '0.95rem' }}>
                    Set specific topics or keywords you want to see in your "Recommended For You" feed on the home page.
                    Leave empty to see recently trending articles.
                </p>

                <label
                    htmlFor="keywords"
                    style={{ display: 'block', marginBottom: '2px', fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.9rem' }}
                >
                    Keywords
                </label>
                <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: '24px',
                    padding: '6px 16px',
                    background: 'var(--bg-card)',
                    minHeight: '42px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    alignItems: 'center',
                    marginBottom: '0'
                }}>
                    {keywordTags.map((tag, idx) => (
                        <span key={idx} style={{
                            background: 'var(--accent)',
                            color: 'white',
                            padding: '2px 10px',
                            borderRadius: '16px',
                            fontSize: '0.85rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}>
                            {tag}
                            <button
                                type="button"
                                onClick={() => handleRemoveKeyword(tag)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'white',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    lineHeight: '1',
                                    padding: '0',
                                    marginLeft: '2px'
                                }}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    <input
                        id="keywords"
                        type="text"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={handleAddKeyword}
                        placeholder={keywordTags.length === 0 ? "Type a keyword..." : "Add..."}
                        style={{
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            flex: 1,
                            minWidth: '100px',
                            fontSize: '0.95rem'
                        }}
                    />
                </div>
            </div>

            {/* Tile 2: Briefing Schedule */}
            <div className="result-item" style={{ marginBottom: '4px', padding: '24px', width: '100%', boxSizing: 'border-box' }}>
                <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Daily Briefing Schedule</h2>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: '1.5', flex: 1, fontSize: '0.95rem' }}>
                    Configure how and when your daily audio briefing is generated.
                </p>

                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    background: 'var(--bg-card)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    width: '100%',
                    boxSizing: 'border-box'
                }}>
                    <div>
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)', display: 'block', fontSize: '0.95rem' }}>Auto-generate at 6:00 AM</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Ready for your morning routine
                        </span>
                    </div>
                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '42px', height: '24px' }}>
                        <input
                            type="checkbox"
                            checked={briefingEnabled}
                            onChange={(e) => setBriefingEnabled(e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                            position: 'absolute',
                            cursor: 'pointer',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: briefingEnabled ? 'var(--accent)' : 'var(--text-secondary)',
                            borderRadius: '24px',
                            transition: '.4s',
                            opacity: briefingEnabled ? 1 : 0.5
                        }}>
                            <span style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: briefingEnabled ? '20px' : '3px',
                                bottom: '3px',
                                backgroundColor: 'white',
                                borderRadius: '50%',
                                transition: '.4s'
                            }}></span>
                        </span>
                    </label>
                </div>
            </div>

            {/* Tile 3: OpenAI Configuration */}
            <div className="result-item" style={{ marginBottom: '4px', padding: '24px', width: '100%', boxSizing: 'border-box' }}>
                <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', color: 'var(--text-primary)' }}>OpenAI Configuration</h2>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: '1.5', flex: 1, fontSize: '0.95rem' }}>
                    Provide your OpenAI API Key to enable AI Summaries and Audio generation.
                    Your key is stored securely.
                </p>

                <label
                    htmlFor="openaiKey"
                    style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.9rem' }}
                >
                    OpenAI API Key
                </label>

                {hasExistingKey ? (
                    <div>
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                            <input
                                type="text"
                                value="sk-••••••••••••••••••••••••••••••••"
                                disabled
                                style={{
                                    flex: 1,
                                    padding: '8px 16px',
                                    borderRadius: '24px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-secondary)',
                                    fontSize: '0.95rem',
                                    opacity: 0.7,
                                    cursor: 'not-allowed'
                                }}
                            />
                            <button
                                onClick={handleResetKey}
                                className="action-btn"
                                style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}
                            >
                                Reset Key
                            </button>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0' }}>
                            ✓ API key is configured and ready to use
                        </p>
                    </div>
                ) : (
                    <div>
                        <input
                            id="openaiKey"
                            type="password"
                            value={openaiKey}
                            onChange={(e) => setOpenaiKey(e.target.value)}
                            placeholder="sk-..."
                            className="settings-input"
                            style={{
                                width: '100%',
                                padding: '10px 16px',
                                borderRadius: '24px',
                                border: '1px solid var(--border)',
                                marginBottom: '12px',
                                background: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                fontSize: '0.95rem'
                            }}
                        />
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="action-btn"
                            style={{ width: '100%' }}
                        >
                            {loading ? 'Saving...' : 'Save API Key'}
                        </button>
                    </div>
                )}

                {message && <div style={{ color: 'green', margin: '12px 0 0 0', fontSize: '0.9rem' }}>{message}</div>}
                {error && <div style={{ color: 'red', margin: '12px 0 0 0', fontSize: '0.9rem' }}>{error}</div>}
            </div>

            {/* Tile 4: Support */}
            <div className="result-item" style={{ marginBottom: '4px', padding: '24px', width: '100%', boxSizing: 'border-box' }}>
                <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Support the Development</h2>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 0 0', lineHeight: '1.5', flex: 1, fontSize: '0.95rem' }}>
                    If you find this tool helpful, consider supporting the maintenance and API costs.
                </p>
                <SupportButton />
            </div>
        </div >
    )
}
