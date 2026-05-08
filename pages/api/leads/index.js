// pages/api/leads/index.js  (PERFORMANCE OPTIMIZED)
// GET: fetch leads with pagination (default 200 per page, only needed columns)
// POST: manual add from CRM UI

import { getServiceClient } from '../../../lib/supabase'

// Only fetch columns actually used in the CRM UI — avoids pulling heavy unused fields
const LEAD_COLUMNS = 'id,name,phone,email,source,status,niche,notes,tags,score,created_at,last_contact,fu1_sent,fu2_sent,fu3_sent,fu1_sent_at,fu2_sent_at,fu3_sent_at,day1_sent,day3_sent,day7_sent,email_sequence_status,updated_at'

export default async function handler(req, res) {
  const supabase = getServiceClient()

  // Cache headers — allow CDN/browser to cache for 10s (data is fetched every 30s anyway)
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20')

  // ── GET: List leads ──────────────────────────────────────
  if (req.method === 'GET') {
    const { tag, niche, min_score, source, status, page, limit } = req.query

    // Reduced default page size from 2000 → 500 for faster mobile loads
    const pageSize = Math.min(parseInt(limit) || 500, 1000)
    const pageNum  = parseInt(page) || 1
    const from     = (pageNum - 1) * pageSize
    const to       = from + pageSize - 1

    let q = supabase
      .from('leads')
      .select(LEAD_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    // Optional filters
    if (status)    q = q.eq('status', status)
    if (source)    q = q.eq('source', source)
    if (niche)     q = q.ilike('niche', `%${niche}%`)
    if (min_score) q = q.gte('score', parseInt(min_score))
    if (tag)       q = q.contains('tags', [tag.toLowerCase()])

    const { data, error, count } = await q
    if (error) return res.status(500).json({ error: error.message })

    // Return data + total count so frontend can paginate properly
    return res.status(200).json({ data: data || [], count: count || 0, page: pageNum, pageSize })
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
