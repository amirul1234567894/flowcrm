// pages/api/outreach/followups.js
// Returns leads that need a follow-up message today.
//
// FOLLOW-UP STAGES:
//   Day 3:  Soft check-in — `leads.fu1_sent`
//   Day 7:  Different angle (case study) — `leads.fu2_sent`
//   Day 14: Final reach-out — `leads.fu3_sent`
//
// AUTO-SKIP rules — a lead is EXCLUDED from follow-ups if ANY:
//   • Status is anything OTHER than 'New Lead' or 'Contacted'
//     (Interested / Demo Booked / Closed Won / Not Interested → done, no more msgs)
//   • Lead has any inbound message in `messages` table (they replied, even if status not updated)
//   • Already past Day 14 (fu3_sent = true)
//
// Returns: list of follow-up items with ready-built personalized messages,
// grouped by stage (day3 / day7 / day14).

import { getServiceClient } from '../../../lib/supabase'

// Niche detection (same logic as generate.js — kept consistent)
const NICHE_KEYWORDS = {
  gym:        ['gym','gyms','fitness','crossfit','workout','akhara','bodybuilding'],
  salon:      ['salon','salons','parlor','parlour','beauty','makeup','spa','barber','unisex'],
  clinic:     ['clinic','clinics','hospital','dental','dentist','physio','diagnostic','dermatology','derma','skin','laser'],
  restaurant: ['restaurant','restaurants','cafe','dhaba','biriyani','restro','catering','bakery','pizzeria','pizza','burger'],
}

function detectNiche(lead) {
  const fields = [(lead.niche||''), (lead.name||''), (lead.notes||'')].map(s => s.toLowerCase().trim())
  const REJECT = ['automation', 'developer', 'student', 'system', 'software', 'app', 'project', 'test']
  if (fields[0] && REJECT.some(k => fields[0].includes(k))) return null
  const wb = (text, w) => new RegExp(`\\b${w}\\b`, 'i').test(text)
  const scores = { gym: 0, salon: 0, clinic: 0, restaurant: 0 }
  const weights = [3, 2, 1]  // niche, name, notes
  for (const [key, kws] of Object.entries(NICHE_KEYWORDS)) {
    for (const kw of kws) {
      fields.forEach((f, i) => { if (f && wb(f, kw)) scores[key] += weights[i] })
    }
  }
  const max = Math.max(...Object.values(scores))
  if (max === 0) return null
  const matched = Object.keys(scores).filter(k => scores[k] === max)
  return matched.length === 1 ? matched[0] : null
}

// Follow-up message templates per niche per stage
// NO EMOJIS — same encoding-safety reason as fresh outreach templates.
// Each one has a different angle so it doesn't feel repetitive
const FOLLOWUP_TEMPLATES = {
  gym: {
    day3: (l, site) => `Hi${l.name?' '+l.name:''},

Following up on my message from a few days back about gym automation.

Just wanted to check — did you get a chance to look at it? No worries if you're busy, even a quick "later" or "not interested" helps me know what to do next.

In case you missed it: ${site}`,

    day7: (l, site) => `Hi${l.name?' '+l.name:''},

One more from me, then I'll stop bothering you.

Quick context — we recently helped a gym save 2 hours/day on manual messaging and saw 32% more renewals in 60 days.

If at all curious how it'd look for your gym:
${site}

If timing isn't right, just say "later" — totally fine.`,

    day14: (l, site) => `Hi${l.name?' '+l.name:''},

Final message from me, promise.

If WhatsApp automation isn't a priority right now, no worries at all. The offer stands whenever you're ready:
${site}

Wish you the best with the gym!`,
  },

  salon: {
    day3: (l, site) => `Hi${l.name?' '+l.name:''},

Following up on my message about salon automation from a few days back.

Wondering if you got a chance to look — no pressure, even a quick "later" helps me know whether to circle back.

Demo if helpful: ${site}`,

    day7: (l, site) => `Hi${l.name?' '+l.name:''},

One more reach-out, then I'll stop.

Quick story — a salon we onboarded last month saw 47 extra bookings just from auto-reminders alone. No extra ads, no extra staff.

Want to see how? ${site}

If timing's off, just reply "later" — all good.`,

    day14: (l, site) => `Hi${l.name?' '+l.name:''},

Last message, promise.

If automation isn't on your radar right now, totally understand. Whenever you're ready:
${site}

Best wishes for the salon!`,
  },

  clinic: {
    day3: (l, site) => `Hi${l.name?' '+l.name:''},

Following up on my message about clinic automation from a few days ago.

Did you get a chance to look? Even a quick "not now" helps me plan next steps.

Demo: ${site}`,

    day7: (l, site) => `Hi${l.name?' '+l.name:''},

One more from me, then I'll stop.

Quick stat — clinics using our reminder system saw 60% reduction in missed appointments. Real impact for patient care + revenue.

If you'd like to see it: ${site}

If not the right time, just reply "later" — no pressure.`,

    day14: (l, site) => `Hi${l.name?' '+l.name:''},

Final message from me.

If automation isn't a priority now, completely understand. Available whenever:
${site}

Wishing the clinic continued success!`,
  },

  restaurant: {
    day3: (l, site) => `Hi${l.name?' '+l.name:''},

Following up on my message about restaurant automation a few days back.

Did you get a chance to look? Even a quick reply helps me know what to do next.

Demo: ${site}`,

    day7: (l, site) => `Hi${l.name?' '+l.name:''},

One more from me, then I'll stop.

Quick story — a restaurant we onboarded saw 22% more repeat orders from auto WhatsApp messaging. Customers come back more often when they're remembered.

If at all curious: ${site}

If not now, just say "later" — all good.`,

    day14: (l, site) => `Hi${l.name?' '+l.name:''},

Last message, promise.

Whenever you're ready to explore it:
${site}

Wishing the restaurant continued success!`,
  },
}

// Generic fallback templates for leads where niche couldn't be detected
const GENERIC_TEMPLATES = {
  day3: (l, site) => `Hi${l.name?' '+l.name:''},

Following up on my message from a few days back. Did you get a chance to look at AutoFlowa?

No pressure — even a quick "later" or "not interested" helps me plan.

Demo: ${site}`,

  day7: (l, site) => `Hi${l.name?' '+l.name:''},

One more from me, then I'll stop.

If automation might help your business with WhatsApp messaging:
${site}

If timing isn't right, just say "later" — totally fine.`,

  day14: (l, site) => `Hi${l.name?' '+l.name:''},

Final message, promise.

The offer stands whenever you're ready:
${site}

All the best with your business!`,
}

const daysBetween = (later, earlier) => Math.floor((later - earlier) / (1000 * 60 * 60 * 24))

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')

  const supabase = getServiceClient()
  const SITE = process.env.MARKETING_SITE_URL || 'https://www.autoflowa.in/'
  const now = new Date()

  try {
    // 1. Get leads who were sent at least one outreach (status moved to 'Contacted')
    //    AND haven't completed all 3 follow-ups yet
    //    AND status is still in active funnel (not Interested/Demo/Won/Lost)
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id,name,phone,niche,notes,status,fu1_sent,fu2_sent,fu3_sent,fu1_sent_at,fu2_sent_at,fu3_sent_at,last_contact,outreach_attempted_at,updated_at')
      .eq('status', 'Contacted')                  // only leads that received initial outreach
      .eq('fu3_sent', false)                       // not yet at final stage
      .not('outreach_attempted_at', 'is', null)    // outreach actually happened
      .limit(2000)

    if (error) return res.status(500).json({ error: error.message })

    // 2. Get inbound messages — leads who REPLIED should auto-skip follow-ups
    //    (even if status not manually updated)
    const leadIds = (leads || []).map(l => l.id)
    const repliedLeadIds = new Set()
    if (leadIds.length > 0) {
      const { data: inbounds } = await supabase
        .from('messages')
        .select('lead_id')
        .eq('direction', 'in')
        .in('lead_id', leadIds)
      for (const m of inbounds || []) repliedLeadIds.add(m.lead_id)
    }

    // 3. Bucket each lead into the correct follow-up stage based on time elapsed
    const day3 = []
    const day7 = []
    const day14 = []

    for (const lead of leads || []) {
      // SKIP if replied (auto-skip rule)
      if (repliedLeadIds.has(lead.id)) continue

      // Reference time = outreach_attempted_at (when initial msg was sent)
      const sentAt = new Date(lead.outreach_attempted_at)
      const days = daysBetween(now, sentAt)

      // Determine which stage this lead is at
      // Day 14: fu2_sent done, ≥14 days since outreach
      if (lead.fu2_sent && !lead.fu3_sent && days >= 14) {
        day14.push({ ...lead, daysOld: days, stage: 'day14' })
      }
      // Day 7: fu1_sent done, fu2 not, ≥7 days since outreach
      else if (lead.fu1_sent && !lead.fu2_sent && days >= 7) {
        day7.push({ ...lead, daysOld: days, stage: 'day7' })
      }
      // Day 3: fu1 not sent yet, ≥3 days since outreach
      else if (!lead.fu1_sent && days >= 3) {
        day3.push({ ...lead, daysOld: days, stage: 'day3' })
      }
    }

    // 4. Build response items with personalized messages
    const buildItems = (bucket) => bucket.map(lead => {
      const niche = detectNiche(lead) || 'generic'
      const tpls = (niche === 'generic') ? GENERIC_TEMPLATES : FOLLOWUP_TEMPLATES[niche]
      const message = tpls[lead.stage](lead, SITE)
      return {
        lead_id:    lead.id,
        lead_name:  lead.name || 'there',
        lead_phone: lead.phone,
        niche:      niche === 'generic' ? null : niche,
        stage:      lead.stage,
        days_old:   lead.daysOld,
        message,
      }
    })

    return res.status(200).json({
      day3:  buildItems(day3),
      day7:  buildItems(day7),
      day14: buildItems(day14),
      summary: {
        total: day3.length + day7.length + day14.length,
        day3:  day3.length,
        day7:  day7.length,
        day14: day14.length,
      }
    })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
