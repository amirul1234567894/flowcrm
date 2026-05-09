// pages/api/analytics.js — Advanced Analytics API
//
// PERFORMANCE FIX:
//   পুরোনো version Promise.all-এ ৩টা full-table query চালাত (3 × 17k rows from Supabase).
//   এখন একবার full table fetch করে সব calc memory-তে — Supabase egress ১/৩ হয়ে যাবে.

import { getServiceClient } from '../../lib/supabase'

const ANALYTICS_COLUMNS = 'id,status,score,source,niche,created_at,priority,fu1_sent,fu2_sent,fu3_sent,day1_sent,day3_sent,day7_sent,email_sequence_status'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  // Cache for 60s — analytics doesn't need real-time precision
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')

  const supabase = getServiceClient()
  const { range = '30' } = req.query
  const days = parseInt(range)
  const sinceMs = Date.now() - days * 86400000

  try {
    // Single query — fetch all leads with only the columns we need
    const { data, error } = await supabase
      .from('leads')
      .select(ANALYTICS_COLUMNS)
      .limit(50000)
    if (error) return res.status(500).json({ error: error.message })

    const all = data || []
    // Recent slice computed in-memory (avoids 2nd round-trip)
    const recent = all.filter(l => l.created_at && new Date(l.created_at).getTime() >= sinceMs)
    const funnel = all   // funnel uses the same dataset

    // ── Status distribution
    const statusDist = {}
    all.forEach(l => { statusDist[l.status||'Unknown'] = (statusDist[l.status||'Unknown']||0)+1 })

    // ── Source breakdown (recent)
    const sourceDist = {}
    recent.forEach(l => { sourceDist[l.source||'Unknown'] = (sourceDist[l.source||'Unknown']||0)+1 })

    // ── Niche breakdown
    const nicheDist = {}
    recent.forEach(l => { if(l.niche) nicheDist[l.niche] = (nicheDist[l.niche]||0)+1 })

    // ── Score distribution
    const scoreRanges = { 'Hot (80-100)':0, 'Warm (60-79)':0, 'Medium (40-59)':0, 'Cold (0-39)':0 }
    all.forEach(l => {
      const s = l.score || 0
      if (s>=80) scoreRanges['Hot (80-100)']++
      else if (s>=60) scoreRanges['Warm (60-79)']++
      else if (s>=40) scoreRanges['Medium (40-59)']++
      else scoreRanges['Cold (0-39)']++
    })

    // ── Daily lead count (last 14 days)
    const dailyCounts = {}
    const today = new Date()
    for (let i=13; i>=0; i--) {
      const d = new Date(today - i*86400000).toISOString().slice(0,10)
      dailyCounts[d] = 0
    }
    all.forEach(l => {
      const d = l.created_at?.slice(0,10)
      if (d && dailyCounts[d] !== undefined) dailyCounts[d]++
    })

    // ── Follow-up funnel
    const funnelData = {
      total: all.length,
      contacted:  all.filter(l=>l.status==='Contacted').length,
      interested: all.filter(l=>l.status==='Interested').length,
      demo:       all.filter(l=>l.status==='Demo Booked').length,
      won:        all.filter(l=>l.status==='Closed Won').length,
      d1Sent:     funnel.filter(l=>l.day1_sent||l.fu1_sent).length,
      d3Sent:     funnel.filter(l=>l.day3_sent||l.fu2_sent).length,
      d7Sent:     funnel.filter(l=>l.day7_sent||l.fu3_sent).length,
      completed:  funnel.filter(l=>l.email_sequence_status==='completed').length,
    }

    // ── Priority breakdown
    const priorityDist = { high:0, medium:0, low:0 }
    all.forEach(l => { if(l.priority) priorityDist[l.priority] = (priorityDist[l.priority]||0)+1 })

    return res.status(200).json({
      summary: {
        total: all.length,
        recent: recent.length,
        won: all.filter(l=>l.status==='Closed Won').length,
        conversionRate: all.length>0 ? ((all.filter(l=>l.status==='Closed Won').length/all.length)*100).toFixed(1) : 0,
        avgScore: all.length>0 ? Math.round(all.reduce((s,l)=>s+(l.score||0),0)/all.length) : 0,
        hotLeads: all.filter(l=>(l.score||0)>=75).length,
      },
      statusDist,
      sourceDist,
      nicheDist,
      scoreRanges,
      dailyCounts,
      funnelData,
      priorityDist,
    })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
