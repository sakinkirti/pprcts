import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'

interface SettingsProps {
    session: Session | null;
}

export default function Settings({ session }: SettingsProps) {
    const [keywordTags, setKeywordTags] = useState<string[]>([])
    const [keywordInput, setKeywordInput] = useState('')
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
                    .select('keywords, openai_key')
                    .eq('user_id', session.user.id)
                    .single()

                if (error && error.code !== 'PGRST116') { // Ignore "Row not found" error
                    console.error('Error fetching settings:', error)
                }

                if (data) {
                    // Parse comma-separated keywords into array
                    const tags = data.keywords ? data.keywords.split(',').map((k: string) => k.trim()).filter((k: string) => k) : []
                    setKeywordTags(tags)
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

    // Auto-save keywords whenever they change
    useEffect(() => {
        const saveKeywords = async () => {
            if (!session || isInitialLoad.current) return;

            try {
                await supabase
                    .from('user_settings')
                    .upsert({
                        user_id: session.user.id,
                        keywords: keywordTags.join(', '),
                        updated_at: new Date().toISOString()
                    })
            } catch (err: any) {
                console.error('Failed to auto-save keywords:', err)
            }
        }

        saveKeywords()
    }, [keywordTags, session])

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
        <div className="settings-container">

            <div className="card" style={{ padding: '30px', width: '100%', maxWidth: '700px' }}>
                <h2 style={{ fontSize: '1.2rem', marginBottom: '15px', color: 'var(--text-primary)' }}>Recommendation Preferences</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
                    Set specific topics or keywords you want to see in your "Recommended For You" feed on the home page.
                    Leave empty to see recently trending articles.
                </p>

                <label
                    htmlFor="keywords"
                    style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: 'var(--text-primary)' }}
                >
                    Keywords
                </label>
                <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: '24px',
                    padding: '8px 16px',
                    background: 'var(--bg-card)',
                    minHeight: '48px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    alignItems: 'center',
                    marginBottom: '12px'
                }}>
                    {keywordTags.map((tag, idx) => (
                        <span key={idx} style={{
                            background: 'var(--accent)',
                            color: 'white',
                            padding: '4px 12px',
                            borderRadius: '16px',
                            fontSize: '0.9rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
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
                                    fontSize: '1.1rem',
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
                        placeholder={keywordTags.length === 0 ? "Type a keyword and press Enter..." : "Add another..."}
                        style={{
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            flex: 1,
                            minWidth: '150px',
                            fontSize: '1rem'
                        }}
                    />
                </div>

                <h2 style={{ fontSize: '1.2rem', marginBottom: '15px', color: 'var(--text-primary)', marginTop: '30px' }}>OpenAI Configuration</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
                    Provide your OpenAI API Key to enable AI Summaries and Audio generation.
                    Your key is stored securely and only used for your requests.
                </p>

                <label
                    htmlFor="openaiKey"
                    style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: 'var(--text-primary)' }}
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
                                    padding: '12px 20px',
                                    borderRadius: '24px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-secondary)',
                                    fontSize: '1rem',
                                    opacity: 0.7,
                                    cursor: 'not-allowed'
                                }}
                            />
                            <button
                                onClick={handleResetKey}
                                className="action-btn"
                                style={{ whiteSpace: 'nowrap' }}
                            >
                                Reset Key
                            </button>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
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
                                padding: '12px 20px',
                                borderRadius: '24px',
                                border: '1px solid var(--border)',
                                marginBottom: '12px',
                                background: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                fontSize: '1rem'
                            }}
                        />
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="action-btn"
                        >
                            {loading ? 'Saving...' : 'Save API Key'}
                        </button>
                    </div>
                )}

                {message && <div style={{ color: 'green', marginBottom: '15px', marginTop: '20px' }}>{message}</div>}
                {error && <div style={{ color: 'red', marginBottom: '15px', marginTop: '20px' }}>{error}</div>}
            </div>
        </div>
    )
}
