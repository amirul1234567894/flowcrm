// ============================================================
// POST /api/intake/leads
// Universal Lead Intake API
// Sources: Google Maps scraper, n8n, bots, forms, ads, etc.
// ============================================================

import { getServiceClient } from '../../../lib/supabase'
import { validateApiKey } from '../../../lib/auth'
import { scoreLeadData } from '../../../lib/leadScoring'
import { logIntake } from '../../../lib/intakeLogger'

export default async function handler(req, res) {
  // ── Only allow POST ──────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' })
  }

  // ── API Key Authentication ───────────────────────────────
  const apiKeyError = validateApiKey(req)
  if (apiKeyError) return res.status(401).json({ success: false, error: apiKeyError })

  // ── Parse & Validate Body ────────────────────────────────
  const {
    name,
    phone,
    email,
    website,
    source,
    niche,
    status,
    notes,
    tags,          // array e.g. ["hot", "gym", "dhaka"]
    score_override // optional manual score (0-100)
  } = req.body

  // Required: name
  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'name is required' })
  }

  // At least one contact method
  if (!phone?.trim() && !email?.trim()) {
    return res.status(400).json({ success: false, error: 'At least phone or email is required' })
  }

  // Phone format: basic check (digits, spaces, +, -)
  if (phone && !/^[\d\s\+\-\(\)]{7,20}$/.test(phone.trim())) {
    return res.status(400).json({ success: false, error: 'Invalid phone format' })
  }

  // Email format
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ success: false, error: 'Invalid email format' })
  }

  const supabase = getServiceClient()

  // ── Duplicate Detection ──────────────────────────────────
  // Check by phone OR email (whichever is provided)
  const orFilters = []
  if (phone?.trim()) orFilters.push(`phone.eq.${phone.trim()}`)
  if (email?.trim()) orFilters.push(`email.eq.${email.trim()}`)

  const { data: existing } = await supabase
    .from('leads')
    .select('id, name, source, created_at')
    .or(orFilters.join(','))
    .limit(1)
    .maybeSingle()

  if (existing) {
    await logIntake({ status: 'duplicate', body: req.body, existing_id: existing.id })
    return res.status(200).json({
      success: false,
      duplicate: true,
      message: 'Lead already exists',
      existing_id: existing.id,
    })
  }

  // ── Lead Scoring ─────────────────────────────────────────
  const score = score_override ?? scoreLeadData({ name, phone, email, website, source, niche })

  // ── Normalize Tags ───────────────────────────────────────
  // Accept array or comma-separated string
  let normalizedTags = []
  if (Array.isArray(tags)) {
    normalizedTags = tags.map(t => t.toString().toLowerCase().trim()).filter(Boolean)
  } else if (typeof tags === 'string' && tags.trim()) {
    normalizedTags = tags.split(',').map(t => t.toLowerCase().trim()).filter(Boolean)
  }
  // Auto-add niche as tag if provided
  if (niche?.trim() && !normalizedTags.includes(niche.toLowerCase().trim())) {
    normalizedTags.push(niche.toLowerCase().trim())
  }
  // Auto-add source as tag
  if (source?.trim() && !normalizedTags.includes(source.toLowerCase().replace(/\s+/g, '_'))) {
    normalizedTags.push(source.toLowerCase().replace(/\s+/g, '_'))
  }

  // ── Insert Lead ──────────────────────────────────────────
  const { data: lead, error } = await supabase
    .from('leads')
    .insert([{
      name:         name.trim(),
      phone:        phone?.trim() || null,
      email:        email?.trim() || null,
      website:      website?.trim() || null,
      source:       source?.trim() || 'api',
      niche:        niche?.trim() || null,
      status:       status?.trim() || 'New Lead',
      notes:        notes?.trim() || null,
      tags:         normalizedTags,
      score:        score,
      last_contact: new Date().toISOString().slice(0, 10),
    }])
    .select()
    .single()

  if (error) {
    await logIntake({ status: 'error', body: req.body, error: error.message })
    console.error('[INTAKE] Insert error:', error)
    return res.status(500).json({ success: false, error: 'Database error: ' + error.message })
  }

  // ── Log Success ──────────────────────────────────────────
  await logIntake({ status: 'success', body: req.body, lead_id: lead.id })

  // ── Return ───────────────────────────────────────────────
  return res.status(201).json({
    success: true,
    message: 'Lead created successfully',
    lead: {
      id:      lead.id,
      name:    lead.name,
      phone:   lead.phone,
      email:   lead.email,
      source:  lead.source,
      niche:   lead.niche,
      status:  lead.status,
      score:   lead.score,
      tags:    lead.tags,
      created_at: lead.created_at,
    }
  })
}
