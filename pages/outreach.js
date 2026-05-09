// pages/outreach.js
// Mobile-first daily outreach review & send dashboard.
// DESIGNED FOR: WhatsApp Business App (phone, free) — NOT cloud API
// Workflow:
//   1. Daily 10 AM cron generates 12 messages, Telegram pings tui
//   2. Tui phone-e ei page khole — review + edit message
//   3. "💬 WhatsApp" button click → app opens with pre-filled msg → tui Send press kor
//   4. "Sent" button click → mark kore CRM-e
//   5. "Open All in WhatsApp" — 12 tabs/windows ek por ek khulbe with 8s gap
// Features:
//   • Auto-fetch today's queue (polls every 30s)
//   • Group by niche with collapsible sections
//   • Edit message before send
//   • Mark as sent / Skip / Delete
//   • Real-time progress
//   • All free (no paid API needed)

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

const NICHE_META = {
  gym:        { icon: '🏋️',  label: 'Gym',        color: '#dc2626' },
  salon:      { icon: '💇',  label: 'Salon',      color: '#db2777' },
  clinic:     { icon: '🏥',  label: 'Clinic',     color: '#0891b2' },
  restaurant: { icon: '🍽️', label: 'Restaurant', color: '#d97706' },
}

const STATUS_META = {
  pending: { color: '#475569', label: 'Pending' },
  sent:    { color: '#059669', label: 'Sent ✓' },
  skipped: { color: '#94a3b8', label: 'Skipped' },
  failed:  { color: '#dc2626', label: 'Failed' },
}

// Build WhatsApp wa.me link with pre-filled message (works on mobile + desktop)
// This may open EITHER WhatsApp or WhatsApp Business depending on phone default.
function waLink(phone, message) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '')
  const encoded = encodeURIComponent(message || '')
  return `https://wa.me/${cleanPhone}?text=${encoded}`
}

// WhatsApp Business specific link — uses Android intent URL scheme
// Forces opening in WhatsApp Business app (package: com.whatsapp.w4b).
// On iOS or desktop this falls back to wa.me automatically.
function waBusinessLink(phone, message) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '')
  const encoded = encodeURIComponent(message || '')
  // Detect if mobile Android — only Android supports intent:// scheme
  if (typeof window !== 'undefined') {
    const ua = navigator.userAgent || ''
    if (/Android/i.test(ua)) {
      // Android intent URL — explicitly targets com.whatsapp.w4b (WhatsApp Business)
      return `intent://send?phone=${cleanPhone}&text=${encoded}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(`https://wa.me/${cleanPhone}?text=${encoded}`)};end`
    }
  }
  // iOS / desktop / unknown — fall back to standard wa.me
  return `https://wa.me/${cleanPhone}?text=${encoded}`
}

export default function OutreachPage() {
  const router = useRouter()
  const [authed, setAuthed]       = useState(false)
  const [items, setItems]         = useState([])
  const [summary, setSummary]     = useState({ total:0, pending:0, sent:0, skipped:0, failed:0, byNiche:{} })
  const [followups, setFollowups] = useState({ day3:[], day7:[], day14:[], summary:{total:0,day3:0,day7:0,day14:0} })
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [openingAll, setOpeningAll] = useState(false)
  const [openProgress, setOpenProgress] = useState({ done: 0, total: 0 })
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText]   = useState('')
  const [notif, setNotif]         = useState(null)
  const [openSection, setOpenSection] = useState({gym:true,salon:true,clinic:true,restaurant:true})
  const [openFuStage, setOpenFuStage] = useState({day3:true,day7:true,day14:true})
  const [filter, setFilter] = useState('pending')   // 'all' | 'pending' | 'sent' | 'skipped' — default to pending
  const ntTimer = useRef(null)
  const pollTimer = useRef(null)
  const cancelOpenRef = useRef(false)

  const notify = (msg, type='ok') => {
    setNotif({msg, type})
    clearTimeout(ntTimer.current)
    ntTimer.current = setTimeout(() => setNotif(null), 3500)
  }

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/today')
      if (res.ok) {
        const data = await res.json()
        setItems(data.items || [])
        setSummary(data.summary || {})
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }, [])

  const fetchFollowups = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/followups')
      if (res.ok) {
        const data = await res.json()
        setFollowups({
          day3:    data.day3    || [],
          day7:    data.day7    || [],
          day14:   data.day14   || [],
          summary: data.summary || { total: 0, day3: 0, day7: 0, day14: 0 },
        })
      }
    } catch(e) { console.error('fetchFollowups error:', e) }
  }, [])

  const refreshAll = useCallback(() => {
    fetchToday()
    fetchFollowups()
  }, [fetchToday, fetchFollowups])

  // Auth + initial fetch
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('af_logged_in') !== '1') {
      router.replace('/login')
    } else {
      setAuthed(true)
      refreshAll()
    }
  }, [])

  // Poll every 30s — both fresh and follow-ups
  useEffect(() => {
    if (!authed) return
    pollTimer.current = setInterval(refreshAll, 30000)
    return () => clearInterval(pollTimer.current)
  }, [authed, refreshAll])

  const generateToday = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/outreach/generate', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        if (data.skipped) {
          notify(`Already generated: ${data.count} items`)
        } else {
          const invalid = data.invalidPhonesSkipped || 0
          const msg = invalid > 0
            ? `✅ Generated ${data.count} messages (${invalid} invalid phone numbers auto-skipped)`
            : `✅ Generated ${data.count} messages`
          notify(msg)
        }
        fetchToday()
      } else {
        notify(data.error || 'Generate failed', 'err')
      }
    } catch(e) { notify('Generate failed', 'err') }
    setGenerating(false)
  }

  // Open all pending messages one by one in WhatsApp app
  // Mobile-friendly approach: opens each wa.me link sequentially with delay,
  // user sends manually in WhatsApp app, returns to CRM, next opens automatically.
  // Note: browser security may block multiple window.open — we use anchor click trick.
  const openAllInWhatsApp = async () => {
    const pendingItems = items.filter(i => i.status === 'pending')
    if (pendingItems.length === 0) {
      notify('No pending messages')
      return
    }
    if (!confirm(
      `${pendingItems.length}-ta message ek por ek WhatsApp e khulbe.\n\n` +
      `Each message-er por:\n` +
      `1. WhatsApp e Send press korben\n` +
      `2. CRM tab e back ashben\n` +
      `3. "✓ Sent" button press korle next ta khulbe\n\n` +
      `Confirm?`
    )) return
    setOpeningAll(true)
    cancelOpenRef.current = false
    setOpenProgress({ done: 0, total: pendingItems.length })
    notify(`Opening ${pendingItems.length} messages…`)

    for (let i = 0; i < pendingItems.length; i++) {
      if (cancelOpenRef.current) break
      const item = pendingItems[i]
      // Open WhatsApp Business directly (Android intent), fallback to wa.me on iOS/desktop
      window.open(waBusinessLink(item.lead_phone, item.message), '_blank')
      // Mark as sent automatically after 5 seconds (assuming user pressed send in WhatsApp)
      // User can also manually mark via the per-card button
      await new Promise(r => setTimeout(r, 5000))
      await markSentSilent(item.id)
      setOpenProgress({ done: i + 1, total: pendingItems.length })
      // Random gap 8-15s before opening next (ban prevention)
      if (i < pendingItems.length - 1 && !cancelOpenRef.current) {
        const gap = 8000 + Math.floor(Math.random() * 7000)
        await new Promise(r => setTimeout(r, gap))
      }
    }

    setOpeningAll(false)
    fetchToday()
    notify('✅ All opened!')
  }

  const cancelOpenAll = () => {
    cancelOpenRef.current = true
    setOpeningAll(false)
    notify('Stopped')
  }

  // ── FOLLOW-UP HANDLERS ───────────────────────────────────────────
  // Mark a follow-up as sent: updates lead's fu1/fu2/fu3 flags + logs message
  const markFollowupSent = async (item, silent = false) => {
    try {
      const res = await fetch('/api/outreach/followup-mark', {
        method:  'POST',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({
          lead_id: item.lead_id,
          stage:   item.stage,
          message: item.message,
        })
      })
      if (res.ok) {
        if (!silent) notify(`✅ ${item.stage} follow-up marked sent`)
        fetchFollowups()
      } else {
        if (!silent) notify('Mark failed', 'err')
      }
    } catch(e) {
      if (!silent) notify('Mark failed', 'err')
    }
  }

  // Open all follow-ups (any stage) one-by-one in WhatsApp with gap
  const openAllFollowups = async () => {
    const all = [...followups.day3, ...followups.day7, ...followups.day14]
    if (all.length === 0) {
      notify('No follow-ups due')
      return
    }
    if (!confirm(
      `${all.length} follow-up message-er sob ek por ek WhatsApp e khulbe.\n\n` +
      `Each-er por:\n` +
      `1. WhatsApp e Send press korben\n` +
      `2. CRM tab e back ashben\n` +
      `3. Auto next-ta khulbe 8-15s pore\n\n` +
      `Confirm?`
    )) return

    setOpeningAll(true)
    cancelOpenRef.current = false
    setOpenProgress({ done: 0, total: all.length })
    notify(`Opening ${all.length} follow-ups…`)

    for (let i = 0; i < all.length; i++) {
      if (cancelOpenRef.current) break
      const item = all[i]
      window.open(waBusinessLink(item.lead_phone, item.message), '_blank')
      await new Promise(r => setTimeout(r, 5000))
      await markFollowupSent(item, true)
      setOpenProgress({ done: i + 1, total: all.length })
      if (i < all.length - 1 && !cancelOpenRef.current) {
        const gap = 8000 + Math.floor(Math.random() * 7000)
        await new Promise(r => setTimeout(r, gap))
      }
    }

    setOpeningAll(false)
    fetchFollowups()
    notify('✅ All follow-ups opened!')
  }

  // Mark sent without notification (used by openAll fresh loop)
  const markSentSilent = async (id) => {
    try {
      await fetch(`/api/outreach/${id}`, {
        method:  'PATCH',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ status: 'sent' })
      })
    } catch(e) { console.error(e) }
  }

  const skipOne = async (id) => {
    try {
      await fetch(`/api/outreach/${id}`, {
        method:  'PATCH',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ status: 'skipped' })
      })
      notify('Skipped')
      fetchToday()
    } catch(e) { notify('Skip failed', 'err') }
  }

  const markSent = async (id) => {
    // After user clicks "💬 WhatsApp" and sends manually, they tap "✓ Mark Sent"
    try {
      await fetch(`/api/outreach/${id}`, {
        method:  'PATCH',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ status: 'sent' })
      })
      notify('✅ Marked as sent')
      fetchToday()
    } catch(e) { notify('Mark failed', 'err') }
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditText(item.message)
  }

  const saveEdit = async (id) => {
    try {
      await fetch(`/api/outreach/${id}`, {
        method:  'PATCH',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ message: editText })
      })
      setEditingId(null); setEditText('')
      notify('✅ Updated')
      fetchToday()
    } catch(e) { notify('Edit failed', 'err') }
  }

  // Mark this lead as "no WhatsApp" — skips this queue item AND prevents
  // the lead from being picked again in future generates
  const markNoWhatsApp = async (item) => {
    if (!confirm('Mark as no WhatsApp? This lead will never be picked again.')) return
    try {
      // 1. Skip this queue item
      await fetch(`/api/outreach/${item.id}`, {
        method:  'PATCH',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ status: 'skipped' })
      })
      // 2. Mark lead as "Not Interested" so it's permanently excluded
      //    (status filter prevents re-pick, and shows up properly in CRM)
      await fetch(`/api/leads/${item.lead_id}`, {
        method:  'PATCH',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ status: 'Not Interested' })
      })
      notify('📵 Marked as no WhatsApp — won\'t pick again')
      fetchToday()
    } catch(e) { notify('Mark failed', 'err') }
  }

  const removeOne = async (id) => {
    if (!confirm('Remove from today\'s queue?')) return
    try {
      await fetch(`/api/outreach/${id}`, { method: 'DELETE' })
      notify('Removed')
      fetchToday()
    } catch(e) { notify('Remove failed', 'err') }
  }

  if (!authed) return null

  // Group items by niche
  const grouped = { gym: [], salon: [], clinic: [], restaurant: [] }
  for (const item of items) {
    if (grouped[item.niche]) grouped[item.niche].push(item)
  }

  const today = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })
  const progressPct = summary.total > 0 ? Math.round((summary.sent / summary.total) * 100) : 0

  return (<>
    <Head>
      <title>Daily Outreach — FlowCRM</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
    </Head>

    <div className="page">
      {/* HEADER */}
      <header className="header">
        <button className="back-btn" onClick={() => router.push('/')}>← Back</button>
        <div className="title">
          <div className="t1">📬 Daily Outreach</div>
          <div className="t2">{today}</div>
        </div>
      </header>

      {/* SUMMARY STRIP — also acts as filter tabs */}
      <div className="summary">
        <div
          className={`stat ${filter==='all'?'active':''}`}
          onClick={() => setFilter('all')}
          title="Show all messages"
        >
          <div className="stat-num">{summary.total}</div>
          <div className="stat-lbl">Total</div>
        </div>
        <div
          className={`stat ${filter==='pending'?'active':''}`}
          onClick={() => setFilter('pending')}
          title="Show only pending (default)"
        >
          <div className="stat-num" style={{color:'#475569'}}>{summary.pending}</div>
          <div className="stat-lbl">Pending</div>
        </div>
        <div
          className={`stat ${filter==='sent'?'active':''}`}
          onClick={() => setFilter('sent')}
          title="Show only sent"
        >
          <div className="stat-num" style={{color:'#059669'}}>{summary.sent}</div>
          <div className="stat-lbl">Sent</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{color:'#d97706'}}>{followups.summary.total}</div>
          <div className="stat-lbl">Follow-ups</div>
        </div>
      </div>

      {/* PROGRESS BAR */}
      {summary.total > 0 && (
        <div className="progress">
          <div className="progress-bar" style={{width:`${progressPct}%`}}/>
          <div className="progress-text">{progressPct}% complete</div>
        </div>
      )}

      {/* MAIN ACTIONS */}
      <div className="actions">
        {summary.total === 0 ? (
          <button className="btn primary big" onClick={generateToday} disabled={generating}>
            {generating ? '⏳ Generating…' : '⚡ Generate Today\'s 12 Messages'}
          </button>
        ) : openingAll ? (
          <>
            <button className="btn danger big" onClick={cancelOpenAll}>
              ⏹ Stop ({openProgress.done}/{openProgress.total})
            </button>
            <div className="hint">
              WhatsApp khulche… Send press korun, tab e back ashun, next auto khulbe.
            </div>
          </>
        ) : summary.pending === 0 ? (
          <>
            <button className="btn primary big" onClick={generateToday} disabled={generating}>
              {generating ? '⏳ Generating…' : '⚡ Generate More Messages'}
            </button>
            <div className="hint">
              ✅ All {summary.sent} sent! Generate next batch (3 per niche, 12 total).
            </div>
          </>
        ) : (
          <>
            <button
              className="btn primary big"
              onClick={openAllInWhatsApp}
            >
              {`💬 Open All ${summary.pending} in WhatsApp`}
            </button>
            <div className="hint">
              ↑ Ek por ek WhatsApp khulbe with 8-15s gap. Send press kore back ashben, next ta auto khulbe. Or single message-er pashe "💬 WhatsApp" button use korun.
            </div>
          </>
        )}
      </div>

      {/* NICHE SECTIONS */}
      <div className="content">
        {/* Filter indicator banner */}
        {filter !== 'all' && summary.total > 0 && (
          <div className="filter-banner">
            Showing only <strong>{filter}</strong> messages.
            <button className="filter-clear" onClick={() => setFilter('all')}>Show all</button>
          </div>
        )}

        {Object.entries(NICHE_META).map(([niche, meta]) => {
          const fullList = grouped[niche] || []
          // Apply filter — when 'all', show everything; otherwise only matching status
          const list = filter === 'all'
            ? fullList
            : fullList.filter(i => i.status === filter)
          const open  = openSection[niche]
          const count = list.length
          const totalInNiche = fullList.length
          const sent  = fullList.filter(i => i.status === 'sent').length
          // Hide section if filter applied and no matching items
          if (count === 0) return null

          return (
            <div key={niche} className="section">
              <div className="sec-head" onClick={() => setOpenSection(p => ({...p, [niche]: !p[niche]}))}>
                <span className="sec-icon">{meta.icon}</span>
                <span className="sec-label">{meta.label}</span>
                <span className="sec-count">
                  {filter === 'all' ? `${sent}/${totalInNiche}` : `${count}`}
                </span>
                <span className="sec-toggle">{open ? '▾' : '▸'}</span>
              </div>

              {open && list.map(item => {
                const isEditing = editingId === item.id
                const sm = STATUS_META[item.status] || STATUS_META.pending
                return (
                  <div key={item.id} className={`card status-${item.status}`}>
                    <div className="card-top">
                      <div className="lead-info">
                        <div className="lead-name">{item.lead_name}</div>
                        <div className="lead-phone">{item.lead_phone}</div>
                      </div>
                      <span className="status-pill" style={{color:sm.color, borderColor:sm.color}}>
                        {sm.label}
                      </span>
                    </div>

                    {isEditing ? (
                      <textarea
                        className="msg-edit"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={8}
                        autoFocus
                      />
                    ) : (
                      <div className="msg">{item.message}</div>
                    )}

                    {item.send_error && (
                      <div className="err">⚠ {item.send_error}</div>
                    )}

                    {item.status === 'pending' && (
                      <div className="card-actions">
                        {isEditing ? (
                          <>
                            <button className="btn small primary" onClick={() => saveEdit(item.id)}>💾 Save</button>
                            <button className="btn small" onClick={() => { setEditingId(null); setEditText('') }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <a
                              className="btn small wa"
                              href={waBusinessLink(item.lead_phone, item.message)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              💼 WA Business
                            </a>
                            <a
                              className="btn small wa-alt"
                              href={waLink(item.lead_phone, item.message)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Regular WhatsApp (fallback)"
                            >
                              💬
                            </a>
                            <button className="btn small ok" onClick={() => markSent(item.id)}>
                              ✓ Mark Sent
                            </button>
                            <button className="btn small" onClick={() => startEdit(item)}>✏️ Edit</button>
                            <button
                              className="btn small ghost"
                              onClick={() => markNoWhatsApp(item)}
                              title="Number doesn't have WhatsApp — never pick again"
                            >
                              📵 No WA
                            </button>
                            <button className="btn small ghost" onClick={() => skipOne(item.id)}>Skip</button>
                            <button className="btn small ghost danger" onClick={() => removeOne(item.id)}>🗑</button>
                          </>
                        )}
                      </div>
                    )}

                    {item.status === 'sent' && item.sent_at && (
                      <div className="meta-line">Sent: {new Date(item.sent_at).toLocaleString('en-IN')}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {summary.total === 0 && !loading && (
          <div className="empty">
            <div className="empty-icon">📭</div>
            <div className="empty-title">No messages queued for today</div>
            <div className="empty-sub">Click the generate button above to pick 12 leads from your CRM.</div>
          </div>
        )}

        {/* ── FOLLOW-UPS DUE SECTION ──────────────────────────────── */}
        {followups.summary.total > 0 && (
          <div className="fu-section">
            <div className="fu-section-head">
              <div className="fu-section-title">
                🔔 Follow-ups Due <span className="fu-total-badge">{followups.summary.total}</span>
              </div>
              <div className="fu-section-sub">
                Leads ja age outreach hoyeche kintu reply ashe ni. Auto-skip: reply ashle list theke chole jay.
              </div>
            </div>

            {!openingAll && (
              <button
                className="btn primary big"
                onClick={openAllFollowups}
                style={{marginBottom:14}}
              >
                💬 Open All {followups.summary.total} Follow-ups in WhatsApp
              </button>
            )}

            {[
              { key: 'day3',  label: 'Day 3 — Soft check-in',          color: '#0891b2', list: followups.day3  },
              { key: 'day7',  label: 'Day 7 — Different angle',        color: '#7c3aed', list: followups.day7  },
              { key: 'day14', label: 'Day 14 — Final reach-out',       color: '#dc2626', list: followups.day14 },
            ].map(({key, label, color, list}) => {
              if (list.length === 0) return null
              const open = openFuStage[key]
              return (
                <div key={key} className="section">
                  <div
                    className="sec-head"
                    onClick={() => setOpenFuStage(p => ({...p, [key]: !p[key]}))}
                    style={{borderLeftWidth:4, borderLeftColor:color, borderLeftStyle:'solid'}}
                  >
                    <span className="sec-label" style={{color}}>{label}</span>
                    <span className="sec-count">{list.length}</span>
                    <span className="sec-toggle">{open ? '▾' : '▸'}</span>
                  </div>

                  {open && list.map(item => (
                    <div key={`${item.lead_id}-${item.stage}`} className="card">
                      <div className="card-top">
                        <div className="lead-info">
                          <div className="lead-name">{item.lead_name}</div>
                          <div className="lead-phone">{item.lead_phone}</div>
                        </div>
                        <span className="status-pill" style={{color, borderColor:color}}>
                          {item.days_old}d old
                        </span>
                      </div>

                      <div className="msg">{item.message}</div>

                      <div className="card-actions">
                        <a
                          className="btn small wa"
                          href={waBusinessLink(item.lead_phone, item.message)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          💼 WA Business
                        </a>
                        <a
                          className="btn small wa-alt"
                          href={waLink(item.lead_phone, item.message)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Regular WhatsApp (fallback)"
                        >
                          💬
                        </a>
                        <button
                          className="btn small ok"
                          onClick={() => markFollowupSent(item)}
                        >
                          ✓ Mark Sent
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* NOTIF */}
      {notif && (
        <div className={`notif ${notif.type === 'err' ? 'nerr' : ''}`}>
          <span className="ndot"/>
          {notif.msg}
        </div>
      )}
    </div>

    <style jsx global>{`
      :root {
        --bg:#f5f8fc; --panel:#ffffff; --br:#e2e8f0; --br2:#cbd5e1;
        --text:#0f172a; --t2:#475569; --t3:#94a3b8;
        --accent:#2563eb; --aglow:rgba(37,99,235,0.10);
        --green:#059669; --red:#dc2626; --amber:#d97706;
      }
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
      .page{min-height:100vh;max-width:680px;margin:0 auto;padding-bottom:80px}
      .header{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--panel);border-bottom:1px solid var(--br);position:sticky;top:0;z-index:10;box-shadow:0 1px 3px rgba(15,23,42,0.04)}
      .back-btn{background:var(--bg);border:1px solid var(--br);border-radius:7px;padding:7px 12px;font-size:13px;color:var(--text);cursor:pointer}
      .back-btn:hover{background:var(--aglow);border-color:var(--accent);color:var(--accent)}
      .title .t1{font-size:17px;font-weight:700;color:var(--text)}
      .title .t2{font-size:11px;color:var(--t3);font-family:'JetBrains Mono',monospace}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 16px}
      .stat{background:var(--panel);border:1px solid var(--br);border-radius:10px;padding:12px 8px;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,0.03);cursor:pointer;transition:all 0.15s ease;user-select:none}
      .stat:hover{border-color:var(--accent);transform:translateY(-1px)}
      .stat.active{border-color:var(--accent);background:#eef2ff;box-shadow:0 0 0 2px rgba(37,99,235,0.15)}
      .filter-banner{background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:10px 14px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:10px;margin-bottom:14px}
      .filter-clear{background:transparent;border:1px solid #92400e;color:#92400e;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-left:auto}
      .filter-clear:hover{background:#92400e;color:#fff}
      .stat-num{font-size:22px;font-weight:800;color:var(--text);line-height:1}
      .stat-lbl{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:0.05em;margin-top:5px;font-family:'JetBrains Mono',monospace}
      .progress{margin:0 16px 12px;background:var(--bg);border-radius:99px;height:8px;position:relative;overflow:hidden;border:1px solid var(--br)}
      .progress-bar{background:linear-gradient(90deg,#2563eb,#0891b2);height:100%;border-radius:99px;transition:width 0.5s}
      .progress-text{position:absolute;top:10px;left:0;right:0;text-align:center;font-size:10px;color:var(--t3);font-family:'JetBrains Mono',monospace}
      .actions{padding:0 16px 14px;display:flex;flex-direction:column;gap:8px}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 14px;border-radius:8px;border:1px solid var(--br);background:#fff;color:var(--text);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.15s;font-family:inherit;text-decoration:none}
      .btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent);background:var(--aglow)}
      .btn:disabled{opacity:0.5;cursor:not-allowed}
      .btn.big{padding:14px 18px;font-size:15px;font-weight:600;border-radius:10px;width:100%}
      .btn.small{padding:7px 11px;font-size:12px;border-radius:7px}
      .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
      .btn.primary:hover:not(:disabled){background:#1d4ed8;color:#fff;border-color:#1d4ed8}
      .btn.wa{background:#25d366;border-color:#25d366;color:#fff;font-weight:600}
      .btn.wa:hover{background:#1da851;color:#fff;border-color:#1da851}
      .btn.wa-alt{background:#fff;border-color:#25d366;color:#25d366;font-weight:600;padding:7px 9px}
      .btn.wa-alt:hover:not(:disabled){background:#25d366;color:#fff}
      .btn.ok{background:#fff;border-color:var(--green);color:var(--green);font-weight:600}
      .btn.ok:hover:not(:disabled){background:var(--green);color:#fff;border-color:var(--green)}
      .btn.danger{background:var(--red);border-color:var(--red);color:#fff;font-weight:600}
      .btn.danger:hover:not(:disabled){background:#b91c1c;color:#fff;border-color:#b91c1c}
      .btn.ghost{background:transparent;border-color:transparent;color:var(--t2)}
      .btn.ghost:hover:not(:disabled){background:var(--bg);color:var(--text);border-color:var(--br)}
      .btn.ghost.danger:hover{color:var(--red);border-color:var(--red);background:#fff}
      .hint{font-size:11px;color:var(--t3);text-align:center;line-height:1.5;padding:0 8px}
      .content{padding:0 12px}
      .section{margin-bottom:14px}
      .sec-head{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--panel);border:1px solid var(--br);border-radius:10px;cursor:pointer;user-select:none;box-shadow:0 1px 2px rgba(15,23,42,0.03)}
      .sec-head:hover{border-color:var(--br2)}
      .sec-icon{font-size:18px}
      .sec-label{font-weight:600;font-size:14px;color:var(--text)}
      .sec-count{margin-left:auto;background:var(--bg);border:1px solid var(--br);border-radius:99px;padding:2px 9px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--t2);font-weight:600}
      .sec-toggle{color:var(--t3);font-size:14px;width:16px;text-align:center}
      .card{background:var(--panel);border:1px solid var(--br);border-radius:10px;padding:14px;margin:8px 0;box-shadow:0 1px 2px rgba(15,23,42,0.03)}
      .card.status-sent{opacity:0.6;border-color:#a7f3d0;background:#f0fdf4}
      .card.status-skipped{opacity:0.55;background:#f8fafc}
      .card.status-failed{border-color:#fecaca;background:#fef2f2}
      .card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
      .lead-name{font-weight:600;font-size:14.5px;color:var(--text);line-height:1.3}
      .lead-phone{font-size:12px;color:var(--t3);font-family:'JetBrains Mono',monospace;margin-top:2px}
      .status-pill{font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:600;padding:3px 8px;border-radius:99px;border:1px solid;white-space:nowrap;text-transform:uppercase;letter-spacing:0.05em}
      .msg{font-size:13px;color:var(--t2);background:var(--bg);border:1px solid var(--br);border-radius:8px;padding:11px 13px;line-height:1.6;white-space:pre-wrap;max-height:160px;overflow-y:auto}
      .msg-edit{width:100%;font-size:13px;color:var(--text);background:#fff;border:1px solid var(--accent);border-radius:8px;padding:11px 13px;line-height:1.6;font-family:inherit;outline:none;resize:vertical;min-height:140px;box-shadow:0 0 0 3px var(--aglow)}
      .err{font-size:11px;color:var(--red);background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;margin-top:8px;font-family:'JetBrains Mono',monospace}
      .card-actions{display:flex;gap:6px;margin-top:11px;flex-wrap:wrap}
      .meta-line{font-size:11px;color:var(--t3);font-family:'JetBrains Mono',monospace;margin-top:8px}
      .empty{text-align:center;padding:60px 20px;color:var(--t3)}
      .empty-icon{font-size:42px;opacity:0.5;margin-bottom:12px}
      .empty-title{font-size:15px;font-weight:600;color:var(--t2);margin-bottom:6px}
      .empty-sub{font-size:13px;color:var(--t3)}
      /* FOLLOW-UPS SECTION */
      .fu-section{margin-top:30px;padding-top:24px;border-top:2px solid var(--br);padding-left:4px;padding-right:4px}
      .fu-section-head{margin-bottom:14px}
      .fu-section-title{font-size:18px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:10px}
      .fu-total-badge{background:#d97706;color:#fff;font-size:13px;font-family:'JetBrains Mono',monospace;padding:3px 10px;border-radius:99px;font-weight:700}
      .fu-section-sub{font-size:12px;color:var(--t3);margin-top:6px;line-height:1.5}
      .notif{position:fixed;bottom:20px;left:16px;right:16px;background:var(--panel);border:1px solid var(--green);border-radius:10px;padding:13px 16px;font-size:13px;z-index:999;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px rgba(15,23,42,0.12);animation:su 0.3s ease;max-width:calc(680px - 32px);margin:0 auto}
      .notif.nerr{border-color:var(--red)}
      .ndot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0}
      .notif.nerr .ndot{background:var(--red)}
      @keyframes su{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      ::-webkit-scrollbar{width:6px;height:6px}
      ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}

      /* Mobile-specific */
      @media(max-width:480px){
        .summary{grid-template-columns:repeat(4,1fr);gap:6px;padding:12px 10px}
        .stat{padding:10px 4px}
        .stat-num{font-size:19px}
        .stat-lbl{font-size:9px}
        .actions{padding:0 10px 12px}
        .content{padding:0 10px}
        .card{padding:12px}
        .msg{font-size:12.5px;padding:10px 12px}
        .btn.small{padding:7px 9px;font-size:11.5px}
        .header{padding:12px 14px}
        .title .t1{font-size:16px}
      }
    `}</style>
  </>)
}
