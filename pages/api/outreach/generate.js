// pages/api/outreach/generate.js
// === Layer 3: AI-Powered All-Niche Outreach Generator ===
//
// Daily cron (n8n) ekhane call kore — picks top N leads by score (any niche),
// generates AI-personalized message for each using Groq, stores in outreach_queue.
//
// === STRATEGY (v3 - 2026 update) ===
// Previously locked to 4 niches (clinic/gym/salon/restaurant) with hardcoded
// templates. Now:
//   1. Pulls top-scored leads from ALL niches (uses leadScoring.js scores)
//   2. AI generates personalized message per-lead via Groq API
//   3. Fallback templates kick in if AI fails (no broken pipeline)
//   4. Configurable daily limit via env (DAILY_OUTREACH_LIMIT, default 12)
//
// IMPORTANT: Groq API key (GROQ_API_KEY) is required for AI generation.
// Without it, falls back to generic templates (still better than v1).

import { getServiceClient } from '../../../lib/supabase'
import { generateMessagesForLeads } from '../../../lib/aiPersonalizer'

function normalizePhone(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : digits
}

function isLikelyValidWhatsAppNumber(phone) {
  const digits = normalizePhone(phone)
  if (!digits || digits.length < 10) return false
  if (digits.length > 15) return false
  if (!/^[6-9]/.test(digits)) return false
  if (/^(\d)\1{9}$/.test(digits)) return false
  const exactJunk = new Set([
    '0000000000','1111111111','2222222222','3333333333','4444444444',
    '5555555555','6666666666','7777777777','8888888888','9999999999',
    '1234567890','9876543210','0123456789'
  ])
  if (exactJunk.has(digits)) return false
  return true
}

// Reject leads whose 'niche' field looks like a non-business (e.g. test data,
// automation projects, students, developers). These are usually leads about
// AutoFlowa itself, not actual customer-businesses.
function shouldRejectLead(lead) {
  const niche = (lead.niche || '').toLowerCase()
  const REJECT_KEYWORDS = ['automation', 'developer', 'student', 'system', 'software',
                           'app', 'project', 'test', 'demo', 'sample']
  return REJECT_KEYWORDS.some(k => niche.includes(k))
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Cron-from-n8n secret check
  const secret = req.headers['x-webhook-secret']
  const isFromBrowser = (req.headers['user-agent'] || '').includes('Mozilla')
  if (!isFromBrowser && process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getServiceClient()
  const today = new Date().toISOString().slice(0,10)

  // === DAILY LIMIT (env-configurable) ===
  // Default 12/day. Increase carefully — Groq free tier = 14,400 req/day,
  // but you also need WhatsApp send capacity manually.
  const DAILY_LIMIT = parseInt(process.env.DAILY_OUTREACH_LIMIT || '12', 10)

  try {
    // 1. Idempotent check — skip if pending msgs already exist for today
    const { count: pendingCount } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('scheduled_for', today)
      .eq('status', 'pending')

    if (pendingCount && pendingCount > 0) {
      const { count: totalCount } = await supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_for', today)
      return res.status(200).json({
        success: true,
        skipped: true,
        message: `${pendingCount} pending messages already queued. Send/skip them first, then re-generate.`,
        count: totalCount || 0,
        pending: pendingCount,
        date: today,
      })
    }

    // 2. Build phone exclusion list (DUPLICATE PREVENTION)
    //    Excludes phones that have ever been queued OR
    //    whose lead status is beyond 'New Lead'.
    const { data: queuedPhones } = await supabase
      .from('outreach_queue')
      .select('lead_phone')
    const queuedPhoneSet = new Set(
      (queuedPhones || []).map(r => normalizePhone(r.lead_phone))
    )

    const { data: contactedLeads } = await supabase
      .from('leads')
      .select('phone')
      .not('phone', 'is', null)
      .neq('phone', '')
      .neq('status', 'New Lead')
    const contactedPhoneSet = new Set(
      (contactedLeads || []).map(r => normalizePhone(r.phone))
    )

    const excludedPhones = new Set([...queuedPhoneSet, ...contactedPhoneSet])

    // 3. Fetch top-scored candidate leads from ALL niches
    //    Fetch more than DAILY_LIMIT to account for invalid phones, dupes, rejects
    const FETCH_MULTIPLIER = 30  // fetch 30x the limit as candidate pool
    const { data: candidates, error: fetchErr } = await supabase
      .from('leads')
      .select('id,name,phone,niche,notes,tags,score,status,source,created_at')
      .not('phone', 'is', null)
      .neq('phone', '')
      .is('outreach_attempted_at', null)
      .eq('status', 'New Lead')
      .order('score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(DAILY_LIMIT * FETCH_MULTIPLIER)

    if (fetchErr) return res.status(500).json({ error: fetchErr.message })

    // 4. Filter candidates: valid phone, no rejects, no dupes within batch
    const selectedLeads = []
    const invalidPhoneLeadIds = []
    const usedPhonesInBatch = new Set()

    for (const lead of candidates || []) {
      if (selectedLeads.length >= DAILY_LIMIT) break

      // Reject test/automation/system entries
      if (shouldRejectLead(lead)) continue

      const phone = normalizePhone(lead.phone)
      if (!phone) continue

      // Invalid phone → mark to skip permanently
      if (!isLikelyValidWhatsAppNumber(lead.phone)) {
        invalidPhoneLeadIds.push(lead.id)
        continue
      }

      // Already contacted/queued
      if (excludedPhones.has(phone)) continue
      if (usedPhonesInBatch.has(phone)) continue

      selectedLeads.push(lead)
      usedPhonesInBatch.add(phone)
    }

    // Mark invalid phones as attempted (so we never re-pick them)
    if (invalidPhoneLeadIds.length > 0) {
      await supabase
        .from('leads')
        .update({ outreach_attempted_at: new Date().toISOString() })
        .in('id', invalidPhoneLeadIds)
    }

    if (selectedLeads.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: 'No valid leads available for outreach today',
        invalidPhonesSkipped: invalidPhoneLeadIds.length,
      })
    }

    // 5. AI-generate personalized messages (with concurrency + fallback)
    //    Returns array: [{ leadId, message, source: 'ai'|'fallback', error? }]
    const aiResults = await generateMessagesForLeads(selectedLeads, {
      batchSize: 5,
      delayMs: 2000,  // 2s between batches → safely under 30 req/min
    })

    // Map results back to leads
    const resultByLeadId = new Map(aiResults.map(r => [r.leadId, r]))

    // 6. Build queue rows with generated messages
    const queueRows = []
    let aiCount = 0
    let fallbackCount = 0

    for (const lead of selectedLeads) {
      const result = resultByLeadId.get(lead.id)
      if (!result) continue   // shouldn't happen, but safety

      if (result.source === 'ai') aiCount++
      else fallbackCount++

      queueRows.push({
        lead_id:       lead.id,
        lead_name:     lead.name || 'there',
        lead_phone:    lead.phone,
        niche:         lead.niche || null,
        message:       result.message,
        status:        'pending',
        scheduled_for: today,
      })
    }

    if (queueRows.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: 'Message generation failed for all leads',
      })
    }

    // 7. Insert into queue
    const { error: insertErr } = await supabase
      .from('outreach_queue')
      .insert(queueRows)
    if (insertErr) return res.status(500).json({ error: insertErr.message })

    // 8. Mark leads as attempted
    const leadIds = queueRows.map(r => r.lead_id)
    await supabase
      .from('leads')
      .update({ outreach_attempted_at: new Date().toISOString() })
      .in('id', leadIds)

    return res.status(200).json({
      success: true,
      count: queueRows.length,
      date: today,
      generation: {
        ai_generated: aiCount,
        fallback_used: fallbackCount,
      },
      invalidPhonesSkipped: invalidPhoneLeadIds.length,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
