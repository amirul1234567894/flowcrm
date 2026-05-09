// pages/api/outreach/generate.js
// Daily cron (n8n) ekhane call kore — auto-picks 3 best leads per niche,
// generates personalized message for each, stores in outreach_queue table.
//
// Niche detection: matches lead.niche (case-insensitive) against keyword sets.
// Smart pick: highest score, never picked before, has phone number.

import { getServiceClient } from '../../../lib/supabase'

// Niche keyword matchers — covers common business name patterns
// Word-boundary matched (whole word only), case-insensitive
const NICHE_KEYWORDS = {
  gym:        ['gym','gyms','fitness','crossfit','workout','akhara','bodybuilding'],
  salon:      ['salon','salons','parlor','parlour','beauty','makeup','spa','barber','unisex'],
  clinic:     ['clinic','clinics','hospital','dental','dentist','physio','diagnostic','dermatology','derma','skin','laser'],
  restaurant: ['restaurant','restaurants','cafe','dhaba','biriyani','restro','catering','bakery','pizzeria','pizza','burger'],
}

// Normalize phone to digits only — last 10 digits = canonical form
// "+91 9876543210" / "+919876543210" / "9876543210" / "(91) 98765-43210" all → "9876543210"
// This way duplicate-phone detection works regardless of formatting variation.
function normalizePhone(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')   // keep only 0-9
  // For Indian numbers, keep last 10 digits (drops country code variations)
  return digits.length >= 10 ? digits.slice(-10) : digits
}

// Per-niche message templates
// Designed for: WhatsApp Business App (manual send by user)
// Strategy: Universal English (works PAN-India) + casual friendly tone + language-switch CTA
// Brand: AutoFlowa — https://www.autoflowa.in/
const TEMPLATES = {
  gym: (l, site) => `Hi${l.name?' '+l.name:''}! 👋

Saw your gym's page — really impressive setup! 💪

Quick question — do you send renewal reminders, missed-class follow-ups, and special offers to members manually, or is there an automation handling it?

I run AutoFlowa — we build WhatsApp automation specifically for gyms:

✅ Auto welcome message when someone joins
✅ "Miss you" reminder if they skip 7 days
✅ Renewal reminder 3 days before expiry
✅ Birthday wishes + personal offer

One of our gym clients saw 38% more renewals after setup.

Want a 5-min demo? Check it out:
${site}

No cost, no commitment — just take a look 🙂

_Prefer Hindi or Bangla? Reply "H" or "B" — happy to switch!_`,

  salon: (l, site) => `Hi${l.name?' '+l.name:''}! ✨

Your salon's work looks beautiful — really love the aesthetic!

I wanted to share a system AutoFlowa built specifically for salons. It automatically handles:

✅ Thank-you message after first visit
✅ Appointment reminders (24hr + 2hr before)
✅ Birthday wishes with special offer
✅ "We miss you" message after 30 days
✅ Festival promo broadcasts

A recent salon client got 47 extra bookings/month from auto-reminders alone.

5-min demo here:
${site}

Free demo, zero obligation — just take a look 🙂

_Prefer Hindi or Bangla? Reply "H" or "B" — happy to switch!_`,

  clinic: (l, site) => `Hi${l.name?' '+l.name:''}! 👋

Came across your clinic and wanted to reach out.

Quick question — do you handle appointment confirmations, follow-up reminders, and prescription notifications manually, or is it automated?

At AutoFlowa we build WhatsApp automation for clinics:

✅ Auto appointment confirmation
✅ 24hr reminder (cuts missed appointments by 60%)
✅ Follow-up day reminders
✅ New patient onboarding flow

Patient data secure, all communication private.

Demo + pricing here:
${site}

Free demo, no obligation 🙂

_Prefer Hindi or Bangla? Reply "H" or "B" — happy to switch!_`,

  restaurant: (l, site) => `Hi${l.name?' '+l.name:''}! 👋

Your restaurant's menu looks amazing — got me hungry just looking! 😄

On a serious note — do you send order confirmations, delivery updates, weekly offers, and birthday discounts to customers via WhatsApp?

AutoFlowa builds restaurant-specific automation:

✅ Auto order confirmation
✅ Delivery status updates
✅ "Miss you + 10% off" after 7 days
✅ Weekly offer broadcasts
✅ Birthday free dessert offers

A recent restaurant client saw 22% more repeat orders after setup.

5-min demo here:
${site}

Free, works for any size restaurant 🙂

_Prefer Hindi or Bangla? Reply "H" or "B" — happy to switch!_`,
}

// Detect niche from lead's niche/notes/tags fields.
// Returns 'gym'/'salon'/'clinic'/'restaurant' or null.
//
// Strategy:
//   1. PRIMARY: check `niche` field with whole-word match (most reliable)
//   2. FALLBACK: check `notes` field with whole-word match
//   3. SKIP `tags` for niche detection — tags often contain unrelated stuff
//   4. Score each niche by keyword count — return highest score
//   5. If multiple niches match equally → return null (ambiguous = skip)
//
// Whole-word boundary prevents "shaving cream" matching "ham" in "shave[ham]"
// or "Full Stack Automation" matching "auto" — only exact word matches count.
function detectNiche(lead) {
  const nicheField = (lead.niche || '').toLowerCase().trim()
  const notesField = (lead.notes || '').toLowerCase().trim()
  const nameField  = (lead.name  || '').toLowerCase().trim()  // business name often has the niche

  // Quick reject: niche field has clearly non-business keywords
  // ("automation", "developer", "student" etc. are NOT business niches)
  const REJECT_KEYWORDS = ['automation', 'developer', 'student', 'system', 'software', 'app', 'project', 'test']
  if (nicheField && REJECT_KEYWORDS.some(k => nicheField.includes(k))) {
    return null  // skip leads that look like leads-for-our-service, not actual businesses
  }

  // Score each niche by counting keyword whole-word matches
  const scores = { gym: 0, salon: 0, clinic: 0, restaurant: 0 }
  const wordBoundary = (text, word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i')
    return re.test(text)
  }

  // Weights:
  //   niche field = 3 (most reliable)
  //   name field  = 2 (business name like "Advance Skin Hair & Laser Clinic" — strong signal)
  //   notes field = 1 (least reliable)
  for (const [key, keywords] of Object.entries(NICHE_KEYWORDS)) {
    for (const kw of keywords) {
      if (nicheField && wordBoundary(nicheField, kw)) scores[key] += 3
      if (nameField  && wordBoundary(nameField,  kw)) scores[key] += 2
      if (notesField && wordBoundary(notesField, kw)) scores[key] += 1
    }
  }

  // Find highest-scoring niche
  const max = Math.max(...Object.values(scores))
  if (max === 0) return null  // no match at all

  const matched = Object.keys(scores).filter(k => scores[k] === max)
  if (matched.length > 1) return null  // ambiguous — skip rather than guess wrong

  return matched[0]
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Optional secret check for cron security
  // Browser theke call hole (manual button click) secret check skip
  // n8n cron theke call hole secret match korte hobe
  const secret = req.headers['x-webhook-secret']
  const isFromBrowser = (req.headers['user-agent'] || '').includes('Mozilla')
  if (!isFromBrowser && process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getServiceClient()
  const today = new Date().toISOString().slice(0,10)
  const PER_NICHE = 3                    // 3 leads × 4 niches = 12/day
  const SITE = process.env.MARKETING_SITE_URL || 'https://www.autoflowa.in/'

  try {
    // 1. Smarter idempotent check — only block if PENDING messages exist.
    //    This allows re-generation after cleanup (deleted pending) or after
    //    all messages have been sent. Each generate cycle adds NEW pending msgs,
    //    never duplicates already-pending ones.
    const { count: pendingCount } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('scheduled_for', today)
      .eq('status', 'pending')

    if (pendingCount && pendingCount > 0) {
      // Already have pending msgs for today — return current count, don't add more
      const { count: totalCount } = await supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_for', today)
      return res.status(200).json({
        success: true,
        skipped: true,
        message: `${pendingCount} pending messages already queued. Send/skip them first, then re-generate for more.`,
        count:   totalCount || 0,
        pending: pendingCount,
        date:    today,
      })
    }

    // 2. Build phone exclusion list (DUPLICATE PREVENTION)
    //
    //    A phone number is excluded if EITHER:
    //      (a) It has ever appeared in outreach_queue (we sent or queued it before)
    //      (b) Any lead with that phone has status beyond 'New Lead'
    //          (Contacted / Interested / Demo Booked / Closed Won / Not Interested)
    //
    //    This prevents the SAME WhatsApp number receiving multiple messages even
    //    when the CRM has duplicate lead entries (same phone, different names/sources).

    // (a) Phones that have already been queued (any time, any status)
    const { data: queuedPhones } = await supabase
      .from('outreach_queue')
      .select('lead_phone')
    const queuedPhoneSet = new Set(
      (queuedPhones || []).map(r => normalizePhone(r.lead_phone))
    )

    // (b) Phones whose lead has been progressed past 'New Lead'
    const { data: contactedLeads } = await supabase
      .from('leads')
      .select('phone')
      .not('phone', 'is', null)
      .neq('phone', '')
      .neq('status', 'New Lead')   // anything other than New Lead = already touched
    const contactedPhoneSet = new Set(
      (contactedLeads || []).map(r => normalizePhone(r.phone))
    )

    const excludedPhones = new Set([...queuedPhoneSet, ...contactedPhoneSet])

    // 3. Fetch candidate leads — fresh ones only
    const { data: candidates, error } = await supabase
      .from('leads')
      .select('id,name,phone,niche,notes,tags,score,status,created_at,outreach_attempted_at')
      .not('phone', 'is', null)
      .neq('phone', '')
      .is('outreach_attempted_at', null)
      .eq('status', 'New Lead')           // strict — only fresh leads
      .order('score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(3000)                         // pull buffer, filter by niche + dedup

    if (error) return res.status(500).json({ error: error.message })

    // 4. Bucket by niche, with phone-level dedup within this batch too
    const buckets = { gym: [], salon: [], clinic: [], restaurant: [] }
    const usedPhonesInBatch = new Set()    // dedup within this generation cycle
    for (const lead of candidates || []) {
      const phone = normalizePhone(lead.phone)
      if (!phone) continue                            // skip blank phones
      if (excludedPhones.has(phone)) continue          // already-contacted phones
      if (usedPhonesInBatch.has(phone)) continue       // dup within this batch
      const niche = detectNiche(lead)
      if (niche && buckets[niche].length < PER_NICHE) {
        buckets[niche].push(lead)
        usedPhonesInBatch.add(phone)
      }
      // stop early once all buckets full
      if (Object.values(buckets).every(b => b.length >= PER_NICHE)) break
    }

    // 4. Build queue rows
    const queueRows = []
    for (const [niche, leads] of Object.entries(buckets)) {
      for (const lead of leads) {
        queueRows.push({
          lead_id:       lead.id,
          lead_name:     lead.name || 'there',
          lead_phone:    lead.phone,
          niche:         niche,
          message:       TEMPLATES[niche](lead, SITE),
          status:        'pending',
          scheduled_for: today,
        })
      }
    }

    if (queueRows.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: 'No leads matched any niche today',
        buckets: { gym: 0, salon: 0, clinic: 0, restaurant: 0 },
      })
    }

    // 5. Insert into queue
    const { error: insertErr } = await supabase
      .from('outreach_queue')
      .insert(queueRows)
    if (insertErr) return res.status(500).json({ error: insertErr.message })

    // 6. Mark leads as attempted (so they're not picked again tomorrow)
    const leadIds = queueRows.map(r => r.lead_id)
    await supabase
      .from('leads')
      .update({ outreach_attempted_at: new Date().toISOString() })
      .in('id', leadIds)

    return res.status(200).json({
      success: true,
      count:   queueRows.length,
      date:    today,
      buckets: {
        gym:        buckets.gym.length,
        salon:      buckets.salon.length,
        clinic:     buckets.clinic.length,
        restaurant: buckets.restaurant.length,
      },
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
