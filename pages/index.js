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

export default function CRM() {
  const [view, setView]         = useState('dashboard')
  const [leads, setLeads]       = useState([])
  const [msgs, setMsgs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [filterSt, setFilterSt] = useState('All')
  const [filterSrc, setFilterSrc] = useState('All')
  const [searchQ, setSearchQ]   = useState('')
  const [activeChat, setActiveChat] = useState(null)
  const [editLead, setEditLead] = useState(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [notif, setNotif]       = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [fuTab, setFuTab]       = useState('all')
  const [form, setForm]         = useState({name:'',phone:'',source:'Website',status:'New Lead',notes:''})
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const msgsEnd = useRef(null)
  const ntTimer = useRef(null)
  const webhookUrl = typeof window!=='undefined' ? `${window.location.origin}/api/webhook/lead` : ''

  // ── fetch ─────────────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    const {data} = await supabase.from('leads').select('*').order('created_at',{ascending:false})
    if (data) setLeads(data)
    setLoading(false)
  }, [])

  const fetchMsgs = useCallback(async (lid) => {
    const {data} = await supabase.from('messages').select('*').eq('lead_id',lid).order('created_at',{ascending:true})
    if (data) setMsgs(data)
  }, [])

  // ── auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (localStorage.getItem('af_logged_in') !== '1') {
      router.replace('/login')
    } else {
      setAuthed(true)
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    fetchLeads()
    // Auto-refresh every 15 seconds (realtime fallback)
    const interval = setInterval(() => fetchLeads(), 15000)
    return () => clearInterval(interval)
    const ch = supabase.channel('rt-leads')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'leads'},p=>{
        setLeads(prev=>[p.new,...prev])
        notify(`🔔 New lead: ${p.new.name} via ${p.new.source}`)
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'leads'},p=>{
        setLeads(prev=>prev.map(l=>l.id===p.new.id?p.new:l))
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'leads'},p=>{
        setLeads(prev=>prev.filter(l=>l.id!==p.old.id))
      })
      .subscribe()
    const ch2 = supabase.channel('rt-msgs')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>{
        setMsgs(prev=>[...prev,p.new])
      })
      .subscribe()
    return ()=>{supabase.removeChannel(ch);supabase.removeChannel(ch2)}
  },[fetchLeads])

  useEffect(()=>{if(activeChat)fetchMsgs(activeChat.id)},[activeChat,fetchMsgs])
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
    if (!form.phone.trim()) return notify('Phone required!','err')
    const res = await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,last_contact:today()})})
    if (res.ok) { setShowAdd(false); setForm({name:'',phone:'',source:'Website',status:'New Lead',notes:''}); notify('✅ Lead added!'); fetchLeads() }
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
    const mq = !searchQ||l.name?.toLowerCase().includes(searchQ)||l.phone?.includes(searchQ)||(l.notes||'').toLowerCase().includes(searchQ)
    return ms&&mr&&mq
  })

  // Follow-up buckets
  const fuLeads = leads.filter(l=>!['Closed Won','Not Interested'].includes(l.status))
  const fu1Pending = fuLeads.filter(l=>!l.fu1_sent && daysSince(l.created_at)>=1)
  const fu2Pending = fuLeads.filter(l=>l.fu1_sent && !l.fu2_sent && daysSince(l.created_at)>=3)
  const fu3Pending = fuLeads.filter(l=>l.fu2_sent && !l.fu3_sent && daysSince(l.created_at)>=7)
  const fuAll = [...fu1Pending,...fu2Pending,...fu3Pending]
  const fuShown = fuTab==='d1'?fu1Pending:fuTab==='d3'?fu2Pending:fuTab==='d7'?fu3Pending:fuAll

  const stats = {
    total: leads.length,
    won: leads.filter(l=>l.status==='Closed Won').length,
    demo: leads.filter(l=>l.status==='Demo Booked').length,
    interested: leads.filter(l=>l.status==='Interested').length,
    fuPending: fuAll.length,
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (!authed) return null

  return (<>
    <Head>
      <title>FlowCRM v3</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
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
          ['dashboard','Dashboard','⊞',null],
          ['leads','All Leads','≡',leads.length],
          ['followup','Follow-ups','⏰',fuAll.length||null],
          ['kanban','Kanban','▦',null],
          ['inbox','Inbox','✉',null],
          ['analytics','Analytics','↗',null],
          ['settings','n8n & Setup','⚙',null],
        ].map(([id,label,icon,badge])=>(
          <div key={id} className={`ni${view===id?' a':''}`} onClick={()=>{setView(id);setSideOpen(false)}}>
            <span className="nico">{icon}</span>{label}
            {badge ? <span className={`nbadge${id==='followup'?' nbadge-warn':''}`}>{badge}</span> : null}
          </div>
        ))}
        <div style={{marginTop:'auto',padding:'16px',borderTop:'1px solid var(--br)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div className="uav">A</div>
            <div><div style={{fontSize:13,fontWeight:500}}>Admin</div><div style={{fontSize:11,color:'var(--t3)'}}>AutoFlow</div></div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <button className="ham" onClick={()=>setSideOpen(o=>!o)}>☰</button>
          <div className="topbar-title">
            {view==='dashboard'?'Dashboard':view==='leads'?'All Leads':view==='followup'?`Follow-ups ${fuAll.length>0?`(${fuAll.length} pending)`:''}`:view==='kanban'?'Kanban':view==='inbox'?'Inbox':view==='analytics'?'Analytics':'n8n & Setup'}
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
                <thead><tr><th>Name</th><th>Phone</th><th>Source</th><th>Status</th><th>FU</th><th>Last Contact</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {filtered.map(l=>(
                    <tr key={l.id} onClick={()=>setEditLead(l)} style={{cursor:'pointer'}}>
                      <td style={{fontWeight:600}}>{l.name}</td>
                      <td className="mono sm">{l.phone}</td>
                      <td><SB s={l.source}/></td>
                      <td><span className={`badge ${SC[l.status]}`}>{l.status}</span></td>
                      <td>
                        <div style={{display:'flex',gap:3}}>
                          <span className="fu-dot" style={{background:l.fu1_sent?'var(--green)':'var(--br2)'}}>1</span>
                          <span className="fu-dot" style={{background:l.fu2_sent?'var(--green)':'var(--br2)'}}>3</span>
                          <span className="fu-dot" style={{background:l.fu3_sent?'var(--green)':'var(--br2)'}}>7</span>
                        </div>
                      </td>
                      <td className="mono sm grey">{l.last_contact}</td>
                      <td className="grey" style={{maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.notes||'—'}</td>
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
            <div className="sgrid">
              <SC2 c="blue" label="Total Leads" num={stats.total}/>
              <SC2 c="green" label="Conversion" num={`${stats.total?Math.round(stats.won/stats.total*100):0}%`}/>
              <SC2 c="amber" label="Follow-ups Due" num={fuAll.length}/>
              <SC2 c="purple" label="Sources Active" num={SOURCES.filter(s=>leads.some(l=>l.source===s)).length}/>
            </div>
            <div className="twocol">
              <div className="card">
                <div className="ct">Status Distribution</div>
                <BChart items={STATUSES.map(s=>({label:s,val:leads.filter(l=>l.status===s).length,color:SS[s]}))} lw={120}/>
              </div>
              <div className="card">
                <div className="ct">Source Performance</div>
                <BChart items={SOURCES.map((s,i)=>({label:`${SI[s]} ${s}`,val:leads.filter(l=>l.source===s).length,color:SRCCOL[i]}))}/>
              </div>
            </div>
            <div className="card" style={{marginTop:14}}>
              <div className="ct">Follow-up Status Overview</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                {[['Day 1','fu1_sent','#3b82f6'],[' Day 3','fu2_sent','#a855f7'],['Day 7','fu3_sent','#ef4444']].map(([label,key,color])=>{
                  const sent=leads.filter(l=>l[key]).length
                  const pending=leads.filter(l=>!l[key]&&!['Closed Won','Not Interested'].includes(l.status)).length
                  return(
                    <div key={key} style={{background:'var(--bg3)',borderRadius:10,padding:14,border:'1px solid var(--br)'}}>
                      <div style={{fontSize:11,fontFamily:'var(--mono)',color:'var(--t3)',marginBottom:8}}>{label} Follow-up</div>
                      <div style={{fontSize:22,fontWeight:700,color,marginBottom:4}}>{sent}</div>
                      <div style={{fontSize:11,color:'var(--t3)'}}>sent · <span style={{color:'var(--amber)'}}>{pending} pending</span></div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>}

          {/* ── SETTINGS ── */}
          {view==='settings'&&<div className="fi">
            <div className="card">
              <div className="ct">🔗 Webhook URLs — n8n এ use করো</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr><th style={{padding:'8px 12px',textAlign:'left',fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)',borderBottom:'1px solid var(--br)'}}>PURPOSE</th><th style={{padding:'8px 12px',textAlign:'left',fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)',borderBottom:'1px solid var(--br)'}}>URL</th><th style={{padding:'8px 12px',borderBottom:'1px solid var(--br)'}}></th></tr></thead>
                <tbody>
                  {[
                    ['New Lead (form/FB Ad)',webhookUrl],
                    ['Follow-up Check (daily)',webhookUrl.replace('/webhook/lead','/followup/run')],
                    ['Mark Follow-up Done',webhookUrl.replace('/webhook/lead','/followup/mark')],
                  ].map(([label,url])=>(
                    <tr key={label} style={{borderBottom:'1px solid var(--br)'}}>
                      <td style={{padding:'10px 12px',color:'var(--t2)'}}>{label}</td>
                      <td style={{padding:'10px 12px',fontFamily:'var(--mono)',fontSize:11,color:'var(--accent)'}}>{url}</td>
                      <td style={{padding:'10px 12px'}}><button className="btn sm" onClick={()=>{navigator.clipboard.writeText(url);notify('Copied!')}}>Copy</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card" style={{marginTop:14}}>
              <div className="ct">🗄️ Supabase SQL — একবার run করো</div>
              <pre className="prebox">{`create table if not exists leads (
  id uuid default gen_random_uuid() primary key,
  name text not null, phone text not null,
  source text default 'Website',
  status text default 'New Lead',
  notes text default '',
  fu1_sent boolean default false, fu1_sent_at timestamptz,
  fu2_sent boolean default false, fu2_sent_at timestamptz,
  fu3_sent boolean default false, fu3_sent_at timestamptz,
  last_contact date default current_date,
  fb_lead_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade,
  direction text default 'out',
  channel text default 'whatsapp',
  text text not null,
  created_at timestamptz default now()
);
create table if not exists followup_logs (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade,
  fu_day int not null, status text default 'sent',
  created_at timestamptz default now()
);
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table messages;
alter table leads disable row level security;
alter table messages disable row level security;
alter table followup_logs disable row level security;`}</pre>
              <button className="btn" style={{marginTop:10}} onClick={()=>{navigator.clipboard.writeText('-- copy from above');notify('SQL copied!')}}>📋 Copy SQL</button>
            </div>

            <div className="card" style={{marginTop:14}}>
              <div className="ct">📋 n8n Workflow — Step by Step</div>
              <div style={{fontSize:13,color:'var(--t2)',lineHeight:2}}>
                <p><strong style={{color:'var(--text)'}}>Workflow 1 — Landing Page / FB Lead Ads:</strong></p>
                <p>① Webhook Trigger (POST) → ② Set Node (data map) → ③ HTTP POST to <code className="code">/api/webhook/lead</code> → ④ Google Sheets Append → ⑤ WhatsApp First Message → ⑥ Telegram Admin Alert</p>
                <br/>
                <p><strong style={{color:'var(--text)'}}>Workflow 2 — Facebook Lead Ads (আলাদা):</strong></p>
                <p>① Facebook Lead Ads Trigger → ② Set Node (name, phone, source=&quot;FB_Lead_Ad&quot;) → ③ HTTP POST to <code className="code">/api/webhook/lead</code> → ④ WhatsApp → ⑤ Telegram</p>
                <br/>
                <p><strong style={{color:'var(--text)'}}>Workflow 3 — Auto Follow-up (daily 10am):</strong></p>
                <p>① Schedule Trigger (0 10 * * *) → ② HTTP GET <code className="code">/api/followup/run</code> → ③ Split fu1_due, fu2_due, fu3_due → ④ Loop each → ⑤ WhatsApp Message → ⑥ HTTP POST <code className="code">/api/followup/mark</code> (lead_id + fu_day)</p>
                <br/>
                <p><strong style={{color:'var(--text)'}}>Facebook Lead Ads n8n Setup:</strong></p>
                <p>n8n → Credentials → Facebook Lead Ads → Connect করো → Workflow এ "Facebook Lead Ads Trigger" node add করো → Page আর Form select করো</p>
              </div>
            </div>

            <div className="card" style={{marginTop:14}}>
              <div className="ct">🎯 Vercel Environment Variables</div>
              <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                <thead><tr><th style={{padding:'8px 12px',textAlign:'left',fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)',borderBottom:'1px solid var(--br)'}}>VARIABLE</th><th style={{padding:'8px 12px',textAlign:'left',fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)',borderBottom:'1px solid var(--br)'}}>VALUE</th></tr></thead>
                <tbody>
                  {[
                    ['NEXT_PUBLIC_SUPABASE_URL','https://xxx.supabase.co'],
                    ['NEXT_PUBLIC_SUPABASE_ANON_KEY','eyJ... (anon key)'],
                    ['SUPABASE_SERVICE_ROLE_KEY','eyJ... (service role)'],
                    ['WEBHOOK_SECRET','your-secret-key-here'],
                  ].map(([k,v])=>(
                    <tr key={k} style={{borderBottom:'1px solid var(--br)'}}>
                      <td style={{padding:'9px 12px',fontFamily:'var(--mono)',fontSize:12,color:'var(--accent)'}}>{k}</td>
                      <td style={{padding:'9px 12px',fontSize:12,color:'var(--t2)'}}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

        </div>
      </main>
    </div>

    {/* ADD MODAL */}
    {showAdd&&<Modal title="Add New Lead" onClose={()=>setShowAdd(false)}>
      <div className="fr2"><Field label="Name *"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Rahul Sharma"/></Field>
      <Field label="Phone *"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+91 9876543210"/></Field></div>
      <div className="fr2">
        <Field label="Source"><select value={form.source} onChange={e=>setForm({...form,source:e.target.value})}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Status"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Notes"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Lead details…" rows={3}/></Field>
      <div className="mfoot"><button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button><button className="btn bp" onClick={addLead}>Add Lead</button></div>
    </Modal>}

    {/* EDIT MODAL */}
    {editLead&&<Modal title={editLead.name} onClose={()=>setEditLead(null)}>
      <div className="fr2">
        <Field label="Name"><input defaultValue={editLead.name} id="en"/></Field>
        <Field label="Phone"><input defaultValue={editLead.phone} id="ep"/></Field>
      </div>
      <div className="fr2">
        <Field label="Source"><select defaultValue={editLead.source} id="esrc">{SOURCES.map(s=><option key={s}>{s}</option>)}</select></Field>
        <Field label="Status"><select defaultValue={editLead.status} id="est">{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Notes"><textarea defaultValue={editLead.notes} id="en2" rows={3}/></Field>
      <div className="tag-row">
        <span className="tag">Created: {editLead.created_at?.slice(0,10)}</span>
        <span className="tag" style={{color:editLead.fu1_sent?'var(--green)':'var(--t3)'}}>FU Day1: {editLead.fu1_sent?'✓':'Pending'}</span>
        <span className="tag" style={{color:editLead.fu2_sent?'var(--green)':'var(--t3)'}}>FU Day3: {editLead.fu2_sent?'✓':'Pending'}</span>
        <span className="tag" style={{color:editLead.fu3_sent?'var(--green)':'var(--t3)'}}>FU Day7: {editLead.fu3_sent?'✓':'Pending'}</span>
      </div>
      <div className="mfoot">
        <button className="btn br" onClick={()=>deleteLead(editLead.id)}>Delete</button>
        <button className="btn" onClick={()=>setEditLead(null)}>Cancel</button>
        <button className="btn bg" onClick={()=>updateLead(editLead.id,{name:document.getElementById('en').value,phone:document.getElementById('ep').value,source:document.getElementById('esrc').value,status:document.getElementById('est').value,notes:document.getElementById('en2').value})}>Save</button>
      </div>
    </Modal>}

    {notif&&<div className={`notif${notif.type==='err'?' nerr':''}`}><div className="ndot"/>  {notif.msg}</div>}

    <style jsx global>{`
      *{margin:0;padding:0;box-sizing:border-box}
      :root{
        --bg:#090c14;--bg2:#0d1120;--bg3:#111827;--bg4:#1a2234;--panel:#131b2e;
        --br:#1e2d45;--br2:#243450;--accent:#3b82f6;--a2:#60a5fa;
        --aglow:rgba(59,130,246,0.15);--green:#10b981;--amber:#f59e0b;
        --red:#ef4444;--purple:#a855f7;--cyan:#06b6d4;
        --text:#e2e8f0;--t2:#94a3b8;--t3:#475569;
        --sans:'DM Sans',sans-serif;--disp:'Syne',sans-serif;--mono:'DM Mono',monospace;
      }
      html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;overflow:hidden}
      .app{display:flex;height:100vh;overflow:hidden}
      .sidebar{width:220px;min-width:220px;background:var(--bg2);border-right:1px solid var(--br);display:flex;flex-direction:column}
      .logo-wrap{padding:20px 20px 16px;border-bottom:1px solid var(--br)}
      .logo{font-family:var(--disp);font-size:18px;font-weight:800;letter-spacing:-0.5px}
      .logo span{color:var(--accent)}
      .logo-sub{font-size:10px;color:var(--t3);font-family:var(--mono);margin-top:2px}
      .ni{display:flex;align-items:center;gap:10px;padding:9px 14px;margin:1px 8px;border-radius:8px;cursor:pointer;color:var(--t2);font-size:13px;font-weight:500;transition:all 0.15s;border:1px solid transparent;user-select:none}
      .ni:hover{background:var(--bg4);color:var(--text)}
      .ni.a{background:var(--aglow);color:var(--a2);border-color:rgba(59,130,246,0.2)}
      .nico{width:18px;text-align:center;flex-shrink:0;font-size:14px}
      .nbadge{margin-left:auto;background:var(--accent);color:white;font-size:10px;font-family:var(--mono);padding:2px 6px;border-radius:10px}
      .nbadge-warn{background:var(--amber)!important}
      .uav{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:white;font-family:var(--disp)}
      .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
      .topbar{height:56px;min-height:56px;background:var(--bg2);border-bottom:1px solid var(--br);display:flex;align-items:center;padding:0 24px;gap:12px}
      .topbar-title{font-family:var(--disp);font-size:15px;font-weight:700}
      .sbox{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--br);border-radius:7px;padding:6px 12px;width:200px}
      .sbox input{background:none;border:none;outline:none;color:var(--text);font-size:13px;width:100%}
      .sbox input::placeholder{color:var(--t3)}
      .content{flex:1;overflow-y:auto;padding:20px 24px}
      .content::-webkit-scrollbar{width:4px}
      .content::-webkit-scrollbar-thumb{background:var(--br2);border-radius:2px}
      .fi{animation:fi 0.2s ease}
      @keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      /* STATS */
      .sgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
      .scard{background:var(--panel);border:1px solid var(--br);border-radius:12px;padding:16px 18px;position:relative;overflow:hidden}
      .scard::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
      .scard.blue::before{background:var(--accent)}
      .scard.green::before{background:var(--green)}
      .scard.amber::before{background:var(--amber)}
      .scard.purple::before{background:var(--purple)}
      .scard.red::before{background:var(--red)}
      .slabel{font-size:11px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px}
      .snum{font-size:28px;font-weight:700;font-family:var(--disp);line-height:1}
      .ssub{font-size:11px;color:var(--t3);margin-top:5px}
      .sico{position:absolute;top:14px;right:14px;font-size:18px;opacity:0.4}
      /* CARDS */
      .twocol{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .card{background:var(--panel);border:1px solid var(--br);border-radius:12px;padding:18px}
      .card.p0{padding:0}
      .ct{font-family:var(--disp);font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px}
      .ct.mb0{margin-bottom:0}
      .card-hdr{display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid var(--br);gap:12px;flex-wrap:wrap}
      /* TABLE */
      .tbl{width:100%;border-collapse:collapse}
      .tbl thead th{padding:9px 16px;text-align:left;font-size:11px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--br);background:var(--bg3);font-weight:400}
      .tbl tbody tr{border-bottom:1px solid var(--br);transition:background 0.1s}
      .tbl tbody tr:hover{background:var(--bg4)}
      .tbl tbody tr:last-child{border-bottom:none}
      .tbl td{padding:11px 16px;font-size:13px}
      /* BADGES */
      .badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:500;font-family:var(--mono)}
      .bn{background:rgba(59,130,246,.15);color:#60a5fa}
      .bc{background:rgba(245,158,11,.12);color:#f59e0b}
      .bi{background:rgba(168,85,247,.12);color:#a855f7}
      .bd{background:rgba(6,182,212,.12);color:#06b6d4}
      .bw{background:rgba(16,185,129,.12);color:#10b981}
      .bl{background:rgba(239,68,68,.12);color:#ef4444}
      .sbadge{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:5px;font-size:11px;background:var(--bg4);border:1px solid var(--br2);color:var(--t2)}
      .sf{background:#1877f215;color:#60a5fa;border-color:#1877f230}
      .si{background:#e1306c15;color:#f472b6;border-color:#e1306c30}
      .sw{background:#25d36615;color:#4ade80;border-color:#25d36630}
      .swb{background:#f59e0b15;color:#fbbf24;border-color:#f59e0b30}
      .st{background:#0088cc15;color:#67e8f9;border-color:#0088cc30}
      .sfb{background:#e9711c20;color:#fb923c;border-color:#e9711c30}
      .sr{background:#a855f715;color:#c084fc;border-color:#a855f730}
      /* FILTER TABS */
      .ftabs{display:flex;gap:4px;flex-wrap:wrap}
      .ftab{padding:5px 10px;border-radius:6px;border:1px solid transparent;font-size:12px;cursor:pointer;color:var(--t2);background:none;transition:all 0.15s;font-family:var(--sans)}
      .ftab:hover{background:var(--bg4);color:var(--text)}
      .ftab.fa{background:var(--aglow);color:var(--a2);border-color:rgba(59,130,246,.25)}
      .ftab-cnt{background:var(--amber);color:#000;font-size:10px;font-family:var(--mono);padding:1px 5px;border-radius:8px;margin-left:4px}
      /* FOLLOW-UP */
      .fu-list{display:flex;flex-direction:column;gap:10px}
      .fu-card{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg3);border:1px solid var(--br);border-radius:10px;transition:background 0.1s}
      .fu-card:hover{background:var(--bg4)}
      .fu-left{display:flex;align-items:flex-start;gap:12px;flex:1}
      .fu-day-badge{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;font-family:var(--mono);white-space:nowrap}
      .fu-name{font-size:14px;font-weight:600;margin-bottom:3px}
      .fu-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px}
      .fu-preview{font-size:12px;color:var(--t3);max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fu-right{display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0}
      .fu-days{font-size:11px;font-family:var(--mono);color:var(--t3)}
      .fu-dot{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-family:var(--mono);color:white;font-weight:600}
      /* KANBAN */
      .kanban{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
      .kcol{background:var(--panel);border:1px solid var(--br);border-radius:12px;min-height:350px;display:flex;flex-direction:column}
      .kcol-h{padding:10px 12px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:6px}
      .cdot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
      .ctitle{font-size:10px;font-weight:600;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.04em;flex:1}
      .ccnt{background:var(--bg4);border:1px solid var(--br);border-radius:10px;font-size:10px;font-family:var(--mono);padding:1px 6px;color:var(--t2)}
      .kcards{padding:8px;display:flex;flex-direction:column;gap:7px;flex:1}
      .kcard{background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:10px 10px 10px 14px;cursor:pointer;transition:all 0.15s;position:relative;overflow:hidden}
      .kcard:hover{border-color:var(--br2);transform:translateY(-1px)}
      .kstripe{position:absolute;left:0;top:0;bottom:0;width:3px}
      .kname{font-size:12px;font-weight:600;margin-bottom:2px}
      .kphone{font-size:10px;font-family:var(--mono);color:var(--t3)}
      /* INBOX */
      .inbox{display:grid;grid-template-columns:300px 1fr;height:100%;border:1px solid var(--br);border-radius:12px;overflow:hidden}
      .ilist{border-right:1px solid var(--br);overflow-y:auto;background:var(--panel)}
      .ilist::-webkit-scrollbar{width:3px}
      .ilist::-webkit-scrollbar-thumb{background:var(--br2)}
      .iitem{padding:13px 15px;border-bottom:1px solid var(--br);cursor:pointer;transition:background 0.1s}
      .iitem:hover{background:var(--bg4)}
      .iitem.ia{background:var(--aglow);border-left:2px solid var(--accent)}
      .carea{background:var(--bg3);display:flex;flex-direction:column}
      .chead{padding:12px 18px;border-bottom:1px solid var(--br);background:var(--panel);display:flex;align-items:center;gap:12px}
      .cav{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--cyan));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white;flex-shrink:0}
      .cmsgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
      .cmsgs::-webkit-scrollbar{width:3px}
      .cmsgs::-webkit-scrollbar-thumb{background:var(--br2)}
      .mb{max-width:70%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.5}
      .mb.in{background:var(--panel);border:1px solid var(--br);align-self:flex-start;border-radius:4px 12px 12px 12px}
      .mb.out{background:var(--accent);color:white;align-self:flex-end;border-radius:12px 4px 12px 12px}
      .mm{font-size:10px;color:var(--t3);margin-top:3px}
      .mm.out{text-align:right;color:rgba(255,255,255,0.5)}
      .cinput{padding:12px 14px;border-top:1px solid var(--br);background:var(--panel);display:flex;gap:8px;align-items:flex-end}
      .ci{flex:1;background:var(--bg3);border:1px solid var(--br);border-radius:10px;padding:9px 13px;color:var(--text);font-size:13px;font-family:var(--sans);resize:none;min-height:38px;max-height:100px;outline:none}
      .ci:focus{border-color:var(--accent)}
      .sbtn{background:var(--accent);border:none;color:white;width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0}
      .sbtn:hover{background:#2563eb}
      /* MODAL */
      .moverlay{position:fixed;inset:0;background:rgba(9,12,20,.88);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center}
      .modal{background:var(--bg2);border:1px solid var(--br2);border-radius:16px;width:560px;max-height:88vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.6)}
      .modal::-webkit-scrollbar{width:4px}
      .modal::-webkit-scrollbar-thumb{background:var(--br2)}
      .mhead{padding:20px 24px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg2);z-index:2}
      .mtitle{font-family:var(--disp);font-size:16px;font-weight:700}
      .mclose{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;font-size:20px;padding:4px 6px}
      .mclose:hover{color:var(--text)}
      .mbody{padding:24px}
      .mfoot{display:flex;gap:10px;justify-content:flex-end;padding-top:16px;margin-top:8px;border-top:1px solid var(--br)}
      .fr2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .fg{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
      label{font-size:11px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:0.05em}
      input,select,textarea{background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;font-family:var(--sans);outline:none;transition:border 0.15s;width:100%}
      input:focus,select:focus,textarea:focus{border-color:var(--accent)}
      select option{background:var(--bg3)}
      textarea{resize:vertical}
      /* BUTTONS */
      .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:7px;border:1px solid var(--br2);background:var(--bg4);color:var(--text);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.15s;font-family:var(--sans)}
      .btn:hover{border-color:var(--accent);color:var(--a2)}
      .btn.sm{padding:4px 10px;font-size:11px}
      .btn.bp{background:var(--accent);border-color:var(--accent);color:white}
      .btn.bp:hover{background:#2563eb;color:white;border-color:#2563eb}
      .btn.bg{background:rgba(16,185,129,.1);border-color:var(--green);color:var(--green)}
      .btn.bg:hover{background:var(--green);color:white}
      .btn.br{background:rgba(239,68,68,.1);border-color:var(--red);color:var(--red)}
      /* SETTINGS */
      .wbox{font-family:var(--mono);font-size:12px;background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:10px 12px;color:var(--accent);word-break:break-all;margin-bottom:10px;line-height:1.5}
      .prebox{font-family:var(--mono);font-size:12px;background:var(--bg3);border:1px solid var(--br);border-radius:8px;padding:14px;color:var(--t2);line-height:1.7;white-space:pre-wrap;overflow-x:auto}
      .code{font-family:var(--mono);font-size:12px;background:var(--bg3);padding:2px 6px;border-radius:4px;border:1px solid var(--br)}
      .mini-select{background:var(--bg3);border:1px solid var(--br);border-radius:7px;padding:5px 10px;color:var(--text);font-size:12px;font-family:var(--sans);outline:none;cursor:pointer}
      /* MISC */
      .tag-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
      .tag{display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-family:var(--mono);background:var(--bg4);color:var(--t3);border:1px solid var(--br)}
      .ldot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
      .mono{font-family:var(--mono)}.sm{font-size:12px}.grey{color:var(--t3)}
      /* NOTIF */
      .notif{position:fixed;bottom:20px;right:20px;background:var(--bg2);border:1px solid var(--green);border-radius:10px;padding:12px 18px;font-size:13px;z-index:999;display:flex;align-items:center;gap:10px;max-width:340px;animation:su 0.3s ease;box-shadow:0 8px 32px rgba(0,0,0,.4)}
      .notif.nerr{border-color:var(--red)}
      .ndot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0}
      .notif.nerr .ndot{background:var(--red)}
      @keyframes su{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      ::-webkit-scrollbar{width:4px;height:4px}
      ::-webkit-scrollbar-track{background:transparent}
      ::-webkit-scrollbar-thumb{background:var(--br2);border-radius:2px}
      /* ── HAMBURGER ── */
      .ham{display:none;background:none;border:1px solid var(--br);border-radius:7px;color:var(--text);font-size:18px;padding:5px 10px;cursor:pointer;flex-shrink:0}
      /* ── MOBILE OVERLAY ── */
      .mob-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:49;backdrop-filter:blur(2px)}
      /* ── RESPONSIVE ── */
      @media(max-width:768px){
        html,body{overflow:auto}
        .app{flex-direction:column;height:auto;min-height:100vh}
        .sidebar{
          position:fixed;top:0;left:0;bottom:0;z-index:50;
          transform:translateX(-100%);transition:transform 0.25s ease;
          width:240px;min-width:240px;
        }
        .sidebar.open{transform:translateX(0)}
        .ham{display:flex}
        .main{flex:1;display:flex;flex-direction:column;min-height:100vh;overflow:auto}
        .topbar{height:52px;min-height:52px;padding:0 14px;gap:10px}
        .topbar-title{font-size:14px}
        .sbox{width:140px}
        .content{padding:14px 12px;overflow-y:visible}
        /* STATS GRID */
        .sgrid{grid-template-columns:repeat(2,1fr)!important;gap:10px}
        /* TWO COL → ONE COL */
        .twocol{grid-template-columns:1fr!important}
        /* KANBAN SCROLL */
        .kanban{grid-template-columns:repeat(6,220px)!important;overflow-x:auto;padding-bottom:8px}
        /* INBOX */
        .inbox{grid-template-columns:1fr!important;height:auto}
        .ilist{max-height:260px;border-right:none;border-bottom:1px solid var(--br)}
        .carea{min-height:400px}
        /* MODAL */
        .modal{width:calc(100vw - 24px)!important;max-height:90vh}
        .fr2{grid-template-columns:1fr!important}
        /* TABLE scroll */
        .tbl{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
        /* FOLLOW-UP */
        .fu-card{flex-direction:column!important;align-items:flex-start!important;gap:10px}
        .fu-right{flex-direction:row!important;flex-wrap:wrap;align-items:center!important;width:100%}
        /* BUTTONS */
        .card-hdr{flex-direction:column;align-items:flex-start!important}
        .card-hdr>div{flex-wrap:wrap}
        .ftabs{flex-wrap:wrap}
      }
      @media(max-width:480px){
        .sgrid{grid-template-columns:1fr!important}
        .topbar-title{display:none}
        .sbox{width:120px}
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
      <div style={{flex:1,background:'var(--bg4)',borderRadius:4,height:7,overflow:'hidden'}}>
        <div style={{width:`${val/max*100}%`,height:'100%',borderRadius:4,background:color,transition:'width 0.7s cubic-bezier(.4,0,.2,1)'}}/>
      </div>
      <div style={{fontSize:11,fontFamily:'var(--mono)',color:'var(--t3)',width:24,textAlign:'right',flexShrink:0}}>{val}</div>
    </div>
  ))}</div>)
}
function Field({label,children}){return <div className="fg"><label>{label}</label>{children}</div>}
function Emp({icon,text}){return <div style={{textAlign:'center',padding:'36px 20px',color:'var(--t3)'}}><div style={{fontSize:28,marginBottom:8,opacity:0.5}}>{icon}</div><div style={{fontSize:13}}>{text}</div></div>}
function Modal({title,onClose,children}){return(
  <div className="moverlay" onClick={e=>{if(e.target.classList.contains('moverlay'))onClose()}}>
    <div className="modal">
      <div className="mhead"><div className="mtitle">{title}</div><button className="mclose" onClick={onClose}>✕</button></div>
      <div className="mbody">{children}</div>
    </div>
  </div>
)}
