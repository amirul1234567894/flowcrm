// pages/api/outreach/generate.js
// Daily cron (n8n) ekhane call kore — auto-picks 3 best leads per niche,
// generates personalized message for each, stores in outreach_queue table.
//
// Niche detection: matches lead.niche (case-insensitive) against keyword sets.
// Smart pick: highest score, never picked before, has phone number.

import { getServiceClient } from '../../../lib/supabase'

// Niche keyword matchers — covers Bengali/Hindi/English variations
const NICHE_KEYWORDS = {
  gym:        ['gym','fitness','yoga','crossfit','workout','training','exercise','akhara'],
  salon:      ['salon','parlor','parlour','beauty','makeup','spa','hair','barber','nail'],
  clinic:     ['clinic','hospital','doctor','dental','dentist','medical','health','physio','diagnostic'],
  restaurant: ['restaurant','cafe','food','dhaba','biriyani','restro','catering','bakery','pizza'],
}

// Per-niche message templates — uses {{name}}, {{niche_name}}, {{site}} placeholders
// Templates designed for: WhatsApp Business App (manual send by user)
// Brand: AutoFlowa — https://www.autoflowa.in/
const TEMPLATES = {
  gym: (l, site) => `Namaskar${l.name?' '+l.name:''}!

Apnar gym-er Facebook page dekhe contact korlam. Beautiful setup!

Ekta question chilo — apnara members-der monthly renewal reminder, new offer, ba "missed-class" follow-up sob manually pathan, naki kichu auto system ache?

Karon ami AutoFlowa-te gym-er specific automation banai —
✅ Member join holei auto welcome msg
✅ 7 din na ele "miss you" reminder
✅ Renewal er 3 din age auto reminder
✅ Birthday wish + personal offer

Recent ekta gym-e implement korar por 38% more renewals esheche.

Demo dekhben? Ekta 5 min er video ache amader site e:
${site}

No cost, no spam — dekhe nile decide korben.`,

  salon: (l, site) => `Hello${l.name?' '+l.name:''}!

Apnar salon-er work boddo sundor — Instagram-e dekhlam!

AutoFlowa theke ekta system show korte chai jeta apnar regular clients-der —
✅ First visit-er por auto thank you msg
✅ Appointment-er 24hr/2hr age reminder
✅ Birthday-te wish + special offer
✅ 30 din na ele "miss you" message
✅ Festival-e promo broadcast

Recent ekta client-er salon-e implement korar por 47 booking/month extra esheche shudhu auto reminder theke.

Free 5 min demo video amader site e ache:
${site}

Apnar salon-e exactly kemon hobe seta dekhe niye decide korben.`,

  clinic: (l, site) => `Namaskar${l.name?' '+l.name:''},

Apnar clinic/hospital-er kotha shune contact korlam.

Ekta query — patient appointment confirmation, follow-up reminder, prescription reminder eishab manually hoy naki automation diye hoy?

AutoFlowa-te clinic-er jonno specific WhatsApp automation banai:
✅ Appointment confirmation auto
✅ 24hr age reminder (missed appointment 60% kome jay)
✅ Follow-up er din auto reminder
✅ New patient onboarding flow

HIPAA-friendly, secure, patient data safe.

Demo + pricing details:
${site}

Free demo, no obligation.`,

  restaurant: (l, site) => `Hello${l.name?' '+l.name:''}!

Apnar restaurant-er menu dekhe pet e khida lege gelo! 😄

Ektu serious kotha — apnara customer-der order confirmation, delivery update, weekly offer, repeat customer er jonno special discount eishab WhatsApp-e pathate paren?

Ami AutoFlowa-te restaurant-er jonno automation banai:
✅ New order auto confirmation
✅ Delivery update auto
✅ 7 din na ele "miss you + 10% off" msg
✅ Weekly offer broadcast
✅ Birthday customer-er jonno free dessert offer

Recent ekta restaurant-e implement korar por 22% repeat orders bere geche.

Demo dekhben?
${site}

Free, koto chhoto restaurant-er o kaaj kore.`,
}

// Detect niche from lead's niche field — returns 'gym'/'salon'/etc, or null
function detectNiche(lead) {
  const text = ((lead.niche||'') + ' ' + (lead.notes||'') + ' ' + (lead.tags||[]).join(' '))
                .toLowerCase()
  for (const [key, keywords] of Object.entries(NICHE_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) return key
  }
  return null
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
    // 1. Check if already generated today (idempotent)
    const { data: existing } = await supabase
      .from('outreach_queue')
      .select('id')
      .eq('scheduled_for', today)
      .limit(1)

    if (existing && existing.length > 0) {
      const { count } = await supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_for', today)
      return res.status(200).json({
        success: true,
        skipped: true,
        message: 'Already generated for today',
        count: count || 0,
        date: today,
      })
    }

    // 2. Fetch candidate leads — only those with phone, not picked before, not closed
    //    Order by score (hottest first) and recency
    const { data: candidates, error } = await supabase
      .from('leads')
      .select('id,name,phone,niche,notes,tags,score,status,created_at,outreach_attempted_at')
      .not('phone', 'is', null)
      .neq('phone', '')
      .is('outreach_attempted_at', null)
      .not('status', 'in', '("Closed Won","Not Interested")')
      .order('score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(2000)                       // pull a buffer, then filter by niche

    if (error) return res.status(500).json({ error: error.message })

    // 3. Bucket by niche
    const buckets = { gym: [], salon: [], clinic: [], restaurant: [] }
    for (const lead of candidates || []) {
      const niche = detectNiche(lead)
      if (niche && buckets[niche].length < PER_NICHE) {
        buckets[niche].push(lead)
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
