// pages/api/ai/score-lead.js — Re-score a lead using Groq (free & fast)
import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { lead_id } = req.body
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' })

  const supabase = getServiceClient()
  const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).single()
  if (!lead) return res.status(404).json({ error: 'Lead not found' })

  const GROQ_KEY = process.env.GROQ_API_KEY
  let score = 50, grade = 'Medium', reason = 'Standard lead', priority = 'medium'

  if (GROQ_KEY) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens: 150,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `Score this lead 0-100 for an automation agency. Return ONLY JSON: {"score":integer,"grade":"Hot/Warm/Medium/Cold","reason":"one sentence","priority":"high/medium/low"}.
Lead: Name=${lead.name}, Email=${lead.email||'none'}, Phone=${lead.phone||'none'}, Niche=${lead.niche||'unknown'}, Source=${lead.source||'unknown'}, Status=${lead.status}, Notes=${lead.notes||'none'}`
          }]
        })
      })
      const d = await resp.json()
      const p = JSON.parse(d.choices?.[0]?.message?.content || '{}')
      score = Math.min(100, Math.max(0, parseInt(p.score)||50))
      grade = p.grade || grade; reason = p.reason || reason; priority = p.priority || priority
    } catch(e) {
      // Fallback scoring
      let s = 20
      if (lead.name)  s += 10
      if (lead.phone) s += 20
      if (lead.email) s += 15
      if (lead.niche) s += 10
      const hvn = ['hospital','clinic','law','real estate','it','school','hotel','gym']
      if (lead.niche && hvn.some(n => lead.niche.toLowerCase().includes(n))) s += 15
      score = Math.min(100, s)
      grade = score>=75?'Hot':score>=55?'Warm':score>=35?'Medium':'Cold'
      priority = score>=75?'high':score>=45?'medium':'low'
    }
  }

  await supabase.from('leads').update({ score, ai_grade: grade, ai_reason: reason, priority }).eq('id', lead_id)
  return res.status(200).json({ score, grade, reason, priority })
}
