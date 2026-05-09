import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const STATUSES = ['New Lead','Contacted','Interested','Demo Booked','Closed Won','Not Interested']
const SOURCES  = ['Facebook','Instagram','WhatsApp','Website','Telegram','FB_Lead_Ad','Referral']
const SS = {'New Lead':'#3b82f6','Contacted':'#f59e0b','Interested':'#a855f7','Demo Booked':'#06b6d4','Closed Won':'#10b981','Not Interested':'#ef4444'}
const SC = {'New Lead':'bn','Contacted':'bc','Interested':'bi','Demo Booked':'bd','Closed Won':'bw','Not Interested':'bl'}
const SI = {Facebook:'📘',Instagram:'📸',WhatsApp:'💬',Website:'🌐',Telegram:'✈️',FB_Lead_Ad:'🎯',Referral:'⭐'}
const SRCC = {Facebook:'sf',Instagram:'si',WhatsApp:'sw',Website:'swb',Telegram:'st',FB_Lead_Ad:'sfb',Referral:'sr'}
const SRCCOL = ['#3b82f6','#ec4899','#22c55e','#f59e0b','#06b6d4','#f97316','#a855f7']
const today = () => new Date().toISOString().slice(0,10)
const daysSince = d => Math.floor((Date.now()-new Date(d))/(86400000))
const scoreLabel = s => s>=80?{t:'🔥 Hot',c:'#ef4444'}:s>=60?{t:'🌤️ Warm',c:'#f59e0b'}:s>=40?{t:'Medium',c:'#3b82f6'}:{t:'❄️ Cold',c:'#6b7280'}

export default function CRM() {
  const [view, setView]         = useState('dashboard')
  const [leads, setLeads]       = useState([])
  const [msgs, setMsgs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [filterSt, setFilterSt] = useState('All')
  const [filterSrc, setFilterSrc] = useState('All')
  const [filterNiche, setFilterNiche] = useState('All')
  const [filterScore, setFilterScore] = useState(0)
  const [searchQ, setSearchQ]   = useState('')
  const [activeChat, setActiveChat] = useState(null)
  const [editLead, setEditLead] = useState(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [notif, setNotif]       = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [fuTab, setFuTab]       = useState('all')
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsRange, setAnalyticsRange] = useState('30')
  const [waSending, setWaSending] = useState({})
  const [waModal, setWaModal] = useState(null)
  const [waMsg, setWaMsg] = useState('')
  const [form, setForm]         = useState({name:'',phone:'',email:'',source:'Website',status:'New Lead',niche:'',notes:'',tags:''})
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const [totalLeadCount, setTotalLeadCount] = useState(0) // server-side authoritative count
  const msgsEnd = useRef(null)
  const ntTimer = useRef(null)
  const fetchInFlightRef = useRef(false)   // prevent overlapping fetchLeads calls
  const fetchAbortRef    = useRef(null)    // abort old fetch when new one starts
  const webhookUrl = typeof window!=='undefined' ? `${window.location.origin}/api/webhook/lead` : ''

  // ── fetch ─────────────────────────────────────────────────────────────────
  // Performance fix: load first 500 instantly, background-load the rest
  // Bug fixes:
  //   1. Guard against overlapping calls (was causing leads.length to bounce 8500→14000→17152)
  //   2. Dedupe by id when merging pages (was double-counting leads)
  //   3. Abort old in-flight fetches when a new one starts
  //   4. Track server-side count separately so UI shows the real total instantly
  const fetchLeads = useCallback(async () => {
    // Guard: if a previous fetchLeads is still running, skip this one entirely
    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true

    // Abort any leftover request from a previous unmount/route change
    if (fetchAbortRef.current) fetchAbortRef.current.abort()
    const ctrl = new AbortController()
    fetchAbortRef.current = ctrl

    try {
      const res = await fetch('/api/leads?page=1&limit=500', { signal: ctrl.signal })
      if (!res.ok) { setLoading(false); return }
      const result = await res.json()
      const firstBatch = Array.isArray(result) ? result : (result.data || [])
      const totalCount = result.count || firstBatch.length
      const pageSize   = result.pageSize || 500

      setTotalLeadCount(totalCount)         // show real total in sidebar/dashboard immediately
      if (firstBatch.length > 0) setLeads(firstBatch)
      setLoading(false)

      // Silently load remaining pages in background, deduped by id
      if (totalCount > pageSize) {
        const totalPages = Math.ceil(totalCount / pageSize)
        const seen = new Map(firstBatch.map(l => [l.id, l]))
        for (let p = 2; p <= totalPages; p++) {
          if (ctrl.signal.aborted) break
          const r2 = await fetch(`/api/leads?page=${p}&limit=${pageSize}`, { signal: ctrl.signal })
          if (!r2.ok) break
          const r2result = await r2.json()
          const batch = Array.isArray(r2result) ? r2result : (r2result.data || [])
          if (!batch.length) break
          for (const l of batch) seen.set(l.id, l)   // dedupe — same id never counted twice
          setLeads(Array.from(seen.values()))
        }
      }
    } catch(e) {
      if (e.name !== 'AbortError') console.error('fetchLeads error:', e)
      setLoading(false)
    } finally {
      fetchInFlightRef.current = false
    }
  }, [])

  const fetchMsgs = useCallback(async (lid) => {
    try {
      const res = await fetch(`/api/messages?lead_id=${lid}`)
      if (res.ok) {
        const data = await res.json()
        setMsgs(data)
      }
    } catch(e) { console.error('fetchMsgs error:', e) }
  }, [])

  const fetchAnalytics = async (range='30') => {
    setAnalyticsLoading(true)
    try {
      const res = await fetch(`/api/analytics?range=${range}`)
      if (res.ok) setAnalytics(await res.json())
    } catch(e) { console.error(e) }
    setAnalyticsLoading(false)
  }

  const sendWhatsApp = async (leadId, customMsg='') => {
    setWaSending(p => ({...p, [leadId]: true}))
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ lead_id: leadId, message: customMsg || undefined })
      })
      const data = await res.json()
      if (res.ok) { notify('✅ WhatsApp sent!'); setWaModal(null); setWaMsg('') }
      else notify('WhatsApp error: ' + (data.error||'Unknown'), 'err')
    } catch(e) { notify('WhatsApp failed','err') }
    setWaSending(p => ({...p, [leadId]: false}))
  }

  // ── auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (localStorage.getItem('af_logged_in') !== '1') {
      router.replace('/login')
    } else {
      setAuthed(true)
      // Don't fetch here — the next useEffect handles the initial fetch
      // (calling fetchLeads in both places caused two parallel pagination loops)
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    fetchLeads()
    // Refresh every 2 min instead of 1 min — pagination loop for 17k leads
    // can take 30–60s, so 60s interval would overlap. The in-flight guard
    // also prevents stacking, but a longer interval saves Supabase reads.
    const interval = setInterval(() => fetchLeads(), 120000)
    return () => {
      clearInterval(interval)
      if (fetchAbortRef.current) fetchAbortRef.current.abort()
    }
  }, [authed, fetchLeads])

  useEffect(()=>{if(activeChat)fetchMsgs(activeChat.id)},[activeChat,fetchMsgs])
  useEffect(()=>{if(view==='analytics')fetchAnalytics(analyticsRange)},[view,analyticsRange])
  useEffect(()=>{msgsEnd.current?.scrollIntoView({behavior:'smooth'})},[msgs])

  // ── notify ────────────────────────────────────────────────────────────────
  const notify = (msg,type='ok') => {
    setNotif({msg,type})
    clearTimeout(ntTimer.current)
    ntTimer.current = setTimeout(()=>setNotif(null),3500)
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const addLead = async () => {
    if (!form.name.trim()) return notify('Name required!','err')
    if (!form.phone.trim() && !form.email.trim()) return notify('Phone or Email required!','err')
    const res = await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,last_contact:today()})})
    if (res.ok) { setShowAdd(false); setForm({name:'',phone:'',email:'',source:'Website',status:'New Lead',niche:'',notes:'',tags:''}); notify('✅ Lead added!'); fetchLeads() }
    else notify('Error adding lead','err')
  }

  const updateLead = async (id, updates) => {
    const res = await fetch(`/api/leads/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)})
    if (res.ok) { const u=await res.json(); setLeads(p=>p.map(l=>l.id===id?u:l)); if(editLead?.id===id)setEditLead(u); notify('Lead updated!') }
    else notify('Update failed','err')
  }

  const deleteLead = async (id) => {
    if (!confirm('Delete this lead?')) return
    await fetch(`/api/leads/${id}`,{method:'DELETE'})
    setLeads(p=>p.filter(l=>l.id!==id)); setEditLead(null); notify('Lead deleted','err')
  }

  const sendMsg = async () => {
    if (!chatInput.trim()||!activeChat) return
    const res = await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_id:activeChat.id,direction:'out',text:chatInput.trim(),channel:'whatsapp'})})
    if (res.ok) { setChatInput(''); notify('Message saved') }
  }

  const markFU = async (leadId, fuDay) => {
    const secret = process.env.NEXT_PUBLIC_WEBHOOK_SECRET || ''
    const res = await fetch('/api/followup/mark',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-secret':secret},body:JSON.stringify({lead_id:leadId,fu_day:fuDay})})
    if (res.ok) { notify(`✅ Day-${fuDay} follow-up marked done!`); fetchLeads() }
    else notify('Error','err')
  }

  // ── computed ──────────────────────────────────────────────────────────────
  const filtered = leads.filter(l=>{
    const ms = filterSt==='All'||l.status===filterSt
    const mr = filterSrc==='All'||l.source===filterSrc
    const mq = !searchQ||l.name?.toLowerCase().includes(searchQ)||l.phone?.includes(searchQ)||(l.notes||'').toLowerCase().includes(searchQ)||(l.niche||'').toLowerCase().includes(searchQ)
    const mn = filterNiche==='All'||l.niche===filterNiche
    const msc = (l.score||0)>=filterScore
    return ms&&mr&&mq&&mn&&msc
  })

  // Follow-up buckets
  const fuLeads = leads.filter(l=>!['Closed Won','Not Interested'].includes(l.status))
  const fu1Pending = fuLeads.filter(l=>!l.fu1_sent && daysSince(l.created_at)>=1)
  const fu2Pending = fuLeads.filter(l=>l.fu1_sent && !l.fu2_sent && daysSince(l.created_at)>=3)
  const fu3Pending = fuLeads.filter(l=>l.fu2_sent && !l.fu3_sent && daysSince(l.created_at)>=7)
  const fuAll = [...fu1Pending,...fu2Pending,...fu3Pending]
  const fuShown = fuTab==='d1'?fu1Pending:fuTab==='d3'?fu2Pending:fuTab==='d7'?fu3Pending:fuAll

  const stats = {
    // Use server-side count for total — leads.length flickers during background pagination,
    // totalLeadCount is the real Supabase count and stays stable.
    total: totalLeadCount || leads.length,
    won: leads.filter(l=>l.status==='Closed Won').length,
    demo: leads.filter(l=>l.status==='Demo Booked').length,
    interested: leads.filter(l=>l.status==='Interested').length,
    fuPending: fuAll.length,
    hot: leads.filter(l=>l.score>=80).length,
    warm: leads.filter(l=>l.score>=60&&l.score<80).length,
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (!authed) return null

  return (<>
    <Head>
      <title>FlowCRM v3</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%233b82f6'/><text y='.9em' font-size='80' x='10'>⚡</text></svg>"/>
    </Head>
    <div className="app">

      {/* MOBILE OVERLAY */}
      {sideOpen&&<div className="mob-overlay" onClick={()=>setSideOpen(false)}/>}
      {/* SIDEBAR */}
      <aside className={`sidebar${sideOpen?' open':''}`}>
        <div className="logo-wrap">
          <div className="logo">Flow<span>CRM</span></div>
          <div className="logo-sub">v3 · AUTOMATION</div>
        </div>
        {[
          ['dashboard','Dashboard','📊',null],
          ['leads','All Leads','👥',totalLeadCount||leads.length],
          ['followup','Follow-ups','🔔',fuAll.length||null],
          ['kanban','Kanban','🗂️',null],
          ['inbox','Inbox','💬',null],
          ['analytics','Analytics','📈',null],
        ].map(([id,label,icon,badge])=>(
          <div key={id} className={`ni${view===id?' a':''}`} onClick={()=>{setView(id);setSideOpen(false)}}>
            <span className="nico">{icon}</span>{label}
            {badge ? <span className={`nbadge${id==='followup'?' nbadge-warn':''}`}>{badge}</span> : null}
          </div>
        ))}
        <div style={{marginTop:'auto',padding:'16px',borderTop:'1px solid var(--br)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <div className="uav">A</div>
            <div><div style={{fontSize:13,fontWeight:500}}>Admin</div><div style={{fontSize:11,color:'var(--t3)'}}>AutoFlow</div></div>
          </div>
          <button className="btn br" style={{width:'100%',justifyContent:'center',fontSize:12}} onClick={()=>{localStorage.removeItem('af_logged_in');localStorage.removeItem('af_pw_hash');router.replace('/login')}}>🚪 Sign Out</button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <button className="ham" onClick={()=>setSideOpen(o=>!o)}>☰</button>
          <div className="topbar-title">
            {view==='dashboard'?'Dashboard':view==='leads'?'All Leads':view==='followup'?`Follow-ups ${fuAll.length>0?`(${fuAll.length} pending)`:''}`:view==='kanban'?'Kanban':view==='inbox'?'Inbox':'Analytics'}
          </div>
          {loading&&<span style={{fontSize:11,fontFamily:'var(--mono)',color:'var(--t3)',marginLeft:12}}>loading…</span>}
          <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
            <div className="sbox">
              <span style={{color:'var(--t3)'}}>⌕</span>
              <input placeholder="Search…" value={searchQ} onChange={e=>setSearchQ(e.target.value.toLowerCase())}/>
            </div>
            <button className="btn bp" onClick={()=>setShowAdd(true)}>+ Add Lead</button>
          </div>
        </header>

        <div className="content">

          {/* ── DASHBOARD ── */}
          {view==='dashboard'&&<div className="fi">
            <div className="sgrid">
              <SC2 c="blue" icon="👥" label="Total Leads" num={stats.total} sub="all time"/>
              <SC2 c="green" icon="✅" label="Closed Won" num={stats.won} sub={`${stats.total?Math.round(stats.won/stats.total*100):0}% conv`}/>
              <SC2 c="amber" icon="📅" label="Demo Booked" num={stats.demo}/>
              <SC2 c="red" icon="⏰" label="Follow-ups Due" num={stats.fuPending} sub="need action"/>
            </div>
            <div className="sgrid" style={{gridTemplateColumns:'repeat(2,1fr)',marginBottom:16}}>
              <SC2 c="red" icon="🔥" label="Hot Leads" num={stats.hot} sub="score ≥ 80"/>
              <SC2 c="amber" icon="🌤️" label="Warm Leads" num={stats.warm} sub="score 60–79"/>
            </div>
            <div className="twocol">
              <div className="card">
                <div className="ct"><span className="ldot"/>Recent Leads</div>
                <table className="tbl"><thead><tr><th>Name</th><th>Source</th><th>Status</th><th>Date</th></tr></thead>
                  <tbody>{leads.slice(0,6).map(l=>(
                    <tr key={l.id} onClick={()=>setEditLead(l)} style={{cursor:'pointer'}}>
                      <td style={{fontWeight:600}}>{l.name}</td>
                      <td><SB s={l.source}/></td>
                      <td><span className={`badge ${SC[l.status]}`}>{l.status}</span></td>
                      <td className="mono sm grey">{l.created_at?.slice(0,10)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {leads.length===0&&<Emp icon="👥" text="No leads yet — connect n8n!"/>}
              </div>
              <div className="card">
                <div className="ct">Pipeline</div>
                <BChart items={STATUSES.map(s=>({label:s,val:leads.filter(l=>l.status===s).length,color:SS[s]}))} lw={110}/>
              </div>
            </div>
            {fuAll.length>0&&<div className="card" style={{marginTop:14,borderColor:'rgba(245,158,11,0.3)'}}>
              <div className="ct" style={{color:'var(--amber)'}}>⚠️ Follow-ups Pending — {fuAll.length} leads need message</div>
              <div style={{display:'flex',gap:8,marginBottom:12}}>
                <span className="tag" style={{background:'rgba(59,130,246,0.15)',color:'#60a5fa',border:'none'}}>Day 1: {fu1Pending.length}</span>
                <span className="tag" style={{background:'rgba(168,85,247,0.15)',color:'#a855f7',border:'none'}}>Day 3: {fu2Pending.length}</span>
                <span className="tag" style={{background:'rgba(239,68,68,0.15)',color:'#ef4444',border:'none'}}>Day 7: {fu3Pending.length}</span>
              </div>
              <button className="btn bg" onClick={()=>setView('followup')}>View Follow-up Dashboard →</button>
            </div>}
          </div>}

          {/* ── FOLLOW-UP DASHBOARD ── */}
          {view==='followup'&&<div className="fi">
            <div className="sgrid" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
              <SC2 c="blue" label="Day 1 Pending" num={fu1Pending.length} sub="≥1 day, no contact" icon="1️⃣"/>
              <SC2 c="purple" label="Day 3 Pending" num={fu2Pending.length} sub="≥3 days, FU1 done" icon="3️⃣"/>
              <SC2 c="red" label="Day 7 Pending" num={fu3Pending.length} sub="≥7 days, FU2 done" icon="7️⃣"/>
            </div>

            <div className="card">
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
                <div className="ct" style={{marginBottom:0}}>Follow-up Queue</div>
                <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
                  {[['all','All',fuAll.length],['d1','Day 1',fu1Pending.length],['d3','Day 3',fu2Pending.length],['d7','Day 7',fu3Pending.length]].map(([k,l,c])=>(
                    <button key={k} className={`ftab${fuTab===k?' fa':''}`} onClick={()=>setFuTab(k)}>{l} {c>0&&<span className="ftab-cnt">{c}</span>}</button>
                  ))}
                </div>
              </div>

              {fuShown.length===0
                ?<Emp icon="🎉" text="No follow-ups pending! All caught up."/>
                :<div className="fu-list">
                  {fuShown.map(l=>{
                    const days = daysSince(l.created_at)
                    const fuDay = !l.fu1_sent?1:!l.fu2_sent?3:7
                    const msgs_ = {
                      1:`Hey ${l.name}! Just checking in 👋 Did you get a chance to think about automating your business? Even a 2-word reply helps!`,
                      3:`Hi ${l.name}! Quick follow-up 😊 We helped a client save 3 hours/day last week with automation. Want to see how? Reply 'DEMO'`,
                      7:`Last message from me ${l.name} 🙏 If you're ever ready to automate, we're here anytime. Reply 'YES' to get started!`,
                    }
                    return (
                      <div key={l.id} className="fu-card">
                        <div className="fu-left">
                          <div className="fu-day-badge" style={{background:fuDay===1?'rgba(59,130,246,0.15)':fuDay===3?'rgba(168,85,247,0.15)':'rgba(239,68,68,0.15)',color:fuDay===1?'#60a5fa':fuDay===3?'#a855f7':'#ef4444'}}>
                            Day {fuDay}
                          </div>
                          <div>
                            <div className="fu-name">{l.name}</div>
                            <div className="fu-meta">{l.phone} · <SB s={l.source}/> · <span className={`badge ${SC[l.status]}`}>{l.status}</span></div>
                            <div className="fu-preview">{msgs_[fuDay]}</div>
                          </div>
                        </div>
                        <div className="fu-right">
                          <div className="fu-days">{days}d old</div>
                          <button className="btn bg sm" onClick={()=>{navigator.clipboard.writeText(msgs_[fuDay]);notify(`Day-${fuDay} message copied! Send on WhatsApp then mark done.`)}}>
                            📋 Copy Msg
                          </button>
                          {l.phone && <button className="btn sm" style={{background:'#25D366',color:'#fff',border:'none'}} onClick={()=>{setWaModal(l);setWaMsg('')}}>💬 WA</button>}
                          <button className="btn bp sm" onClick={()=>markFU(l.id,fuDay)}>
                            ✓ Mark Done
                          </button>
                          <button className="btn sm" onClick={()=>setEditLead(l)}>Edit</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              }
            </div>

            <div className="card" style={{marginTop:14}}>
              <div className="ct">🤖 Auto Follow-up via n8n</div>
              <p style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,marginBottom:12}}>
                n8n প্রতিদিন সকাল ১০টায় এই URL call করবে এবং automatically WhatsApp message পাঠাবে:
              </p>
              <div className="wbox">{webhookUrl.replace('/api/webhook/lead','/api/followup/run')}</div>
              <button className="btn" onClick={()=>{navigator.clipboard.writeText(webhookUrl.replace('/api/webhook/lead','/api/followup/run'));notify('Follow-up URL copied!')}}>📋 Copy URL</button>
              <p style={{fontSize:12,color:'var(--t3)',marginTop:10}}>n8n Schedule Trigger → HTTP GET এই URL → response থেকে fu1_due, fu2_due, fu3_due loop করে WhatsApp পাঠাও → /api/followup/mark call করো</p>
            </div>
          </div>}

          {/* ── LEADS TABLE ── */}
          {view==='leads'&&<div className="fi">
            <div className="card p0">
              <div className="card-hdr">
                <div className="ct mb0">All Leads</div>
                <div style={{display:'flex',gap:8,marginLeft:'auto',alignItems:'center',flexWrap:'wrap'}}>
                  <select className="mini-select" value={filterSrc} onChange={e=>setFilterSrc(e.target.value)}>
                    <option value="All">All Sources</option>
                    {SOURCES.map(s=><option key={s}>{s}</option>)}
                  </select>
                  <select className="mini-select" value={filterNiche} onChange={e=>setFilterNiche(e.target.value)}>
                    <option value="All">All Niches</option>
                    {[...new Set(leads.map(l=>l.niche).filter(Boolean))].map(n=><option key={n}>{n}</option>)}
                  </select>
                  <select className="mini-select" value={filterScore} onChange={e=>setFilterScore(Number(e.target.value))}>
                    <option value={0}>All Scores</option>
                    <option value={80}>🔥 Hot (80+)</option>
                    <option value={60}>🌤️ Warm (60+)</option>
                    <option value={40}>Medium (40+)</option>
                  </select>
                  <div className="ftabs">
                    {['All',...STATUSES].map(s=>(
                      <button key={s} className={`ftab${filterSt===s?' fa':''}`} onClick={()=>setFilterSt(s)}>
                        {s==='Not Interested'?'Lost':s==='New Lead'?'New':s==='Demo Booked'?'Demo':s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <table className="tbl">
                <thead><tr><th>Name</th><th>Phone</th><th>Source</th><th>Niche</th><th>Score</th><th>Status</th><th>FU</th><th>Tags</th><th></th></tr></thead>
                <tbody>
                  {filtered.map(l=>(
                    <tr key={l.id} onClick={()=>setEditLead(l)} style={{cursor:'pointer'}}>
                      <td style={{fontWeight:600}}>{l.name}</td>
                      <td className="mono sm">{l.phone}</td>
                      <td><SB s={l.source}/></td>
                      <td className="mono sm grey">{l.niche||'—'}</td>
                      <td><ScorePill score={l.score||0}/></td>
                      <td><span className={`badge ${SC[l.status]}`}>{l.status}</span></td>
                      <td>
                        <div style={{display:'flex',gap:3}}>
                          <span className="fu-dot" style={{background:l.fu1_sent?'var(--green)':'var(--br2)'}}>1</span>
                          <span className="fu-dot" style={{background:l.fu2_sent?'var(--green)':'var(--br2)'}}>3</span>
                          <span className="fu-dot" style={{background:l.fu3_sent?'var(--green)':'var(--br2)'}}>7</span>
                        </div>
                      </td>
                      <td><TagList tags={l.tags}/></td>
                      <td><button className="btn sm" onClick={e=>{e.stopPropagation();setEditLead(l)}}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length===0&&<Emp icon="🔍" text="No leads found"/>}
            </div>
          </div>}

          {/* ── KANBAN ── */}
          {view==='kanban'&&<div className="fi">
            <div className="kanban">
              {STATUSES.map(col=>{
                const cl=leads.filter(l=>l.status===col)
                return(
                  <div key={col} className="kcol">
                    <div className="kcol-h">
                      <div className="cdot" style={{background:SS[col]}}/>
                      <div className="ctitle" style={{color:SS[col]}}>{col}</div>
                      <div className="ccnt">{cl.length}</div>
                    </div>
                    <div className="kcards">
                      {cl.map(l=>(
                        <div key={l.id} className="kcard" onClick={()=>setEditLead(l)}>
                          <div className="kstripe" style={{background:SS[col]}}/>
                          <div className="kname">{l.name}</div>
                          <div className="kphone">{l.phone}</div>
                          <div style={{marginTop:5,display:'flex',gap:3}}>
                            <SB s={l.source}/>
                          </div>
                          <div style={{display:'flex',gap:3,marginTop:5}}>
                            <span className="fu-dot" style={{background:l.fu1_sent?'var(--green)':'var(--br2)',fontSize:9}}>1</span>
                            <span className="fu-dot" style={{background:l.fu2_sent?'var(--green)':'var(--br2)',fontSize:9}}>3</span>
                            <span className="fu-dot" style={{background:l.fu3_sent?'var(--green)':'var(--br2)',fontSize:9}}>7</span>
                          </div>
                        </div>
                      ))}
                      {cl.length===0&&<div style={{textAlign:'center',padding:'14px 8px',color:'var(--t3)',fontSize:11}}>Empty</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>}

          {/* ── INBOX ── */}
          {view==='inbox'&&<div className="fi" style={{height:'calc(100vh - 96px)'}}>
            <div className="inbox">
              <div className="ilist">
                {leads.map(l=>(
                  <div key={l.id} className={`iitem${activeChat?.id===l.id?' ia':''}`} onClick={()=>setActiveChat(l)}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                      <span>{SI[l.source]||'🌐'}</span>
                      <span style={{fontSize:13,fontWeight:600,flex:1}}>{l.name}</span>
                      <span className="mono sm grey">{l.last_contact}</span>
                    </div>
                    <div style={{fontSize:12,color:'var(--t2)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l.notes||'No notes'}</div>
                    <span className={`badge ${SC[l.status]}`} style={{fontSize:10,padding:'2px 6px',marginTop:4,display:'inline-block'}}>{l.status}</span>
                  </div>
                ))}
                {leads.length===0&&<Emp icon="📭" text="No leads"/>}
              </div>
              <div className="carea">
                {activeChat?(<>
                  <div className="chead">
                    <div className="cav">{activeChat.name?.[0]?.toUpperCase()}</div>
                    <div><div style={{fontWeight:600,fontSize:14}}>{activeChat.name}</div>
                    <div className="mono sm grey">{SI[activeChat.source]} {activeChat.source} · {activeChat.phone}</div></div>
                    <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
                      <span className={`badge ${SC[activeChat.status]}`}>{activeChat.status}</span>
                      <button className="btn sm" onClick={()=>setEditLead(activeChat)}>Edit</button>
                    </div>
                  </div>
                  <div className="cmsgs">
                    {msgs.map((m,i)=>(
                      <div key={i} style={{display:'flex',flexDirection:'column'}}>
                        <div className={`mb ${m.direction}`}>{m.text}</div>
                        <div className={`mm mono ${m.direction==='out'?'out':''}`}>{new Date(m.created_at).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</div>
                      </div>
                    ))}
                    <div ref={msgsEnd}/>
                  </div>
                  <div className="cinput">
                    <textarea className="ci" value={chatInput} onChange={e=>setChatInput(e.target.value)}
                      placeholder="Type message… (Enter to send)"
                      onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg()}}} rows={1}/>
                    <button className="sbtn" onClick={sendMsg}>→</button>
                  </div>
                </>):(
                  <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:'var(--t3)',fontSize:13}}>
                    <div style={{fontSize:36}}>💬</div><div>Select a lead</div>
                  </div>
                )}
              </div>
            </div>
          </div>}

          {/* ── ANALYTICS ── */}
          {view==='analytics'&&<div className="fi">
            {/* Range selector */}
            <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:12,color:'var(--t3)',fontFamily:'var(--mono)'}}>RANGE:</span>
              {[['7','7 Days'],['30','30 Days'],['90','90 Days'],['365','All Year']].map(([v,l])=>(
                <button key={v} onClick={()=>setAnalyticsRange(v)} className={`btn${analyticsRange===v?' bp':' br'}`} style={{fontSize:12,padding:'5px 12px'}}>{l}</button>
              ))}
              {analyticsLoading && <span style={{fontSize:12,color:'var(--t3)'}}>⟳ Loading...</span>}
            </div>
            {/* Summary Cards */}
            <div className="sgrid" style={{marginBottom:16}}>
              <SC2 c="blue" label="Total Leads" num={analytics?.summary?.total||stats.total}/>
              <SC2 c="green" label="Conversion Rate" num={`${analytics?.summary?.conversionRate||0}%`}/>
              <SC2 c="red" icon="🔥" label="Hot Leads" num={analytics?.summary?.hotLeads||stats.hot} sub="score ≥ 75"/>
              <SC2 c="purple" label="Avg Lead Score" num={`${analytics?.summary?.avgScore||0}/100`}/>
            </div>
            <div className="twocol" style={{marginBottom:14}}>
              {/* Status Distribution */}
              <div className="card">
                <div className="ct">Status Distribution</div>
                {analytics?.statusDist ? (
                  <BChart items={STATUSES.map(s=>({label:s,val:analytics.statusDist[s]||0,color:SS[s]}))} lw={120}/>
                ) : <BChart items={STATUSES.map(s=>({label:s,val:leads.filter(l=>l.status===s).length,color:SS[s]}))} lw={120}/>}
              </div>
              {/* Source Performance */}
              <div className="card">
                <div className="ct">Source Performance ({analyticsRange}d)</div>
                {analytics?.sourceDist ? (
                  <BChart items={Object.entries(analytics.sourceDist).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([s,v],i)=>({label:`${SI[s]||'📌'} ${s}`,val:v,color:SRCCOL[i%SRCCOL.length]}))}/>
                ) : <BChart items={SOURCES.map((s,i)=>({label:`${SI[s]} ${s}`,val:leads.filter(l=>l.source===s).length,color:SRCCOL[i]}))}/>}
              </div>
            </div>
            {/* Lead Score Heatmap */}
            <div className="card" style={{marginBottom:14}}>
              <div className="ct">Lead Score Distribution — AI Powered</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                {analytics?.scoreRanges ? Object.entries(analytics.scoreRanges).map(([label,count],i)=>{
                  const colors=['#ef4444','#f59e0b','#3b82f6','#6b7280']
                  const total=Object.values(analytics.scoreRanges).reduce((s,v)=>s+v,0)
                  const pct=total>0?Math.round(count/total*100):0
                  return(
                    <div key={label} style={{background:'var(--bg3)',borderRadius:10,padding:14,border:'1px solid var(--br)',textAlign:'center'}}>
                      <div style={{fontSize:24,fontWeight:800,color:colors[i]}}>{count}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{label}</div>
                      <div style={{marginTop:8,background:'var(--br)',borderRadius:99,height:4}}>
                        <div style={{width:`${pct}%`,background:colors[i],borderRadius:99,height:4,transition:'width 0.5s'}}/>
                      </div>
                      <div style={{fontSize:10,color:'var(--t3)',marginTop:4}}>{pct}%</div>
                    </div>
                  )
                }) : [['Hot 🔥',stats.hot,'#ef4444'],['Warm 🌤️',stats.warm,'#f59e0b']].map(([l,n,c])=>(
                  <div key={l} style={{background:'var(--bg3)',borderRadius:10,padding:14,border:'1px solid var(--br)',textAlign:'center'}}>
                    <div style={{fontSize:24,fontWeight:800,color:c}}>{n}</div>
                    <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Follow-up Funnel */}
            <div className="twocol">
              <div className="card">
                <div className="ct">Email Sequence Funnel</div>
                {[
                  ['Total Leads', analytics?.funnelData?.total||stats.total, '#3b82f6'],
                  ['Day 1 Sent', analytics?.funnelData?.d1Sent||leads.filter(l=>l.day1_sent||l.fu1_sent).length, '#6366f1'],
                  ['Day 3 Sent', analytics?.funnelData?.d3Sent||leads.filter(l=>l.day3_sent||l.fu2_sent).length, '#8b5cf6'],
                  ['Day 7 Sent', analytics?.funnelData?.d7Sent||leads.filter(l=>l.day7_sent||l.fu3_sent).length, '#a855f7'],
                  ['Sequence Done', analytics?.funnelData?.completed||0, '#10b981'],
                ].map(([label,val,color],i,arr)=>{
                  const max=arr[0][1]||1
                  return(
                    <div key={label} style={{marginBottom:10}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                        <span style={{color:'var(--t2)'}}>{label}</span>
                        <span style={{fontWeight:700,color}}>{val}</span>
                      </div>
                      <div style={{background:'var(--br)',borderRadius:99,height:8}}>
                        <div style={{width:`${Math.round(val/max*100)}%`,background:color,borderRadius:99,height:8,transition:'width 0.5s'}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Niche Breakdown */}
              <div className="card">
                <div className="ct">Top Niches ({analyticsRange}d)</div>
                {analytics?.nicheDist ? (
                  <BChart items={Object.entries(analytics.nicheDist).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([n,v],i)=>({label:n,val:v,color:SRCCOL[i%SRCCOL.length]}))}/>
                ) : (
                  <div style={{color:'var(--t3)',fontSize:13,padding:'20px 0',textAlign:'center'}}>
                    Loading niche data...
                  </div>
                )}
              </div>
            </div>
          </div>}

          {/* settings view removed — was n8n setup guide, no longer needed in UI */}

        </div>
      </main>
    </div>

    {/* ADD MODAL */}
    {showAdd&&<Modal title="Add New Lead" onClose={()=>setShowAdd(false)}>
      <div className="fr2"><Field label="Name *"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Rahul Sharma"/></Field>
      <Field label="Phone *"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+8801711234567"/></Field></div>
      <div className="fr2">
        <Field label="Email"><input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="info@business.com" type="email"/></Field>
        <Field label="Niche"><input value={form.niche} onChange={e=>setForm({...form,niche:e.target.value})} placeholder="gym, salon, clinic…"/></Field>
      </div>
      <div className="fr2">
        <Field label="Source"><select value={form.source} onChange={e=>setForm({...form,source:e.target.value})}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Status"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Tags (comma separated)"><input value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})} placeholder="dhaka, hot-area, vip"/></Field>
      <Field label="Notes"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Lead details…" rows={3}/></Field>
      <div className="mfoot"><button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button><button className="btn bp" onClick={addLead}>Add Lead</button></div>
    </Modal>}

    {/* EDIT MODAL */}
    {editLead&&<Modal title={editLead.name} onClose={()=>setEditLead(null)}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,padding:'10px 14px',background:'var(--bg3)',borderRadius:10,border:'1px solid var(--br)'}}>
        <ScorePill score={editLead.score||0} large/>
        {editLead.niche&&<span className="tag" style={{fontSize:12}}>🏷️ {editLead.niche}</span>}
        <TagList tags={editLead.tags}/>
      </div>
      <div className="fr2">
        <Field label="Name"><input defaultValue={editLead.name} id="en"/></Field>
        <Field label="Phone"><input defaultValue={editLead.phone} id="ep"/></Field>
      </div>
      <div className="fr2">
        <Field label="Email"><input defaultValue={editLead.email||''} id="eem" type="email" placeholder="email@example.com"/></Field>
        <Field label="Niche"><input defaultValue={editLead.niche||''} id="enic" placeholder="gym, salon…"/></Field>
      </div>
      <div className="fr2">
        <Field label="Source"><select defaultValue={editLead.source} id="esrc">{SOURCES.map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Status"><select defaultValue={editLead.status} id="est">{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Notes"><textarea defaultValue={editLead.notes} id="en2" rows={3}/></Field>
      <div className="tag-row">
        <span className="tag">📅 {editLead.created_at?.slice(0,10)}</span>
        {editLead.email&&<span className="tag">✉️ {editLead.email}</span>}
        <span className="tag" style={{color:editLead.fu1_sent?'var(--green)':'var(--t3)'}}>FU1: {editLead.fu1_sent?'✓':'⏳'}</span>
        <span className="tag" style={{color:editLead.fu2_sent?'var(--green)':'var(--t3)'}}>FU3: {editLead.fu2_sent?'✓':'⏳'}</span>
        <span className="tag" style={{color:editLead.fu3_sent?'var(--green)':'var(--t3)'}}>FU7: {editLead.fu3_sent?'✓':'⏳'}</span>
      </div>
      <div className="mfoot">
        <button className="btn br" onClick={()=>deleteLead(editLead.id)}>Delete</button>
        <button className="btn" onClick={()=>setEditLead(null)}>Cancel</button>
        <button className="btn bg" onClick={()=>updateLead(editLead.id,{name:document.getElementById('en').value,phone:document.getElementById('ep').value,email:document.getElementById('eem').value||null,niche:document.getElementById('enic').value||null,source:document.getElementById('esrc').value,status:document.getElementById('est').value,notes:document.getElementById('en2').value})}>Save</button>
      </div>
    </Modal>}

    {notif&&<div className={`notif${notif.type==='err'?' nerr':''}`}><div className="ndot"/>  {notif.msg}</div>}

    <style jsx global>{`
      *{margin:0;padding:0;box-sizing:border-box}
      :root{
        /* === LIGHT THEME — White + Blue Professional === */
        --bg:#f5f8fc;          /* page background — very light blue-grey */
        --bg2:#ffffff;         /* sidebar / topbar bg */
        --bg3:#f1f5fb;         /* input / table-head bg */
        --bg4:#e8eef7;         /* hover / chip bg */
        --panel:#ffffff;       /* card bg */
        --br:#e2e8f0;          /* default border */
        --br2:#cbd5e1;         /* stronger border (hover/active) */
        --accent:#2563eb;      /* primary blue */
        --a2:#1d4ed8;          /* hover blue */
        --aglow:rgba(37,99,235,0.10);
        --green:#059669;--amber:#d97706;--red:#dc2626;--purple:#7c3aed;--cyan:#0891b2;
        --text:#0f172a;        /* primary text — near-black */
        --t2:#475569;          /* secondary text — slate */
        --t3:#94a3b8;          /* tertiary / labels — light slate */
        --shadow:0 1px 3px rgba(15,23,42,0.04),0 1px 2px rgba(15,23,42,0.06);
        --shadow-lg:0 10px 30px rgba(15,23,42,0.08),0 4px 12px rgba(15,23,42,0.04);
        --sans:'Inter','DM Sans',sans-serif;--disp:'Inter','DM Sans',sans-serif;--mono:'JetBrains Mono','DM Mono',monospace;
      }
      html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;overflow:hidden;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
      .app{display:flex;height:100vh;overflow:hidden}
      .sidebar{width:230px;min-width:230px;background:var(--bg2);border-right:1px solid var(--br);display:flex;flex-direction:column}
      .logo-wrap{padding:22px 22px 18px;border-bottom:1px solid var(--br)}
      .logo{font-family:var(--disp);font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--text)}
      .logo span{color:var(--accent)}
      .logo-sub{font-size:10px;color:var(--t3);font-family:var(--mono);margin-top:3px;letter-spacing:0.05em}
      .ni{display:flex;align-items:center;gap:10px;padding:10px 14px;margin:2px 10px;border-radius:8px;cursor:pointer;color:var(--t2);font-size:13.5px;font-weight:500;transition:all 0.15s;border:1px solid transparent;user-select:none}
      .ni:hover{background:var(--bg3);color:var(--text)}
      .ni.a{background:var(--aglow);color:var(--accent);border-color:rgba(37,99,235,0.18);font-weight:600}
      .nico{width:18px;text-align:center;flex-shrink:0;font-size:14px}
      .nbadge{margin-left:auto;background:var(--accent);color:#fff;font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:10px;font-weight:600}
      .nbadge-warn{background:var(--amber)!important}
      .uav{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:white;font-family:var(--disp)}
      .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
      .topbar{height:60px;min-height:60px;background:var(--bg2);border-bottom:1px solid var(--br);display:flex;align-items:center;padding:0 24px;gap:14px;box-shadow:var(--shadow)}
      .topbar-title{font-family:var(--disp);font-size:16px;font-weight:700;color:var(--text)}
      .sbox{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:7px 12px;width:240px;transition:all 0.15s}
      .sbox:focus-within{border-color:var(--accent);background:#fff;box-shadow:0 0 0 3px var(--aglow)}
      .sbox input{background:none;border:none;outline:none;color:var(--text);font-size:13px;width:100%}
      .sbox input::placeholder{color:var(--t3)}
      .content{flex:1;overflow-y:auto;padding:22px 26px;background:var(--bg)}
      .content::-webkit-scrollbar{width:6px}
      .content::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
      .fi{animation:fi 0.2s ease}
      @keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      /* STATS */
      .sgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
      .scard{background:var(--panel);border:1px solid var(--br);border-radius:12px;padding:18px 20px;position:relative;overflow:hidden;box-shadow:var(--shadow);transition:transform 0.15s,box-shadow 0.15s}
      .scard:hover{transform:translateY(-1px);box-shadow:var(--shadow-lg)}
      .scard::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
      .scard.blue::before{background:var(--accent)}
      .scard.green::before{background:var(--green)}
      .scard.amber::before{background:var(--amber)}
      .scard.purple::before{background:var(--purple)}
      .scard.red::before{background:var(--red)}
      .slabel{font-size:11px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;font-weight:500}
      .snum{font-size:30px;font-weight:700;font-family:var(--disp);line-height:1;color:var(--text);letter-spacing:-0.5px}
      .ssub{font-size:11px;color:var(--t3);margin-top:6px}
      .sico{position:absolute;top:16px;right:16px;font-size:18px;opacity:0.45}
      /* CARDS */
      .twocol{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .card{background:var(--panel);border:1px solid var(--br);border-radius:12px;padding:20px;box-shadow:var(--shadow)}
      .card.p0{padding:0}
      .ct{font-family:var(--disp);font-size:14px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:6px;color:var(--text)}
      .ct.mb0{margin-bottom:0}
      .card-hdr{display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid var(--br);gap:12px;flex-wrap:wrap}
      /* TABLE */
      .tbl{width:100%;border-collapse:collapse}
      .tbl thead th{padding:10px 16px;text-align:left;font-size:11px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--br);background:var(--bg3);font-weight:500}
      .tbl tbody tr{border-bottom:1px solid var(--br);transition:background 0.1s}
      .tbl tbody tr:hover{background:var(--bg3)}
      .tbl tbody tr:last-child{border-bottom:none}
      .tbl td{padding:12px 16px;font-size:13px;color:var(--text)}
      /* BADGES — solid soft-color pills for light theme */
      .badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;font-family:var(--mono)}
      .bn{background:#dbeafe;color:#1e40af}
      .bc{background:#fef3c7;color:#92400e}
      .bi{background:#ede9fe;color:#5b21b6}
      .bd{background:#cffafe;color:#155e75}
      .bw{background:#d1fae5;color:#065f46}
      .bl{background:#fee2e2;color:#991b1b}
      .sbadge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:5px;font-size:11px;background:var(--bg3);border:1px solid var(--br);color:var(--t2);font-weight:500}
      .sf{background:#dbeafe;color:#1e40af;border-color:#93c5fd}
      .si{background:#fce7f3;color:#9f1239;border-color:#f9a8d4}
      .sw{background:#d1fae5;color:#065f46;border-color:#6ee7b7}
      .swb{background:#fef3c7;color:#92400e;border-color:#fcd34d}
      .st{background:#cffafe;color:#155e75;border-color:#67e8f9}
      .sfb{background:#ffedd5;color:#9a3412;border-color:#fdba74}
      .sr{background:#ede9fe;color:#5b21b6;border-color:#c4b5fd}
      /* FILTER TABS */
      .ftabs{display:flex;gap:4px;flex-wrap:wrap}
      .ftab{padding:6px 12px;border-radius:7px;border:1px solid transparent;font-size:12px;cursor:pointer;color:var(--t2);background:none;transition:all 0.15s;font-family:var(--sans);font-weight:500}
      .ftab:hover{background:var(--bg3);color:var(--text)}
      .ftab.fa{background:var(--aglow);color:var(--accent);border-color:rgba(37,99,235,0.2);font-weight:600}
      .ftab-cnt{background:var(--amber);color:#fff;font-size:10px;font-family:var(--mono);padding:1px 6px;border-radius:8px;margin-left:4px;font-weight:600}
      /* FOLLOW-UP */
      .fu-list{display:flex;flex-direction:column;gap:10px}
      .fu-card{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg3);border:1px solid var(--br);border-radius:10px;transition:background 0.1s,border-color 0.1s}
      .fu-card:hover{background:var(--bg4);border-color:var(--br2)}
      .fu-left{display:flex;align-items:flex-start;gap:12px;flex:1}
      .fu-day-badge{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;font-family:var(--mono);white-space:nowrap}
      .fu-name{font-size:14px;font-weight:600;margin-bottom:3px;color:var(--text)}
      .fu-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px;color:var(--t2);font-size:12px}
      .fu-preview{font-size:12px;color:var(--t3);max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fu-right{display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0}
      .fu-days{font-size:11px;font-family:var(--mono);color:var(--t3)}
      .fu-dot{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-family:var(--mono);color:white;font-weight:600}
      /* KANBAN */
      .kanban{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
      .kcol{background:var(--panel);border:1px solid var(--br);border-radius:12px;min-height:380px;display:flex;flex-direction:column;box-shadow:var(--shadow)}
      .kcol-h{padding:11px 14px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:6px;background:var(--bg3);border-radius:12px 12px 0 0}
      .cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .ctitle{font-size:10.5px;font-weight:700;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.05em;flex:1;color:var(--t2)}
      .ccnt{background:#fff;border:1px solid var(--br);border-radius:10px;font-size:10px;font-family:var(--mono);padding:1px 7px;color:var(--t2);font-weight:600}
      .kcards{padding:8px;display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto}
      .kcard{background:#fff;border:1px solid var(--br);border-radius:9px;padding:10px 10px 10px 14px;cursor:pointer;transition:all 0.15s;position:relative;overflow:hidden}
      .kcard:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:var(--shadow)}
      .kstripe{position:absolute;left:0;top:0;bottom:0;width:3px}
      .kname{font-size:13px;font-weight:600;margin-bottom:2px;color:var(--text)}
      .kphone{font-size:10.5px;font-family:var(--mono);color:var(--t3)}
      /* INBOX */
      .inbox{display:grid;grid-template-columns:300px 1fr;height:100%;border:1px solid var(--br);border-radius:12px;overflow:hidden;background:var(--panel);box-shadow:var(--shadow)}
      .ilist{border-right:1px solid var(--br);overflow-y:auto;background:var(--panel)}
      .ilist::-webkit-scrollbar{width:4px}
      .ilist::-webkit-scrollbar-thumb{background:#cbd5e1}
      .iitem{padding:13px 15px;border-bottom:1px solid var(--br);cursor:pointer;transition:background 0.1s}
      .iitem:hover{background:var(--bg3)}
      .iitem.ia{background:var(--aglow);border-left:3px solid var(--accent)}
      .carea{background:var(--bg);display:flex;flex-direction:column}
      .chead{padding:14px 18px;border-bottom:1px solid var(--br);background:var(--panel);display:flex;align-items:center;gap:12px}
      .cav{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--cyan));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white;flex-shrink:0}
      .cmsgs{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px}
      .cmsgs::-webkit-scrollbar{width:4px}
      .cmsgs::-webkit-scrollbar-thumb{background:#cbd5e1}
      .mb{max-width:70%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5}
      .mb.in{background:var(--panel);border:1px solid var(--br);align-self:flex-start;border-radius:4px 12px 12px 12px;color:var(--text);box-shadow:var(--shadow)}
      .mb.out{background:var(--accent);color:#fff;align-self:flex-end;border-radius:12px 4px 12px 12px}
      .mm{font-size:10px;color:var(--t3);margin-top:3px}
      .mm.out{text-align:right;color:rgba(255,255,255,0.7)}
      .cinput{padding:12px 14px;border-top:1px solid var(--br);background:var(--panel);display:flex;gap:8px;align-items:flex-end}
      .ci{flex:1;background:#fff;border:1px solid var(--br);border-radius:10px;padding:9px 13px;color:var(--text);font-size:13px;font-family:var(--sans);resize:none;min-height:38px;max-height:100px;outline:none;transition:border 0.15s}
      .ci:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--aglow)}
      .sbtn{background:var(--accent);border:none;color:white;width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0;transition:background 0.15s}
      .sbtn:hover{background:var(--a2)}
      /* MODAL */
      .moverlay{position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center}
      .modal{background:var(--panel);border:1px solid var(--br);border-radius:14px;width:560px;max-height:88vh;overflow-y:auto;box-shadow:var(--shadow-lg)}
      .modal::-webkit-scrollbar{width:4px}
      .modal::-webkit-scrollbar-thumb{background:var(--br2)}
      .mhead{padding:18px 22px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--panel);z-index:2}
      .mtitle{font-family:var(--disp);font-size:16px;font-weight:700;color:var(--text)}
      .mclose{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;font-size:20px;padding:4px 6px;border-radius:6px}
      .mclose:hover{color:var(--text);background:var(--bg3)}
      .mbody{padding:22px}
      .mfoot{display:flex;gap:10px;justify-content:flex-end;padding-top:16px;margin-top:8px;border-top:1px solid var(--br)}
      .fr2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .fg{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
      label{font-size:11px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:0.05em;font-weight:500}
      input,select,textarea{background:#fff;border:1px solid var(--br);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;font-family:var(--sans);outline:none;transition:border 0.15s,box-shadow 0.15s;width:100%}
      input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--aglow)}
      select option{background:#fff;color:var(--text)}
      textarea{resize:vertical}
      /* BUTTONS — clean light-mode style */
      .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:7px;border:1px solid var(--br);background:#fff;color:var(--text);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.15s;font-family:var(--sans)}
      .btn:hover{border-color:var(--accent);color:var(--accent);background:var(--aglow)}
      .btn.sm{padding:4px 10px;font-size:11px}
      .btn.bp{background:var(--accent);border-color:var(--accent);color:#fff}
      .btn.bp:hover{background:var(--a2);color:#fff;border-color:var(--a2)}
      .btn.bg{background:#fff;border-color:var(--green);color:var(--green)}
      .btn.bg:hover{background:var(--green);color:#fff;border-color:var(--green)}
      .btn.br{background:#fff;border-color:var(--red);color:var(--red)}
      .btn.br:hover{background:var(--red);color:#fff}
      /* SETTINGS / MISC */
      .wbox{font-family:var(--mono);font-size:12px;background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:10px 12px;color:var(--accent);word-break:break-all;margin-bottom:10px;line-height:1.5}
      .prebox{font-family:var(--mono);font-size:12px;background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:14px;color:var(--t2);line-height:1.7;white-space:pre-wrap;overflow-x:auto}
      .code{font-family:var(--mono);font-size:12px;background:var(--bg3);padding:2px 6px;border-radius:4px;border:1px solid var(--br);color:var(--accent)}
      .mini-select{background:#fff;border:1px solid var(--br);border-radius:7px;padding:5px 10px;color:var(--text);font-size:12px;font-family:var(--sans);outline:none;cursor:pointer}
      .mini-select:focus{border-color:var(--accent)}
      /* MISC */
      .tag-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
      .tag{display:inline-block;padding:3px 8px;border-radius:5px;font-size:11px;font-family:var(--mono);background:var(--bg3);color:var(--t2);border:1px solid var(--br)}
      .ldot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
      .mono{font-family:var(--mono)}.sm{font-size:12px}.grey{color:var(--t3)}
      /* NOTIF */
      .notif{position:fixed;bottom:20px;right:20px;background:var(--panel);border:1px solid var(--green);border-radius:10px;padding:12px 18px;font-size:13px;z-index:999;display:flex;align-items:center;gap:10px;max-width:340px;animation:su 0.3s ease;box-shadow:var(--shadow-lg);color:var(--text)}
      .notif.nerr{border-color:var(--red)}
      .ndot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0}
      .notif.nerr .ndot{background:var(--red)}
      @keyframes su{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      ::-webkit-scrollbar{width:6px;height:6px}
      ::-webkit-scrollbar-track{background:transparent}
      ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
      ::-webkit-scrollbar-thumb:hover{background:#94a3b8}
      /* ── HAMBURGER ── */
      .ham{display:none;background:var(--bg3);border:1px solid var(--br);border-radius:7px;color:var(--text);font-size:18px;padding:5px 10px;cursor:pointer;flex-shrink:0}
      .ham:hover{background:var(--bg4)}
      /* ── MOBILE OVERLAY ── */
      .mob-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.4);z-index:49;backdrop-filter:blur(2px)}
      /* ── RESPONSIVE ── */
      /* ── TABLET ── */
      @media(max-width:1100px){
        .sgrid{grid-template-columns:repeat(3,1fr)}
        .kanban{grid-template-columns:repeat(3,1fr);grid-auto-rows:min-content}
      }
      /* ── MOBILE ── */
      @media(max-width:768px){
        html,body{overflow:auto}
        .app{flex-direction:column;height:auto;min-height:100vh}
        .sidebar{
          position:fixed;top:0;left:0;bottom:0;z-index:50;
          transform:translateX(-100%);transition:transform 0.25s ease;
          width:250px;min-width:250px;
          box-shadow:0 0 24px rgba(15,23,42,0.18);
        }
        .sidebar.open{transform:translateX(0)}
        .ham{display:flex}
        .main{flex:1;display:flex;flex-direction:column;min-height:100vh;overflow:auto}
        .topbar{height:54px;min-height:54px;padding:0 14px;gap:10px}
        .topbar-title{font-size:15px}
        .sbox{width:140px;padding:6px 10px}
        .content{padding:14px 12px;overflow-y:visible}
        /* STATS GRID */
        .sgrid{grid-template-columns:repeat(2,1fr)!important;gap:10px;margin-bottom:14px}
        .scard{padding:14px}
        .snum{font-size:24px}
        /* TWO COL → ONE COL */
        .twocol{grid-template-columns:1fr!important}
        /* KANBAN SCROLL */
        .kanban{grid-template-columns:repeat(6,240px)!important;overflow-x:auto;padding-bottom:8px}
        /* INBOX */
        .inbox{grid-template-columns:1fr!important;height:auto}
        .ilist{max-height:280px;border-right:none;border-bottom:1px solid var(--br)}
        .carea{min-height:420px}
        /* MODAL */
        .modal{width:calc(100vw - 24px)!important;max-height:92vh}
        .mbody{padding:18px}
        .fr2{grid-template-columns:1fr!important}
        /* TABLE scroll */
        .tbl{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}
        /* FOLLOW-UP */
        .fu-card{flex-direction:column!important;align-items:flex-start!important;gap:10px}
        .fu-right{flex-direction:row!important;flex-wrap:wrap;align-items:center!important;width:100%}
        /* CARD-HEADER */
        .card-hdr{flex-direction:column;align-items:flex-start!important}
        .card-hdr>div{flex-wrap:wrap}
        .ftabs{flex-wrap:wrap}
        /* CARDS */
        .card{padding:16px}
      }
      @media(max-width:480px){
        .sgrid{grid-template-columns:1fr!important}
        .topbar-title{display:none}
        .sbox{width:auto;flex:1;max-width:200px}
        .content{padding:12px 10px}
        .snum{font-size:22px}
      }

    `}</style>
  </>)
}

// ── sub-components ──────────────────────────────────────────────────────────
function SC2({c,icon,label,num,sub}){return(
  <div className={`scard ${c}`}>
    {icon&&<div className="sico">{icon}</div>}
    <div className="slabel">{label}</div>
    <div className="snum">{num}</div>
    {sub&&<div className="ssub">{sub}</div>}
  </div>
)}
function SB({s}){return <span className={`sbadge ${SRCC[s]||'sr'}`}>{SI[s]||'🌐'} {s}</span>}
function BChart({items,lw=100}){
  const max=Math.max(...items.map(i=>i.val),1)
  return(<div>{items.map(({label,val,color})=>(
    <div key={label} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
      <div style={{width:lw,fontSize:11,fontFamily:'var(--mono)',color:'var(--t2)',flexShrink:0}}>{label}</div>
      <div style={{flex:1,background:'#e2e8f0',borderRadius:4,height:7,overflow:'hidden'}}>
        <div style={{width:`${val/max*100}%`,height:'100%',borderRadius:4,background:color,transition:'width 0.7s cubic-bezier(.4,0,.2,1)'}}/>
      </div>
      <div style={{fontSize:11,fontFamily:'var(--mono)',color:'var(--t3)',width:24,textAlign:'right',flexShrink:0}}>{val}</div>
    </div>
  ))}</div>)
}
function Field({label,children}){return <div className="fg"><label>{label}</label>{children}</div>}
function Emp({icon,text}){return <div style={{textAlign:'center',padding:'36px 20px',color:'var(--t3)'}}><div style={{fontSize:28,marginBottom:8,opacity:0.5}}>{icon}</div><div style={{fontSize:13}}>{text}</div></div>}
function ScorePill({score,large}){
  const sl=scoreLabel(score||0)
  return <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:large?'4px 10px':'3px 7px',borderRadius:6,background:`${sl.c}18`,border:`1px solid ${sl.c}40`,color:sl.c,fontSize:large?13:11,fontFamily:'var(--mono)',fontWeight:600}}>{sl.t} <span style={{opacity:0.7}}>{score||0}</span></span>
}
function TagList({tags}){
  if(!tags||tags.length===0) return null
  return <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{tags.slice(0,3).map((t,i)=>(
    <span key={i} style={{padding:'2px 6px',borderRadius:4,background:'var(--bg4)',border:'1px solid var(--br2)',color:'var(--t2)',fontSize:10,fontFamily:'var(--mono)'}}>{t}</span>
  ))}{tags.length>3&&<span style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--mono)'}}>+{tags.length-3}</span>}</div>
}
function Modal({title,onClose,children}){return(
  <div className="moverlay" onClick={e=>{if(e.target.classList.contains('moverlay'))onClose()}}>
    <div className="modal">
      <div className="mhead"><div className="mtitle">{title}</div><button className="mclose" onClick={onClose}>✕</button></div>
      <div className="mbody">{children}</div>
    </div>
  </div>
)}
