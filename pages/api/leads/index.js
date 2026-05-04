// pages/api/leads/index.js  (UPGRADED)
// GET: fetch all leads (with filter by tag, niche, score)
// POST: manual add from CRM UI (unchanged UX)

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()

  // ── GET: List leads ──────────────────────────────────────
  if (req.method === 'GET') {
    const { tag, niche, min_score, source, status, page, limit } = req.query

    const pageSize = parseInt(limit) || 2000
    const pageNum  = parseInt(page)  || 1
    const from     = (pageNum - 1) * pageSize
    const to       = from + pageSize - 1

    let q = supabase
      .from('leads')
      .select('*', { count: 'exact' })
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

    // If no pagination param — fetch ALL pages automatically
    if (!page && count > pageSize) {
      let allData = [...data]
      let nextFrom = pageSize
      while (nextFrom < count) {
        let q2 = supabase
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false })
          .range(nextFrom, nextFrom + pageSize - 1)
        if (status)    q2 = q2.eq('status', status)
        if (source)    q2 = q2.eq('source', source)
        if (niche)     q2 = q2.ilike('niche', `%${niche}%`)
        if (min_score) q2 = q2.gte('score', parseInt(min_score))
        if (tag)       q2 = q2.contains('tags', [tag.toLowerCase()])
        const { data: moreData } = await q2
        if (!moreData?.length) break
        allData = [...allData, ...moreData]
        nextFrom += pageSize
      }
      return res.status(200).json(allData)
    }

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
