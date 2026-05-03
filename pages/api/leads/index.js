// pages/api/leads/index.js  (UPGRADED)
// GET: fetch all leads (with filter by tag, niche, score)
// POST: manual add from CRM UI (unchanged UX)

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()

  // ── GET: List leads ──────────────────────────────────────
  if (req.method === 'GET') {
    const { tag, niche, min_score, source, status } = req.query

    let q = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    // Optional filters
    if (status)    q = q.eq('status', status)
    if (source)    q = q.eq('source', source)
    if (niche)     q = q.ilike('niche', `%${niche}%`)
    if (min_score) q = q.gte('score', parseInt(min_score))
    if (tag)       q = q.contains('tags', [tag.toLowerCase()])  // array contains

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  // ── POST: Add lead manually from UI ─────────────────────
  if (req.method === 'POST') {
    const { name, phone, email, source, status, notes, niche, tags } = req.body

    if (!name?.trim()) return res.status(400).json({ error: 'name required' })
    if (!phone?.trim() && !email?.trim()) return res.status(400).json({ error: 'phone or email required' })

    // Normalize tags
    let normalizedTags = []
    if (Array.isArray(tags)) {
      normalizedTags = tags.map(t => t.toString().toLowerCase().trim()).filter(Boolean)
    } else if (typeof tags === 'string' && tags.trim()) {
      normalizedTags = tags.split(',').map(t => t.toLowerCase().trim()).filter(Boolean)
    }

    const { data, error } = await supabase
      .from('leads')
      .insert([{
        name:         name.trim(),
        phone:        phone?.trim() || null,
        email:        email?.trim() || null,
        source:       source || 'Manual',
        status:       status || 'New Lead',
        notes:        notes || '',
        niche:        niche?.trim() || null,
        tags:         normalizedTags,
        score:        0, // manual leads start at 0 (can be edited)
        last_contact: new Date().toISOString().slice(0, 10),
      }])
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
