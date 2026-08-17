import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import SupportButton from './components/SupportButton'
import { apiRequest } from './api'
import { supabase } from './supabaseClient'
import type { ApiKeyStatus } from './types'

interface SettingsProps { session: Session | null }
type BriefingCadence = 'off' | 'daily' | 'weekly'

const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const weekdayOptions = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const supportedTimezones = (() => {
  const intlWithTimezones = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const values = intlWithTimezones.supportedValuesOf?.('timeZone') || [deviceTimezone, 'UTC']
  return Array.from(new Set([deviceTimezone, ...values])).sort((a, b) => a.localeCompare(b))
})()

function normalizeCadence(value: unknown, legacyEnabled: boolean): BriefingCadence {
  return value === 'daily' || value === 'weekly' || value === 'off'
    ? value
    : legacyEnabled ? 'daily' : 'off'
}

function normalizeTimezone(value: unknown) {
  const timezone = typeof value === 'string' && value ? value : deviceTimezone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return timezone
  } catch {
    return deviceTimezone
  }
}

function normalizeBriefingTime(value: unknown) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : '06:00'
}

function normalizeWeekday(value: unknown) {
  const weekday = Number(value)
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1
}

export default function Settings({ session }: SettingsProps) {
  const [keywordTags, setKeywordTags] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [briefingCadence, setBriefingCadence] = useState<BriefingCadence>('off')
  const [briefingTimezone, setBriefingTimezone] = useState(deviceTimezone)
  const [briefingTime, setBriefingTime] = useState('06:00')
  const [briefingWeekday, setBriefingWeekday] = useState(1)
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({ configured: false, lastFour: null })
  const [openaiKey, setOpenaiKey] = useState('')
  const [openAlexKeyStatus, setOpenAlexKeyStatus] = useState<ApiKeyStatus>({ configured: false, lastFour: null })
  const [openAlexKey, setOpenAlexKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [preferenceStatus, setPreferenceStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [connectionWarning, setConnectionWarning] = useState('')
  const lastSavedPreferences = useRef('')

  useEffect(() => {
    if (!session) return
    let cancelled = false

    async function loadPreferences() {
      setPreferencesLoading(true)
      try {
        const { data, error: settingsError } = await supabase
          .from('user_settings')
          .select('keywords, briefing_enabled, briefing_cadence, briefing_timezone, briefing_time, briefing_weekday')
          .eq('user_id', session!.user.id)
          .maybeSingle()
        if (settingsError) throw settingsError
        if (!cancelled) {
          const savedTags = data?.keywords?.split(',').map((value: string) => value.trim()).filter(Boolean) || []
          const savedCadence = normalizeCadence(data?.briefing_cadence, Boolean(data?.briefing_enabled))
          const savedTimezone = normalizeTimezone(data?.briefing_timezone)
          const savedTime = normalizeBriefingTime(data?.briefing_time)
          const savedWeekday = normalizeWeekday(data?.briefing_weekday)
          setKeywordTags(savedTags)
          setBriefingCadence(savedCadence)
          setBriefingTimezone(savedTimezone)
          setBriefingTime(savedTime)
          setBriefingWeekday(savedWeekday)
          lastSavedPreferences.current = JSON.stringify({
            keywordTags: savedTags,
            briefingCadence: savedCadence,
            briefingTimezone: data?.briefing_timezone || '',
            briefingTime: savedTime,
            briefingWeekday: savedWeekday,
          })
          setPreferencesHydrated(true)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to load saved preferences')
      } finally {
        if (!cancelled) setPreferencesLoading(false)
      }
    }

    async function loadConnectionStatuses() {
      const [openAIResult, openAlexResult] = await Promise.allSettled([
        apiRequest<ApiKeyStatus>('/api/settings/openai-key/status', session!.access_token),
        apiRequest<ApiKeyStatus>('/api/settings/openalex-key/status', session!.access_token),
      ])
      if (cancelled) return
      if (openAIResult.status === 'fulfilled') setKeyStatus(openAIResult.value)
      if (openAlexResult.status === 'fulfilled') setOpenAlexKeyStatus(openAlexResult.value)
      const unavailableConnections = Number(openAIResult.status === 'rejected') + Number(openAlexResult.status === 'rejected')
      setConnectionWarning(unavailableConnections
        ? `${unavailableConnections === 1 ? 'An API connection status' : 'API connection statuses'} could not be loaded. Your research interests are still available.`
        : '')
    }

    loadPreferences()
    loadConnectionStatuses()
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    if (!session || !preferencesHydrated) return
    const serializedPreferences = JSON.stringify({ keywordTags, briefingCadence, briefingTimezone, briefingTime, briefingWeekday })
    if (serializedPreferences === lastSavedPreferences.current) return

    setPreferenceStatus('saving')
    const timeout = window.setTimeout(async () => {
      const preferences = {
        keywords: keywordTags.join(', '),
        briefing_enabled: briefingCadence !== 'off',
        briefing_cadence: briefingCadence,
        briefing_timezone: briefingTimezone,
        briefing_time: briefingTime,
        briefing_weekday: briefingWeekday,
        updated_at: new Date().toISOString(),
      }
      const { data: updatedSettings, error: updateError } = await supabase
        .from('user_settings')
        .update(preferences)
        .eq('user_id', session.user.id)
        .select('user_id')
        .maybeSingle()
      let saveError = updateError
      if (!saveError && !updatedSettings) {
        const { error: insertError } = await supabase
          .from('user_settings')
          .insert({ user_id: session.user.id, ...preferences })
        saveError = insertError
      }
      if (saveError) {
        console.error('Preference save failed:', saveError)
        setPreferenceStatus('error')
        setError('Preferences could not be saved. Your latest changes remain in this browser for now.')
        return
      }
      lastSavedPreferences.current = serializedPreferences
      setPreferenceStatus('saved')
      setError('')
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [briefingCadence, briefingTime, briefingTimezone, briefingWeekday, keywordTags, preferencesHydrated, session])

  function addKeyword() {
    const keyword = keywordInput.trim()
    if (!keyword || keywordTags.some((tag) => tag.toLocaleLowerCase() === keyword.toLocaleLowerCase()) || keywordTags.length >= 20) return
    setKeywordTags((current) => [...current, keyword])
    setKeywordInput('')
  }

  const preferenceStatusText = preferencesLoading
    ? 'Loading saved interests…'
    : preferenceStatus === 'saving'
      ? 'Saving changes…'
      : preferenceStatus === 'saved'
        ? 'Saved'
        : preferenceStatus === 'error'
          ? 'Not saved — please try again'
          : 'Changes save automatically'

  async function saveKey(event: React.FormEvent) {
    event.preventDefault()
    if (!session || !openaiKey.trim()) return
    setLoading(true); setError(''); setMessage('')
    try {
      const status = await apiRequest<ApiKeyStatus>('/api/settings/openai-key', session.access_token, {
        method: 'PUT', body: JSON.stringify({ key: openaiKey.trim() }),
      })
      setKeyStatus(status); setOpenaiKey(''); setMessage('API key encrypted and saved.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save API key')
    } finally { setLoading(false) }
  }

  async function deleteKey() {
    if (!session) return
    setLoading(true); setError('')
    try {
      await apiRequest<void>('/api/settings/openai-key', session.access_token, { method: 'DELETE' })
      setKeyStatus({ configured: false, lastFour: null }); setMessage('API key removed.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove API key')
    } finally { setLoading(false) }
  }

  async function saveOpenAlexKey(event: React.FormEvent) {
    event.preventDefault()
    if (!session || !openAlexKey.trim()) return
    setLoading(true); setError(''); setMessage('')
    try {
      const status = await apiRequest<ApiKeyStatus>('/api/settings/openalex-key', session.access_token, {
        method: 'PUT', body: JSON.stringify({ key: openAlexKey.trim() }),
      })
      setOpenAlexKeyStatus(status); setOpenAlexKey(''); setMessage('OpenAlex API key encrypted and saved.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save OpenAlex key')
    } finally { setLoading(false) }
  }

  async function deleteOpenAlexKey() {
    if (!session) return
    setLoading(true); setError('')
    try {
      await apiRequest<void>('/api/settings/openalex-key', session.access_token, { method: 'DELETE' })
      setOpenAlexKeyStatus({ configured: false, lastFour: null }); setMessage('OpenAlex API key removed.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove OpenAlex key')
    } finally { setLoading(false) }
  }

  if (!session) return <div className="empty-state">Sign in to manage your settings.</div>

  return (
    <main className="settings-container page-stack" aria-busy={loading || preferencesLoading}>
      <div className="page-heading">
        <p className="eyebrow">Preferences</p><h2>Make pprcts yours.</h2>
        <p>Shape your recommendations, research briefing, and private research connections.</p>
      </div>
      <section className="settings-card" aria-labelledby="recommendation-settings">
        <h3 id="recommendation-settings">Research interests</h3>
        <p>Recommendations use these topics across journals, conferences, books, dissertations, and preprint repositories. Leave the list empty for noteworthy recent research across fields.</p>
        <label htmlFor="keywords">Keywords</label>
        <div className="tag-field" aria-describedby="keywords-help keywords-status">
          {keywordTags.map((tag) => <span className="tag" key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => setKeywordTags((items) => items.filter((item) => item !== tag))}>×</button></span>)}
          <input id="keywords" value={keywordInput} maxLength={80} disabled={preferencesLoading} onChange={(event) => setKeywordInput(event.target.value)} onBlur={addKeyword} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addKeyword() } }} placeholder={keywordTags.length ? 'Add another topic' : 'e.g. spatial transcriptomics'} />
        </div>
        <div className="settings-field-footer">
          <p id="keywords-help" className="field-help">Press Enter or type a comma to add a topic. Up to 20 topics.</p>
          <p id="keywords-status" className={`save-status ${preferenceStatus === 'error' ? 'save-status-error' : ''}`} role="status" aria-live="polite">{preferenceStatusText}</p>
        </div>
      </section>
      <section className="settings-card" aria-labelledby="briefing-settings">
        <h3 id="briefing-settings">Research briefing</h3>
        <p>Generate a briefing manually whenever you want, and optionally prepare one automatically on your schedule.</p>
        <div className="cadence-options" role="radiogroup" aria-label="Automatic research briefing schedule">
          {([
            ['off', 'Off', 'Manual only'],
            ['daily', 'Daily', 'Every day'],
            ['weekly', 'Weekly', 'Chosen weekday'],
          ] as const).map(([value, label, description]) => (
            <label className={`cadence-option ${briefingCadence === value ? 'selected' : ''}`} key={value}>
              <input type="radio" name="briefing-cadence" value={value} checked={briefingCadence === value} disabled={preferencesLoading} onChange={() => setBriefingCadence(value)} />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          ))}
        </div>
        <div className="schedule-fields">
          {briefingCadence === 'weekly' && (
            <label htmlFor="briefing-weekday">Day
              <select id="briefing-weekday" className="settings-input" value={briefingWeekday} disabled={preferencesLoading} onChange={(event) => setBriefingWeekday(Number(event.target.value))}>
                {weekdayOptions.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </label>
          )}
          <label htmlFor="briefing-time">Time
            <input id="briefing-time" className="settings-input" type="time" step="900" value={briefingTime} disabled={preferencesLoading} onChange={(event) => setBriefingTime(event.target.value)} />
          </label>
          <label className="timezone-field" htmlFor="briefing-timezone">Time zone
            <select id="briefing-timezone" className="settings-input" value={briefingTimezone} disabled={preferencesLoading} onChange={(event) => setBriefingTimezone(event.target.value)}>
              {!supportedTimezones.includes(briefingTimezone) && <option value={briefingTimezone}>{briefingTimezone}</option>}
              {supportedTimezones.map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
        </div>
        <div className="timezone-setting">
          <div>
            <strong>{briefingCadence === 'weekly' ? `${weekdayOptions[briefingWeekday]}s at ` : briefingCadence === 'daily' ? 'Every day at ' : 'Automatic generation is off · '}{briefingTime} · {briefingTimezone.replaceAll('_', ' ')}</strong>
            <span>{briefingTimezone === deviceTimezone ? 'This is the current device time zone.' : `This device is in ${deviceTimezone.replaceAll('_', ' ')}.`}</span>
          </div>
          {briefingTimezone !== deviceTimezone && <button type="button" className="text-button" onClick={() => setBriefingTimezone(deviceTimezone)}>Use current time zone</button>}
        </div>
      </section>
      <section className="settings-card" aria-labelledby="openai-settings">
        <h3 id="openai-settings">OpenAI connection</h3><p>Your key is encrypted by the server and is never returned to this browser after saving.</p>
        {keyStatus.configured ? <div className="key-status"><div><span className="status-dot" />Configured{keyStatus.lastFour ? ` •••• ${keyStatus.lastFour}` : ''}</div><button className="button button-danger-quiet" type="button" onClick={deleteKey} disabled={loading}>Remove key</button></div> : <form onSubmit={saveKey} className="key-form"><label htmlFor="openaiKey">OpenAI API key</label><input id="openaiKey" type="password" autoComplete="off" value={openaiKey} onChange={(event) => setOpenaiKey(event.target.value)} placeholder="sk-…" required /><button className="button button-primary" disabled={loading}>{loading ? 'Saving…' : 'Encrypt and save key'}</button></form>}
      </section>
      <section className="settings-card" aria-labelledby="openalex-settings">
        <h3 id="openalex-settings">OpenAlex connection</h3>
        <p>A free personal key raises your search allowance and enables OpenAlex full-text downloads. It is encrypted by the server and never returned to this browser. Get a key from <a href="https://openalex.org/settings/api" target="_blank" rel="noreferrer">OpenAlex settings</a>.</p>
        {openAlexKeyStatus.configured ? <div className="key-status"><div><span className="status-dot" />Configured{openAlexKeyStatus.lastFour ? ` •••• ${openAlexKeyStatus.lastFour}` : ''}</div><button className="button button-danger-quiet" type="button" onClick={deleteOpenAlexKey} disabled={loading}>Remove key</button></div> : <form onSubmit={saveOpenAlexKey} className="key-form"><label htmlFor="openAlexKey">OpenAlex API key</label><input id="openAlexKey" type="password" autoComplete="off" value={openAlexKey} onChange={(event) => setOpenAlexKey(event.target.value)} placeholder="Paste your OpenAlex key" required /><button className="button button-primary" disabled={loading}>{loading ? 'Saving…' : 'Encrypt and save key'}</button></form>}
      </section>
      {connectionWarning && <p className="notice notice-warning" role="status">{connectionWarning}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}{error && <p className="notice notice-error" role="alert">{error}</p>}
      <section className="settings-card" aria-labelledby="support-settings"><h3 id="support-settings">Support pprcts</h3><p>Help cover maintenance, database, and API infrastructure costs.</p><SupportButton /></section>
    </main>
  )
}
