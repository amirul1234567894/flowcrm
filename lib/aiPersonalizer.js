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
const NICHE_CONTEXT = {
  clinic:     { pain: 'missed appointments, manual reminder calls, no-shows',                    benefit: 'auto appointment reminders, follow-up confirmations' },
  hospital:   { pain: 'patient communication at scale, appointment management, manual SMS costs', benefit: 'automated patient communication, reminders, reports' },
  dental:     { pain: 'missed appointments, recall reminders, treatment follow-ups',              benefit: 'auto recall reminders, treatment follow-ups, no-show reduction' },
  gym:        { pain: 'member churn, renewal drop-offs, weak follow-up',                          benefit: 'auto renewal reminders, miss-you messages, birthday offers' },
  salon:      { pain: 'one-time customers, no repeat visits, manual reminders',                   benefit: 'thank-you messages, repeat offers, appointment reminders' },
  spa:        { pain: 'customer retention, booking management, manual outreach',                  benefit: 'auto booking confirmations, retention campaigns' },
  restaurant: { pain: 'low repeat customers, no order follow-up, paid ads dependency',            benefit: 'order confirmations, miss-you offers, weekly specials' },
  cafe:       { pain: 'customer retention, manual marketing, loyalty tracking',                   benefit: 'loyalty messages, weekly specials, repeat-visit offers' },
  hotel:      { pain: 'booking confirmation calls, guest follow-ups, review requests',            benefit: 'auto booking confirmations, check-in reminders, review nudges' },
  school:     { pain: 'parent communication, fee reminders, attendance notifications',            benefit: 'auto parent notifications, fee reminders, event broadcasts' },
  coaching:   { pain: 'class reminders, fee follow-ups, student engagement',                      benefit: 'class reminders, fee notifications, parent updates' },
  ecommerce:  { pain: 'cart abandonment, order updates, customer retention',                      benefit: 'cart recovery messages, order updates, repeat-buyer offers' },
  real_estate:{ pain: 'lead follow-up, site visit reminders, manual nurturing',                   benefit: 'auto lead nurturing, site visit reminders, drip campaigns' },
  realtor:    { pain: 'lead follow-up, site visit reminders, manual nurturing',                   benefit: 'auto lead nurturing, site visit reminders, drip campaigns' },
  law:        { pain: 'client follow-up, appointment management, document reminders',             benefit: 'auto client reminders, appointment confirmations' },
  lawyer:     { pain: 'client follow-up, appointment management, consultation reminders',         benefit: 'auto client reminders, consultation confirmations' },
  travel:     { pain: 'booking follow-ups, itinerary delivery, customer support load',            benefit: 'auto itinerary delivery, booking reminders, support automation' },
  logistics:  { pain: 'delivery updates, customer queries, dispatch notifications',               benefit: 'auto delivery updates, dispatch alerts, customer notifications' },
  it:         { pain: 'lead nurturing, demo follow-ups, sales cycle length',                      benefit: 'auto lead nurturing, demo reminders, follow-up sequences' },
  agency:     { pain: 'client communication, project updates, reporting cadence',                 benefit: 'auto client updates, weekly reports, communication automation' },
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

  // Context section gives AI specific pain/benefit to anchor on
  const contextSection = context
    ? `Industry context:
- Common pain points in this industry: ${context.pain}
- What we help with: ${context.benefit}`
    : `This is a ${nicheText} business. Tailor the message to their likely WhatsApp automation needs.`

  // Language-specific instructions
  const languageInstructions = language === 'hinglish'
    ? `LANGUAGE: HINGLISH (Hindi-English mix in Roman script, no Devanagari).
This is critical — the message MUST be written in natural Hinglish like a real Indian person typing on WhatsApp.

Hinglish examples (study these patterns):
- "Main Sami hoon — chhote clinics ko WhatsApp automation mein help karta hoon"
- "Aapke clinic mein appointment confirm karne ke liye manually call karna padta hai?"
- "WhatsApp pe ek simple setup se ye sab automatic ho jaata hai"
- "Agar interested ho to ek 2-minute ka demo video bhej sakta hoon"
- "Bas 'yes' reply kar dijiye"

Rules for Hinglish:
- Use "aap" (formal you), not "tu/tum"
- Use "main", "mera", "humara" naturally
- Mix English business terms (WhatsApp, automation, demo, reminder) as-is
- Greeting: "Namaste [name]," or "Hello [name]," — NOT "Dear Sir"
- Sign-off: "— ${SENDER_NAME}" (same in both languages)
- Sound like a friendly Indian person, not a corporate broadcast`
    : `LANGUAGE: ENGLISH (professional but conversational).
- Greeting: "Hello [business name]," — NOT "Dear Sir/Madam" or "Hi there"
- Natural conversational tone, like one professional writing to another
- Avoid overly formal corporate language`

  return `You are writing a first-touch WhatsApp message from ${SENDER_NAME}, who runs a WhatsApp automation service for small businesses.

Recipient details:
- Business name: ${businessName}
- Industry/niche: ${nicheText}
${notesText}

${contextSection}

${languageInstructions}

Write a short WhatsApp message (max 100 words) that:
1. Opens with greeting + business name (per language rules above)
2. Introduces ${SENDER_NAME} naturally and what they do (WhatsApp automation for their specific industry)
3. Mentions ONE specific pain point relevant to their business — do NOT list multiple features
4. Asks if they'd want a 2-minute walkthrough — they should reply "yes" or "show me" to engage
5. Ends with "— ${SENDER_NAME}" signature on its own line

STRICT RULES:
- NO emojis whatsoever
- NO "Reply H or B" or language-switch prompts
- NO pricing mentioned
- NO fake statistics or made-up client names — keep it honest and grounded
- NO marketing buzzwords like "leverage", "synergy", "game-changer", "revolutionize"
- NO ALL-CAPS, NO excessive exclamation marks
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

  if (language === 'hinglish') {
    const greet = lead.name ? `Namaste ${lead.name}` : 'Namaste'
    const painLine = context
      ? `${nicheText} businesses ke saath aksar ek problem hoti hai — ${context.pain.split(',')[0]}.`
      : `Aksar ${nicheText} businesses customer follow-up manually karte hain, jo time-consuming hota hai.`

    return `${greet},

Main ${SENDER_NAME} hoon — chhote ${nicheText} businesses ke liye WhatsApp automation set up karta hoon.

${painLine} Ek simple WhatsApp setup se ye sab automatic ho jaata hai — koi staff effort nahi.

Agar interested ho to ek 2-minute ka demo video bhej sakta hoon. Bas "yes" reply kar dijiye.

Site: ${SITE}

— ${SENDER_NAME}`
  }

  // English fallback (professional niches + non-Indian leads)
  const greet = lead.name ? `Hello ${lead.name}` : 'Hello'
  const painLine = context
    ? `Most ${nicheText} businesses I work with struggle with ${context.pain.split(',')[0]}.`
    : `A lot of ${nicheText} businesses lose customers due to weak WhatsApp follow-up.`

  return `${greet},

I'm ${SENDER_NAME} — I help ${nicheText} businesses set up WhatsApp automation for customer communication.

${painLine} A simple WhatsApp setup can handle this automatically.

If you'd want to see how it works for a business like yours, reply "yes" and I'll send a 2-minute walkthrough.

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
