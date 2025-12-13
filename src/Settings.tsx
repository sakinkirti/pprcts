import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'

interface SettingsProps {
    session: Session | null;
}

export default function Settings({ session }: SettingsProps) {
    const [keywords, setKeywords] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        const fetchSettings = async () => {
            if (!session) return;
            setLoading(true)
            try {
                const { data, error } = await supabase
                    .from('user_settings')
                    .select('keywords')
                    .eq('user_id', session.user.id)
                    .single()

                if (error && error.code !== 'PGRST116') { // Ignore "Row not found" error
                    console.error('Error fetching settings:', error)
                }

                if (data) {
                    setKeywords(data.keywords || '')
                }
            } catch (err: any) {
                console.error('Unexpected error:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchSettings()
    }, [session])

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!session) return;
        setLoading(true)
        setMessage('')
        setError('')

        try {
            const { error } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: session.user.id,
                    keywords: keywords.trim(),
                    updated_at: new Date().toISOString()
                })

            if (error) throw error

            setMessage('Settings saved successfully!')
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
                    Keywords (comma separated)
                </label>
                <form onSubmit={handleSave} className="search-form">
                    <input
                        id="keywords"
                        type="text"
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="e.g. Machine Learning, Neuroscience, CRISPR"
                        className="settings-input"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                    >
                        {loading ? 'Saving...' : 'Save'}
                    </button>
                </form>

                {message && <div style={{ color: 'green', marginBottom: '15px' }}>{message}</div>}
                {error && <div style={{ color: 'red', marginBottom: '15px' }}>{error}</div>}
            </div>
        </div>
    )
}
