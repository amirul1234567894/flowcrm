// lib/aiPersonalizer.js
// === Layer 3: AI-Powered Per-Lead Personalization ===
//
// Purpose: For each lead, generate a custom, human-sounding WhatsApp message
// using Groq API (free, fast, llama models). Each message is tailored to the
// lead's specific niche, name, notes, and source.
//
// Why Groq?
//   - Free tier: 30 req/min, 14,400 req/day → plenty for 12 msg/day workflow
//   - Fast: ~500ms per request (vs OpenAI ~2s)
//   - Already used in this codebase (score-lead.js)
//
// Strategy:
//   1. Build a STRICT prompt that produces consistent output structure
//   2. Use temperature=0.7 for natural variation (not robotic)
//   3. Inject lead's actual data — niche, name, notes — for relevance
//   4. ALWAYS have a fallback template if AI fails (don't break the pipeline)
//   5. Output is plain text, no emoji, no banner, signed by SENDER_NAME
//
// SAFETY:
//   - Never let AI output > 200 words (prompt-enforced + post-check)
//   - Never let AI mention false stats/clients (prompt-enforced)
//   - Strip any markdown/emoji that slips through (post-process)

const SENDER_NAME = process.env.SENDER_NAME || 'Sami'
const SITE = process.env.MARKETING_SITE_URL || 'https://www.autoflowa.in/'

// === Niche categories with pain-point + benefit cheat-sheet ===
// Used to enrich AI prompts with niche-specific context.
// AI uses this to generate relevant messaging without us hardcoding templates.
//
// Each niche has multiple pain points + services that go beyond just WhatsApp.
// AI will pick the most relevant ONE per message based on lead context.
// Services include: WhatsApp automation, email automation, lead scraping,
// CRM automation, reporting automation, AI agents, workflow automation, etc.
const NICHE_CONTEXT = {
  clinic:     { pain: 'missed appointments, manual reminder calls, patient data entry, appointment scheduling',                services: 'WhatsApp appointment reminders, patient follow-up automation, online booking system, patient CRM, review collection automation' },
  hospital:   { pain: 'patient communication at scale, manual SMS costs, fragmented systems, report distribution',             services: 'patient communication automation, lab report delivery automation, staff scheduling, automated insurance follow-ups, dashboard reporting' },
  dental:     { pain: 'missed appointments, recall reminders, treatment follow-ups, manual scheduling',                        services: 'auto recall reminders, treatment follow-up automation, online booking integration, patient retention campaigns' },
  gym:        { pain: 'member churn, renewal drop-offs, lead follow-up gaps, attendance tracking',                            services: 'WhatsApp renewal reminders, member onboarding automation, lead nurturing, class booking automation, attendance reports' },
  salon:      { pain: 'one-time customers, no repeat visits, manual booking, missed follow-ups',                              services: 'WhatsApp appointment reminders, customer retention automation, online booking, birthday offer campaigns' },
  spa:        { pain: 'customer retention, manual booking management, package tracking',                                       services: 'auto booking confirmations, retention campaigns, package renewal reminders, review collection' },
  restaurant: { pain: 'low repeat orders, manual order management, marketing campaign effort, customer feedback',              services: 'WhatsApp order automation, customer retention campaigns, review collection automation, menu update automation' },
  cafe:       { pain: 'customer retention, manual loyalty tracking, social media effort',                                      services: 'loyalty automation, social media scheduling, customer retention messaging' },
  hotel:      { pain: 'manual booking follow-ups, guest communication, review requests, OTA management',                       services: 'booking confirmation automation, pre-arrival messaging, review request automation, OTA sync automation' },
  school:     { pain: 'parent communication overhead, manual fee tracking, attendance notifications, admission inquiries',     services: 'parent communication automation, fee reminder automation, attendance notification, admission inquiry follow-up' },
  coaching:   { pain: 'class reminders, fee follow-ups, student engagement, lead conversion',                                  services: 'class reminder automation, fee tracking automation, parent updates, lead nurturing for new admissions' },
  ecommerce:  { pain: 'cart abandonment, manual order updates, customer support load, repeat purchases',                       services: 'cart recovery automation, order tracking automation, AI support agents, customer retention campaigns, inventory reporting' },
  real_estate:{ pain: 'lead follow-up gaps, site visit reminders, manual data entry, listing distribution',                    services: 'lead nurturing automation, site visit reminder automation, CRM integration, listing distribution automation' },
  realtor:    { pain: 'lead follow-up gaps, site visit reminders, manual nurturing',                                           services: 'auto lead nurturing, site visit reminders, drip email campaigns, CRM automation' },
  law:        { pain: 'client follow-up, document tracking, consultation scheduling, billing reminders',                       services: 'client reminder automation, document deadline tracking, consultation booking, automated billing follow-ups' },
  lawyer:     { pain: 'client follow-up, appointment management, consultation reminders, document deadlines',                  services: 'client reminder automation, consultation booking, document deadline alerts, intake form automation' },
  travel:     { pain: 'booking follow-ups, itinerary delivery, customer support load, repeat bookings',                        services: 'itinerary delivery automation, booking reminders, support automation, customer retention campaigns' },
  logistics:  { pain: 'delivery updates, customer queries, dispatch coordination, manual tracking',                            services: 'delivery update automation, dispatch alerts, customer notification system, tracking automation' },
  it:         { pain: 'lead nurturing, demo follow-ups, sales cycle length, customer onboarding',                             services: 'lead nurturing automation, demo follow-up sequences, customer onboarding automation, internal reporting automation' },
  agency:     { pain: 'client communication overhead, project updates, manual reporting, lead generation',                     services: 'client update automation, weekly reporting automation, lead generation scraping, project status notifications' },
}

// Try to match lead's niche to a known context category.
// Returns the matched key, or null if no match (AI will handle generically).
function matchNicheCategory(niche, name = '', notes = '') {
  const haystack = `${niche || ''} ${name || ''} ${notes || ''}`.toLowerCase()
  // Order matters — more specific first
  const orderedKeys = ['dental', 'hospital', 'real_estate', 'realtor', 'lawyer', 'law', 'logistics', 'ecommerce',
                       'coaching', 'school', 'travel', 'agency', 'salon', 'spa', 'gym', 'cafe', 'restaurant',
                       'hotel', 'clinic', 'it']
  for (const key of orderedKeys) {
    const variants = key === 'real_estate' ? ['real estate', 'realty', 'realtor', 'property'] : [key]
    if (variants.some(v => haystack.includes(v))) return key
  }
  return null
}

// === Language strategy per niche ===
// Indian business owners respond better to Hinglish for mass-market businesses
// (salon, gym, small restaurant, small clinic). Professional/B2B segments
// (hospital, IT, law, agency) respond better to English.
//
// FUTURE: When user adds non-India leads, this same logic extends —
// just add country detection from lead.country or lead.notes if present.
const HINGLISH_NICHES = new Set([
  'salon', 'spa', 'gym', 'restaurant', 'cafe', 'clinic', 'dental',
  'coaching', 'school'
])
const ENGLISH_NICHES = new Set([
  'hospital', 'hotel', 'law', 'lawyer', 'real_estate', 'realtor',
  'ecommerce', 'travel', 'logistics', 'it', 'agency'
])

// Detect if lead is from India based on phone (default assumption: yes for now)
// Future-proof: when international leads come, this will return false for them
function isIndianLead(lead) {
  // Indian mobile: starts with 6,7,8,9 and is 10 digits (or 12 with 91 prefix)
  const digits = String(lead.phone || '').replace(/\D/g, '')
  if (digits.length === 10 && /^[6-9]/.test(digits)) return true
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return true
  if (digits.length === 13 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(3))) return true
  return false  // non-Indian (US/UK/UAE/etc.) → use English
}

// Pick language for this specific lead
function pickLanguage(lead) {
  // Non-Indian → always English
  if (!isIndianLead(lead)) return 'english'

  // Indian → check niche category
  const nicheCat = matchNicheCategory(lead.niche, lead.name, lead.notes)
  if (nicheCat && ENGLISH_NICHES.has(nicheCat)) return 'english'
  if (nicheCat && HINGLISH_NICHES.has(nicheCat)) return 'hinglish'

  // Unknown Indian niche → default to Hinglish (broader appeal)
  return 'hinglish'
}

// === Build the AI prompt for a single lead ===
// This is the most important function. The prompt structure determines quality.
function buildPrompt(lead) {
  const nicheCat = matchNicheCategory(lead.niche, lead.name, lead.notes)
  const context = nicheCat ? NICHE_CONTEXT[nicheCat] : null
  const language = pickLanguage(lead)

  const businessName = lead.name || 'business'
  const nicheText    = lead.niche || 'business'
  const notesText    = lead.notes ? `Additional context: ${lead.notes}` : ''

  // Context section gives AI specific pain/services to anchor on.
  // AI is told to pick ONE specific pain and ONE related service — not list all.
  const contextSection = context
    ? `Industry context for ${nicheText}:
- Common pain points in this industry: ${context.pain}
- Services we can offer (pick ONE most relevant to mention): ${context.services}

IMPORTANT: Pick ONE specific pain + ONE service that matches it. Do NOT list multiple services. Different leads should highlight different services so messages feel tailored.`
    : `This is a ${nicheText} business. Tailor the message to their likely business automation needs.
We offer: WhatsApp automation, email automation, lead generation, CRM automation,
workflow automation, AI agents, reporting automation, data scraping, custom integrations.
Pick ONE that fits this business type best.`

  // Language-specific instructions
  const languageInstructions = language === 'hinglish'
    ? `LANGUAGE: HINGLISH (Hindi-English mix in Roman script, no Devanagari).
This is critical — the message MUST be written in natural Hinglish like a real Indian person typing on WhatsApp.

Hinglish examples (study these patterns):
- "Main Sami hoon — chhote businesses ke liye automation systems banata hoon"
- "Aapke business mein customer follow-up manually karna padta hai?"
- "Ek simple automation se ye kaam aap khud kar sakte ho, koi staff effort nahi"
- "Agar interested ho to ek 2-minute ka demo video bhej sakta hoon"
- "Bas 'yes' reply kar dijiye"

Rules for Hinglish:
- Use "aap" (formal you), not "tu/tum"
- Use "main", "mera", "humara" naturally
- Mix English business terms (automation, CRM, demo, reminder, workflow, AI, lead) as-is
- Greeting: "Namaste [name]," or "Hello [name]," — NOT "Dear Sir"
- Sign-off: "— ${SENDER_NAME}" (same in both languages)
- Sound like a friendly Indian person, not a corporate broadcast`
    : `LANGUAGE: ENGLISH (professional but conversational).
- Greeting: "Hello [business name]," — NOT "Dear Sir/Madam" or "Hi there"
- Natural conversational tone, like one professional writing to another
- Avoid overly formal corporate language`

  return `You are writing a first-touch WhatsApp message from ${SENDER_NAME}, who runs a business automation agency in India. The agency builds custom automation for small businesses — including WhatsApp automation, email automation, lead generation/scraping, CRM automation, workflow automation, AI agents, reporting dashboards, and custom integrations.

Recipient details:
- Business name: ${businessName}
- Industry/niche: ${nicheText}
${notesText}

${contextSection}

${languageInstructions}

Write a short WhatsApp message (max 100 words) that:
1. Opens with greeting + business name (per language rules above)
2. Introduces ${SENDER_NAME} as someone who builds automation for businesses (NOT only WhatsApp — could be any automation relevant to their industry)
3. Mentions ONE specific pain point relevant to their business AND ONE specific automation service that solves it
4. Asks if they'd want a 2-minute walkthrough — they should reply "yes" or "show me" to engage
5. Ends with "— ${SENDER_NAME}" signature on its own line

STRICT RULES:
- NO emojis whatsoever
- NO "Reply H or B" or language-switch prompts
- NO pricing mentioned
- NO fake statistics or made-up client names — keep it honest and grounded
- NO marketing buzzwords like "leverage", "synergy", "game-changer", "revolutionize"
- NO ALL-CAPS, NO excessive exclamation marks
- DO NOT default to mentioning "WhatsApp automation" for every lead — vary services based on what fits the niche best
- Sound like a real human typing on WhatsApp, not a brochure

Output ONLY the message text. No preamble like "Here is the message:" or markdown formatting. Just the message itself, ready to send.`
}

// === Post-process AI output to enforce safety rules ===
// Strips emoji, normalizes whitespace, validates length.
function cleanAIOutput(text) {
  if (!text || typeof text !== 'string') return null
  let cleaned = text.trim()

  // Strip common preambles AI sometimes adds
  cleaned = cleaned.replace(/^(here'?s? (is )?the message:?|message:?|output:?)\s*/i, '')

  // Strip markdown bold/italic markers (AI sometimes wraps phrases)
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')

  // Strip code-block fences if AI used them
  cleaned = cleaned.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '')

  // Strip emojis (covers most ranges — astral plane chars)
  cleaned = cleaned.replace(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/gu, '')

  // Strip "Reply H or B" garbage if AI ignored instructions and added it anyway.
  // Handles parenthesized AND unparenthesized variants in any language combo.
  cleaned = cleaned.replace(/\(\s*prefer\s+(hindi|bangla|bengali)[\s\S]{0,200}?(switch|happy)[!.]*\s*\)/gi, '')
  cleaned = cleaned.replace(/prefer\s+(hindi|bangla|bengali)[\s\S]{0,200}?(switch|happy)[!.]*/gi, '')
  cleaned = cleaned.replace(/reply\s+["']?[hb]["']?\s+or\s+["']?[hb]["']?[\s\S]{0,50}?(switch|happy)[!.]*/gi, '')

  // Collapse multiple blank lines to max 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  // Validate: must contain SENDER_NAME signature
  if (!cleaned.toLowerCase().includes(SENDER_NAME.toLowerCase())) {
    // AI forgot to sign — add it
    cleaned += `\n\n— ${SENDER_NAME}`
  }

  // Validate length — if too long (over 200 words), reject (use fallback)
  const wordCount = cleaned.split(/\s+/).length
  if (wordCount > 200) return null
  if (wordCount < 20) return null  // too short = probably bad output

  return cleaned
}

// === Fallback template (used if Groq fails or returns invalid output) ===
// Language-aware fallback — matches the same Hinglish/English split as AI prompts.
// This is the safety net — same quality as Layer 1 fixed templates.
function fallbackTemplate(lead) {
  const nicheText = lead.niche || 'business'
  const nicheCat = matchNicheCategory(lead.niche, lead.name, lead.notes)
  const context = nicheCat ? NICHE_CONTEXT[nicheCat] : null
  const language = pickLanguage(lead)

  // Pick the FIRST service from context.services (or a generic one)
  // This is a fallback only - AI normally varies which service to mention.
  // Using a deterministic pick based on lead.id so same lead always gets
  // same fallback message (no inconsistency on retries).
  const firstService = context
    ? context.services.split(',')[0].trim()
    : 'workflow automation'
  const firstPain = context
    ? context.pain.split(',')[0].trim()
    : 'manual repetitive work'

  if (language === 'hinglish') {
    const greet = lead.name ? `Namaste ${lead.name}` : 'Namaste'

    return `${greet},

Main ${SENDER_NAME} hoon — chhote businesses ke liye automation systems banata hoon (WhatsApp, email, CRM, lead generation, AI agents, workflow automation — jo bhi business ko chahiye).

${nicheText} businesses ke saath aksar ek common problem hoti hai — ${firstPain}. Iske liye ${firstService} ek simple solution hai, jo manually time-consuming kaam ko automate kar deta hai.

Agar interested ho to ek 2-minute ka demo video bhej sakta hoon. Bas "yes" reply kar dijiye.

Site: ${SITE}

— ${SENDER_NAME}`
  }

  // English fallback (professional niches + non-Indian leads)
  const greet = lead.name ? `Hello ${lead.name}` : 'Hello'

  return `${greet},

I'm ${SENDER_NAME} — I build business automation systems for small companies. This includes WhatsApp automation, email automation, lead generation, CRM workflows, AI agents, and custom integrations.

Most ${nicheText} businesses I see deal with ${firstPain}. ${firstService.charAt(0).toUpperCase() + firstService.slice(1)} typically solves this without adding staff overhead.

If you'd want to see how this could work for your business, reply "yes" and I'll send a 2-minute walkthrough.

Site: ${SITE}

— ${SENDER_NAME}`
}

// === Main entry: generate a personalized message for one lead ===
// Returns: { message: string, source: 'ai' | 'fallback', error?: string }
export async function generatePersonalizedMessage(lead) {
  const GROQ_KEY = process.env.GROQ_API_KEY

  // No API key → use fallback (Layer 1 templates)
  if (!GROQ_KEY) {
    return { message: fallbackTemplate(lead), source: 'fallback', error: 'no_api_key' }
  }

  try {
    const prompt = buildPrompt(lead)

    // Race against timeout — don't let one lead block the whole batch
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)  // 8s max per request

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        // llama-3.3-70b-versatile — better quality than 8b-instant for nuanced writing
        // Falls within free tier limits for 12 msg/day usage
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        temperature: 0.7,   // some variation, but not too random
        messages: [
          {
            role: 'system',
            content: 'You write short, human-sounding WhatsApp messages for a B2B service. You never use marketing buzzwords, fake stats, emojis, or generic openings. You output only the message text, nothing else.'
          },
          { role: 'user', content: prompt }
        ]
      })
    })
    clearTimeout(timeoutId)

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      return { message: fallbackTemplate(lead), source: 'fallback', error: `groq_${resp.status}_${errBody.slice(0, 100)}` }
    }

    const data = await resp.json()
    const aiText = data?.choices?.[0]?.message?.content
    const cleaned = cleanAIOutput(aiText)

    if (!cleaned) {
      return { message: fallbackTemplate(lead), source: 'fallback', error: 'invalid_output' }
    }

    return { message: cleaned, source: 'ai' }
  } catch (e) {
    return { message: fallbackTemplate(lead), source: 'fallback', error: e.name === 'AbortError' ? 'timeout' : e.message }
  }
}

// === Batch generator with concurrency control ===
// Groq free tier = 30 req/min. We process in batches of 5 with delay
// so we never hit rate limits even on bursty days.
export async function generateMessagesForLeads(leads, opts = {}) {
  const batchSize = opts.batchSize || 5
  const delayMs   = opts.delayMs   || 2000   // 2s between batches → safe under 30/min
  const results = []

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(lead => generatePersonalizedMessage(lead).then(r => ({ leadId: lead.id, ...r })))
    )
    results.push(...batchResults)

    // Delay before next batch (unless this was the last batch)
    if (i + batchSize < leads.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }

  return results
}
