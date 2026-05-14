// pages/api/outreach/followups.js
// === Layer 3: AI-Powered Follow-ups for All Niches ===
//
// Returns leads that need a follow-up message today, with AI-generated
// personalized messages per lead.
//
// FOLLOW-UP STAGES:
//   Day 3:  Soft check-in (fu1_sent)
//   Day 7:  Different angle / use case (fu2_sent)
//   Day 14: Final reach-out (fu3_sent)
//
// AUTO-SKIP rules:
//   • Status anything other than 'New Lead' or 'Contacted' → skip
//   • Lead has any inbound message → skip (they replied)
//   • Already past Day 14 (fu3_sent=true) → skip
//
// AI strategy:
//   - Same Groq-based personalization as fresh outreach
//   - Each stage uses a DIFFERENT prompt angle so messages don't repeat
//   - Fallback templates if AI fails

import { getServiceClient } from '../../../lib/supabase'

const SENDER_NAME = process.env.SENDER_NAME || 'Sami'
const SITE = process.env.MARKETING_SITE_URL || 'https://www.autoflowa.in/'

// Niche context — broader automation services per niche, not just WhatsApp.
// AI picks ONE relevant service per follow-up so messages stay focused.
const NICHE_CONTEXT = {
  clinic:     { pain: 'missed appointments and manual scheduling',         services: 'appointment reminder automation, patient CRM, online booking' },
  hospital:   { pain: 'patient communication overhead',                    services: 'patient communication automation, report delivery automation, dashboard reporting' },
  dental:     { pain: 'missed appointments and recall management',         services: 'recall reminder automation, online booking, patient retention campaigns' },
  gym:        { pain: 'member churn and renewal gaps',                     services: 'renewal reminder automation, lead nurturing, member onboarding workflows' },
  salon:      { pain: 'one-time customers not returning',                  services: 'retention messaging, online booking automation, birthday campaigns' },
  spa:        { pain: 'customer retention and booking management',         services: 'booking automation, retention campaigns, package renewal reminders' },
  restaurant: { pain: 'low repeat customer rates',                         services: 'repeat-order campaigns, review collection automation, loyalty programs' },
  cafe:       { pain: 'customer retention',                                services: 'loyalty automation, social media scheduling, retention messaging' },
  hotel:      { pain: 'manual booking follow-ups and OTA management',      services: 'booking confirmation automation, OTA sync, review request automation' },
  school:     { pain: 'parent communication and fee follow-up',            services: 'parent notification automation, fee reminder automation, admission inquiry follow-up' },
  coaching:   { pain: 'class management and fee tracking',                 services: 'class reminder automation, lead nurturing, fee tracking' },
  ecommerce:  { pain: 'cart abandonment and customer support load',        services: 'cart recovery automation, order tracking, AI support agents, retention campaigns' },
  real_estate:{ pain: 'lead follow-up gaps and manual nurturing',          services: 'lead nurturing automation, site visit reminders, CRM integration' },
  realtor:    { pain: 'lead follow-up gaps and manual nurturing',          services: 'lead nurturing automation, drip campaigns, CRM automation' },
  law:        { pain: 'client follow-up and deadline tracking',            services: 'client reminder automation, document deadline alerts, intake automation' },
  lawyer:     { pain: 'client follow-up and consultation scheduling',      services: 'client reminder automation, consultation booking, intake form automation' },
  travel:     { pain: 'booking follow-ups and itinerary delivery',         services: 'itinerary automation, booking reminders, support automation' },
  logistics:  { pain: 'delivery update communication',                     services: 'delivery update automation, dispatch alerts, customer notification system' },
  it:         { pain: 'long sales cycles and lead nurturing',              services: 'lead nurturing automation, demo follow-up sequences, onboarding automation' },
  agency:     { pain: 'client communication and manual reporting',         services: 'client update automation, reporting automation, lead generation scraping' },
}

function matchNicheCategory(niche, name = '', notes = '') {
  const haystack = `${niche || ''} ${name || ''} ${notes || ''}`.toLowerCase()
  const orderedKeys = ['dental', 'hospital', 'real_estate', 'realtor', 'lawyer', 'law', 'logistics', 'ecommerce',
                       'coaching', 'school', 'travel', 'agency', 'salon', 'spa', 'gym', 'cafe', 'restaurant',
                       'hotel', 'clinic', 'it']
  for (const key of orderedKeys) {
    const variants = key === 'real_estate' ? ['real estate', 'realty', 'realtor', 'property'] : [key]
    if (variants.some(v => haystack.includes(v))) return key
  }
  return null
}

// === Language strategy (same as aiPersonalizer.js) ===
const HINGLISH_NICHES = new Set([
  'salon', 'spa', 'gym', 'restaurant', 'cafe', 'clinic', 'dental',
  'coaching', 'school'
])
const ENGLISH_NICHES = new Set([
  'hospital', 'hotel', 'law', 'lawyer', 'real_estate', 'realtor',
  'ecommerce', 'travel', 'logistics', 'it', 'agency'
])

function isIndianLead(lead) {
  const digits = String(lead.phone || '').replace(/\D/g, '')
  if (digits.length === 10 && /^[6-9]/.test(digits)) return true
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return true
  if (digits.length === 13 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(3))) return true
  return false
}

function pickLanguage(lead) {
  if (!isIndianLead(lead)) return 'english'
  const nicheCat = matchNicheCategory(lead.niche, lead.name, lead.notes)
  if (nicheCat && ENGLISH_NICHES.has(nicheCat)) return 'english'
  if (nicheCat && HINGLISH_NICHES.has(nicheCat)) return 'hinglish'
  return 'hinglish'
}

// === Stage-specific AI prompt builders ===
function buildFollowupPrompt(lead, stage) {
  const nicheCat = matchNicheCategory(lead.niche, lead.name, lead.notes)
  const ctx = nicheCat ? NICHE_CONTEXT[nicheCat] : null
  const nicheText = lead.niche || 'business'
  const businessName = lead.name || 'business'
  const language = pickLanguage(lead)

  const ctxLine = ctx
    ? `Their likely pain point: ${ctx.pain}. Services we offer for this: ${ctx.services}.`
    : `They run a ${nicheText} business. We offer business automation (WhatsApp, email, CRM, lead generation, AI agents, workflow automation).`

  // Language-specific examples per stage
  const hinglishExamples = {
    day3: `Hinglish example for day 3 (very short, gentle):
"Namaste [name], Sami yahan — kuch din pehle apko message kiya tha automation ke baare mein. Agar abhi sahi time nahi hai, bilkul koi baat nahi. Bas ek 'later' ya 'not interested' reply kar dijiye, mujhe pata chal jayega. — Sami"`,

    day7: `Hinglish example for day 7 (use case, no fake stats):
"Namaste [name], ek aur message, phir bandh kar dunga. Jo small clinics ke saath kaam karta hoon, unmein common problem hai — manually appointment reminders bhejna ya call karna, jo bohot time leta hai. WhatsApp pe ye automatic ho jaata hai. Agar curious ho to 'show me' reply kar dijiye, 2-minute ka demo bhej dunga. — Sami"`,

    day14: `Hinglish example for day 14 (polite close):
"Namaste [name], ye mera last message hai — promise. Jab bhi ready ho, available hoon: ${SITE}. Apke business ke liye best wishes! — Sami"`
  }

  const stageInstructions = {
    day3: `This is a DAY 3 follow-up — gentle check-in only.
- Keep it VERY short (max 50 words)
- Reference the previous message politely
- Acknowledge they might be busy
- No pressure, no new pitch, no features
- Invite a simple "later" or "not interested" reply
- Sign off with "— ${SENDER_NAME}"`,

    day7: `This is a DAY 7 follow-up — different angle than the initial message.
- Keep it short (max 80 words)
- Open with something like "One more message, then I'll stop" (or Hinglish equivalent)
- Share ONE specific use case — be GENERIC, no named clients
- Do NOT invent fake statistics
- Invite a "show me" reply if they want a walkthrough
- Sign off with "— ${SENDER_NAME}"`,

    day14: `This is a DAY 14 FINAL follow-up — polite close.
- Keep it VERY short (max 40 words)
- Say this is the last message
- No pressure, leave door open
- Wish them well
- Include site link: ${SITE}
- Sign off with "— ${SENDER_NAME}"`,
  }

  const languageInstructions = language === 'hinglish'
    ? `LANGUAGE: HINGLISH (Hindi-English mix in Roman script, no Devanagari).
Use "aap" (formal you), mix English business terms (WhatsApp, automation, demo) as-is.
Greeting: "Namaste [name]," — feels personal and Indian.
Sound like a real Indian person typing on WhatsApp, not a corporate broadcast.

${hinglishExamples[stage]}`
    : `LANGUAGE: ENGLISH (professional but conversational).
Greeting: "Hello [name],"
Natural conversational tone.`

  return `You are writing a follow-up WhatsApp message from ${SENDER_NAME}, who runs a business automation agency. The agency builds custom automation for small businesses — WhatsApp automation, email automation, lead generation/scraping, CRM workflows, AI agents, reporting dashboards, and custom integrations.

Recipient:
- Business name: ${businessName}
- Industry: ${nicheText}

${ctxLine}

${languageInstructions}

${stageInstructions[stage]}

STRICT RULES:
- NO emojis
- NO "Reply H or B" or language-switch prompts
- NO pricing
- NO fake statistics or named clients
- NO buzzwords (leverage, synergy, game-changer, revolutionize)
- NO ALL-CAPS, no excessive exclamation
- Natural conversational tone

Output ONLY the message text. No preamble.`
}

function cleanAIOutput(text, stage) {
  if (!text || typeof text !== 'string') return null
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^(here'?s? (is )?the message:?|message:?|output:?)\s*/i, '')
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
  cleaned = cleaned.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '')
  cleaned = cleaned.replace(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/gu, '')
  cleaned = cleaned.replace(/\(\s*prefer\s+(hindi|bangla|bengali)[\s\S]{0,200}?(switch|happy)[!.]*\s*\)/gi, '')
  cleaned = cleaned.replace(/prefer\s+(hindi|bangla|bengali)[\s\S]{0,200}?(switch|happy)[!.]*/gi, '')
  cleaned = cleaned.replace(/reply\s+["']?[hb]["']?\s+or\s+["']?[hb]["']?[\s\S]{0,50}?(switch|happy)[!.]*/gi, '')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  if (!cleaned.toLowerCase().includes(SENDER_NAME.toLowerCase())) {
    cleaned += `\n\n— ${SENDER_NAME}`
  }

  const wordCount = cleaned.split(/\s+/).length
  // Length limits per stage
  const maxWords = stage === 'day14' ? 80 : stage === 'day3' ? 100 : 150
  if (wordCount > maxWords) return null
  if (wordCount < 10) return null
  return cleaned
}

function fallbackFollowup(lead, stage) {
  const nicheCat = matchNicheCategory(lead.niche, lead.name, lead.notes)
  const ctx = nicheCat ? NICHE_CONTEXT[nicheCat] : null
  const language = pickLanguage(lead)
  // Pick first service from ctx for fallback variety
  const firstService = ctx ? ctx.services.split(',')[0].trim() : 'workflow automation'

  // ===== HINGLISH FALLBACKS =====
  if (language === 'hinglish') {
    const greet = lead.name ? `Namaste ${lead.name}` : 'Namaste'

    if (stage === 'day3') {
      return `${greet},

${SENDER_NAME} yahan — kuch din pehle apko message kiya tha automation ke baare mein, bas follow-up kar raha hoon.

Agar abhi sahi time nahi hai, bilkul koi baat nahi. Bas ek quick "later" ya "not interested" reply kar dijiye, mujhe pata chal jayega.

— ${SENDER_NAME}`
    }

    if (stage === 'day7') {
      const useCase = ctx
        ? `Jo ${lead.niche || 'businesses'} ke saath kaam karta hoon, unmein common problem hai — ${ctx.pain}. ${firstService} se ye automatic ho jaata hai — koi extra staff effort nahi.`
        : `Jo businesses ke saath kaam karta hoon, unmein manually repetitive tasks karna ek common problem hai. Custom automation se ye sab automatic ho jaata hai.`
      return `${greet},

Ek aur message, phir bandh kar dunga — promise.

${useCase}

Agar curious ho to bas "show me" reply kar dijiye, 2-minute ka demo video bhej dunga.

— ${SENDER_NAME}`
    }

    // day14 hinglish
    return `${greet},

Ye mera last message hai — promise.

Jab bhi automation explore karna ho, available hoon:
${SITE}

Apke business ke liye best wishes!

— ${SENDER_NAME}`
  }

  // ===== ENGLISH FALLBACKS =====
  const greet = lead.name ? `Hello ${lead.name}` : 'Hello'

  if (stage === 'day3') {
    return `${greet},

${SENDER_NAME} here — just following up on my message from a few days back about business automation.

No pressure at all. Even a quick "later" or "not interested" helps me know whether to circle back.

— ${SENDER_NAME}`
  }

  if (stage === 'day7') {
    const useCase = ctx
      ? `Most ${lead.niche || 'businesses'} I work with deal with ${ctx.pain}. ${firstService.charAt(0).toUpperCase() + firstService.slice(1)} typically handles this without staff overhead.`
      : `Most businesses I work with deal with manual repetitive tasks. Custom automation handles this without adding staff overhead.`
    return `${greet},

One more from me, then I'll stop.

${useCase}

If you'd like a quick walkthrough, just reply "show me" and I'll send a 2-minute video.

— ${SENDER_NAME}`
  }

  // day14 english
  return `${greet},

Last message from me — promise.

Whenever you're ready to explore it:
${SITE}

Wishing you continued success.

— ${SENDER_NAME}`
}

// Generate AI follow-up for a single lead+stage
async function generateFollowupMessage(lead, stage) {
  const GROQ_KEY = process.env.GROQ_API_KEY
  if (!GROQ_KEY) return { message: fallbackFollowup(lead, stage), source: 'fallback' }

  try {
    const prompt = buildFollowupPrompt(lead, stage)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 250,
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'You write short, human-sounding WhatsApp follow-up messages. No emojis, no buzzwords, no fake stats. Output only the message text.' },
          { role: 'user', content: prompt }
        ]
      })
    })
    clearTimeout(timeoutId)

    if (!resp.ok) return { message: fallbackFollowup(lead, stage), source: 'fallback' }

    const data = await resp.json()
    const aiText = data?.choices?.[0]?.message?.content
    const cleaned = cleanAIOutput(aiText, stage)

    if (!cleaned) return { message: fallbackFollowup(lead, stage), source: 'fallback' }
    return { message: cleaned, source: 'ai' }
  } catch (e) {
    return { message: fallbackFollowup(lead, stage), source: 'fallback' }
  }
}

// Batch processing with concurrency control (Groq rate limit safety)
async function generateBatch(items) {
  const batchSize = 5
  const delayMs = 2000
  const results = []

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(({ lead, stage }) =>
        generateFollowupMessage(lead, stage).then(r => ({ leadId: lead.id, stage, ...r }))
      )
    )
    results.push(...batchResults)
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }

  return results
}

const daysBetween = (later, earlier) => Math.floor((later - earlier) / (1000 * 60 * 60 * 24))

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')

  const supabase = getServiceClient()
  const now = new Date()

  try {
    // 1. Get leads in 'Contacted' status, not yet at fu3
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id,name,phone,niche,notes,status,fu1_sent,fu2_sent,fu3_sent,fu1_sent_at,fu2_sent_at,fu3_sent_at,last_contact,outreach_attempted_at,updated_at')
      .eq('status', 'Contacted')
      .eq('fu3_sent', false)
      .not('outreach_attempted_at', 'is', null)
      .limit(2000)

    if (error) return res.status(500).json({ error: error.message })

    // 2. Filter leads that replied (auto-skip)
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

    // 3. Bucket each lead by follow-up stage based on elapsed time
    const stagedLeads = []  // [{ lead, stage }]

    for (const lead of leads || []) {
      if (repliedLeadIds.has(lead.id)) continue
      const sentAt = new Date(lead.outreach_attempted_at)
      const days = daysBetween(now, sentAt)

      if (lead.fu2_sent && !lead.fu3_sent && days >= 14) {
        stagedLeads.push({ lead: { ...lead, daysOld: days }, stage: 'day14' })
      } else if (lead.fu1_sent && !lead.fu2_sent && days >= 7) {
        stagedLeads.push({ lead: { ...lead, daysOld: days }, stage: 'day7' })
      } else if (!lead.fu1_sent && days >= 3) {
        stagedLeads.push({ lead: { ...lead, daysOld: days }, stage: 'day3' })
      }
    }

    if (stagedLeads.length === 0) {
      return res.status(200).json({
        day3: [], day7: [], day14: [],
        summary: { total: 0, day3: 0, day7: 0, day14: 0 }
      })
    }

    // 4. Generate AI follow-ups for all staged leads (batched)
    const results = await generateBatch(stagedLeads)
    const resultMap = new Map(results.map(r => [`${r.leadId}_${r.stage}`, r]))

    // 5. Build response with messages
    const day3 = []
    const day7 = []
    const day14 = []
    let aiCount = 0
    let fallbackCount = 0

    for (const { lead, stage } of stagedLeads) {
      const result = resultMap.get(`${lead.id}_${stage}`)
      if (!result) continue
      if (result.source === 'ai') aiCount++; else fallbackCount++

      const niche = lead.niche ? lead.niche.toLowerCase() : null
      const item = {
        lead_id: lead.id,
        lead_name: lead.name || 'there',
        lead_phone: lead.phone,
        niche,
        stage,
        days_old: lead.daysOld,
        message: result.message,
      }
      if (stage === 'day3') day3.push(item)
      else if (stage === 'day7') day7.push(item)
      else day14.push(item)
    }

    return res.status(200).json({
      day3, day7, day14,
      summary: {
        total: day3.length + day7.length + day14.length,
        day3: day3.length,
        day7: day7.length,
        day14: day14.length,
        ai_generated: aiCount,
        fallback_used: fallbackCount,
      }
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
