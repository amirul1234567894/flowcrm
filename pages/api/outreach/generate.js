// pages/api/outreach/generate.js
// === Layer 3: AI-Powered Outreach Generator ===
//
// Daily cron (n8n) ekhane call kore â€” picks top N leads by score,
// generates AI-personalized message for each using Groq, stores in outreach_queue.
//
// === STRATEGY (v4 - 2026 update) ===
//   ONLY two niches now:
//     1. clinic       -> PRIORITY 1 (main focus)
//     2. real estate  -> PRIORITY 2
//   All other niches are ignored. Round-robin picks clinic first each round,
//   then real estate, so clinic always fills up before real estate.
//
// NOTE: This file ONLY builds the draft queue. It does NOT send anything.
//       Actual sending happens in pages/api/whatsapp/send.js. As long as you
//       don't trigger that send endpoint/cron, no message goes out to anyone.

import { getServiceClient } from '../../../lib/supabase'
import { generateMessagesForLeads } from '../../../lib/aiPersonalizer'
import { phoneKey, isValidWhatsAppNumber } from '../../../lib/phone'

// === NICHE CONFIG (single source of truth) ===
// Only these niches are allowed. Order = priority (first = highest).
// Both spellings of real estate are covered so nothing slips through.
const ALLOWED_NICHES = ['clinic', 'real estate', 'real_estate']
const PRIORITY = ['clinic', 'real estate', 'real_estate']

// Reject leads whose 'niche' field looks like a non-business (test data,
// automation projects, students, developers).
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
  const DAILY_LIMIT = parseInt(process.env.DAILY_OUTREACH_LIMIT || '12', 10)

  try {
    // 1. Idempotent check â€” skip if pending msgs already exist for today
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
    const { data: queuedPhones } = await supabase
      .from('outreach_queue')
      .select('lead_phone')
    const queuedPhoneSet = new Set(
      (queuedPhones || []).map(r => phoneKey(r.lead_phone))
    )

    const { data: contactedLeads } = await supabase
      .from('leads')
      .select('phone')
      .not('phone', 'is', null)
      .neq('phone', '')
      .neq('status', 'New Lead')
    const contactedPhoneSet = new Set(
      (contactedLeads || []).map(r => phoneKey(r.phone))
    )

    const excludedPhones = new Set([...queuedPhoneSet, ...contactedPhoneSet])

    // 3. Fetch eligible leads PER NICHE â€” locked to ALLOWED_NICHES only.
    //    No auto-discovery, so no other niche can leak in.
    const allNiches = [...ALLOWED_NICHES]

    const PER_NICHE = Math.max(DAILY_LIMIT * 50, 600)
    const rawByNiche = {}
    await Promise.all(allNiches.map(async (niche) => {
      const { data: rows } = await supabase
        .from('leads')
        .select('id,name,phone,niche,notes,tags,score,status,source,created_at')
        .is('outreach_attempted_at', null)
        .eq('status', 'New Lead')
        .not('phone', 'is', null)
        .neq('phone', '')
        .eq('niche', niche)
        .order('score', { ascending: false })
        .limit(PER_NICHE)
      if (rows && rows.length) rawByNiche[niche] = rows
    }))

    // 4. Filter (dedupe / invalid / already-contacted) while keeping niche groups
    const candidatesByNiche = {}
    const invalidPhoneLeadIds = []
    const usedPhonesInBatch = new Set()

    for (const niche of Object.keys(rawByNiche)) {
      for (const lead of rawByNiche[niche]) {
        if (shouldRejectLead(lead)) continue

        const phone = phoneKey(lead.phone)
        if (!phone) continue

        if (!isValidWhatsAppNumber(lead.phone)) {
          invalidPhoneLeadIds.push(lead.id)
          continue
        }

        if (excludedPhones.has(phone)) continue
        if (usedPhonesInBatch.has(phone)) continue

        const nicheKey = (lead.niche || 'other').toLowerCase().trim()
        // Extra guard: only keep allowed niches
        if (!ALLOWED_NICHES.includes(nicheKey)) continue

        if (!candidatesByNiche[nicheKey]) candidatesByNiche[nicheKey] = []
        candidatesByNiche[nicheKey].push(lead)
        usedPhonesInBatch.add(phone)
      }
    }

    // Within each niche, higher-scored leads first
    for (const k of Object.keys(candidatesByNiche)) {
      candidatesByNiche[k].sort((a, b) => (b.score || 0) - (a.score || 0))
    }

    // 5. Round-robin pick â€” but ORDERED by priority (clinic first, real estate second)
    const selectedLeads = []
    const nicheKeys = Object.keys(candidatesByNiche).sort((a, b) => {
      const ia = PRIORITY.indexOf(a); const ib = PRIORITY.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    const nicheIndexes = {}
    nicheKeys.forEach(k => { nicheIndexes[k] = 0 })

    while (selectedLeads.length < DAILY_LIMIT) {
      let pickedThisRound = 0
      for (const niche of nicheKeys) {
        if (selectedLeads.length >= DAILY_LIMIT) break
        const idx = nicheIndexes[niche]
        if (idx < candidatesByNiche[niche].length) {
          selectedLeads.push(candidatesByNiche[niche][idx])
          nicheIndexes[niche]++
          pickedThisRound++
        }
      }
      if (pickedThisRound === 0) break
    }

    // Mark invalid phones as attempted
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
        message: 'No valid clinic/real-estate leads available for outreach today',
        invalidPhonesSkipped: invalidPhoneLeadIds.length,
      })
    }

    // 6. AI-generate personalized messages (with concurrency + fallback)
    const aiResults = await generateMessagesForLeads(selectedLeads, {
      batchSize: 5,
      delayMs: 2000,
    })

    const resultByLeadId = new Map(aiResults.map(r => [r.leadId, r]))

    // 7. Build queue rows
    const queueRows = []
    let aiCount = 0
    let fallbackCount = 0

    for (const lead of selectedLeads) {
      const result = resultByLeadId.get(lead.id)
      if (!result) continue

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

    // 8. Insert into queue
    const { error: insertErr } = await supabase
      .from('outreach_queue')
      .insert(queueRows)
    if (insertErr) return res.status(500).json({ error: insertErr.message })

    // 9. Mark leads as attempted
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
