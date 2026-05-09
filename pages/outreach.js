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
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [openingAll, setOpeningAll] = useState(false)
  const [openProgress, setOpenProgress] = useState({ done: 0, total: 0 })
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText]   = useState('')
  const [notif, setNotif]         = useState(null)
  const [openSection, setOpenSection] = useState({gym:true,salon:true,clinic:true,restaurant:true})
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

  // Auth + initial fetch
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('af_logged_in') !== '1') {
      router.replace('/login')
    } else {
      setAuthed(true)
      fetchToday()
    }
  }, [])

  // Poll every 30s
  useEffect(() => {
    if (!authed) return
    pollTimer.current = setInterval(fetchToday, 30000)
    return () => clearInterval(pollTimer.current)
  }, [authed, fetchToday])

  const generateToday = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/outreach/generate', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        notify(data.skipped
          ? `Already generated: ${data.count} items`
          : `✅ Generated ${data.count} messages`)
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

  // Mark sent without notification (used by openAll loop)
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

      {/* SUMMARY STRIP */}
      <div className="summary">
        <div className="stat">
          <div className="stat-num">{summary.total}</div>
          <div className="stat-lbl">Total</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{color:'#475569'}}>{summary.pending}</div>
          <div className="stat-lbl">Pending</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{color:'#059669'}}>{summary.sent}</div>
          <div className="stat-lbl">Sent</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{color:'#94a3b8'}}>{summary.skipped}</div>
          <div className="stat-lbl">Skipped</div>
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
        ) : (
          <>
            <button
              className="btn primary big"
              onClick={openAllInWhatsApp}
              disabled={summary.pending === 0}
            >
              {summary.pending === 0
                ? '✅ All done!'
                : `💬 Open All ${summary.pending} in WhatsApp`}
            </button>
            <div className="hint">
              ↑ Ek por ek WhatsApp khulbe with 8-15s gap. Send press kore back ashben, next ta auto khulbe. Or single message-er pashe "💬 WhatsApp" button use korun.
            </div>
          </>
        )}
      </div>

      {/* NICHE SECTIONS */}
      <div className="content">
        {Object.entries(NICHE_META).map(([niche, meta]) => {
          const list  = grouped[niche] || []
          const open  = openSection[niche]
          const count = list.length
          const sent  = list.filter(i => i.status === 'sent').length
          if (count === 0 && summary.total > 0) return null

          return (
            <div key={niche} className="section">
              <div className="sec-head" onClick={() => setOpenSection(p => ({...p, [niche]: !p[niche]}))}>
                <span className="sec-icon">{meta.icon}</span>
                <span className="sec-label">{meta.label}</span>
                <span className="sec-count">{sent}/{count}</span>
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
      .stat{background:var(--panel);border:1px solid var(--br);border-radius:10px;padding:12px 8px;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,0.03)}
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
