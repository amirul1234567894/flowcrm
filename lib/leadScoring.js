// lib/leadScoring.js
// Automatic lead scoring (0-100)
// Score is based on data completeness + source quality + niche value

/**
 * Scores a lead based on the data provided.
 * Higher score = more likely to convert / more valuable lead.
 *
 * @param {object} data - lead fields
 * @returns {number} score between 0 and 100
 */
export function scoreLeadData({ name, phone, email, website, source, niche }) {
  let score = 0

  // ── Data Completeness (up to 50 points) ──
  if (name?.trim())    score += 10  // has name
  if (phone?.trim())   score += 15  // has phone (high value - can call/WhatsApp)
  if (email?.trim())   score += 10  // has email
  if (website?.trim()) score += 10  // has website (means they're a real business)
  if (niche?.trim())   score += 5   // niche known = targeted outreach possible

  // ── Source Quality (up to 30 points) ──
  const sourceScores = {
    // High intent - they came to us
    'facebook':        25,
    'fb_lead_ad':      25,
    'instagram':       20,
    'website':         20,
    'landing_page':    25,
    'referral':        30, // referrals are gold

    // Scraped / outbound - lower intent
    'google_maps':     10,
    'google_search':   12,
    'yellowpages':     8,
    'justdial':        8,

    // Automation / bots
    'n8n':             15,
    'zapier':          15,
    'bot':             10,
    'api':             10,

    // Default
    'whatsapp':        20,
    'telegram':        15,
  }
  const src = source?.toLowerCase().trim()
  score += sourceScores[src] ?? 10 // default 10 for unknown sources

  // ── Niche Value Bonus (up to 20 points) ──
  // High-value niches that typically have bigger budgets
  const nicheBonus = {
    'hospital':     20,
    'clinic':       18,
    'doctor':       18,
    'law firm':     20,
    'lawyer':       20,
    'real estate':  18,
    'gym':          12,
    'salon':        10,
    'restaurant':   10,
    'ecommerce':    15,
    'agency':       15,
    'school':       12,
    'coaching':     14,
    'hotel':        14,
    'travel':       12,
    'logistics':    13,
    'it company':   16,
  }
  const n = niche?.toLowerCase().trim()
  if (n) {
    // Check for partial match
    for (const [key, bonus] of Object.entries(nicheBonus)) {
      if (n.includes(key) || key.includes(n)) {
        score += bonus
        break
      }
    }
  }

  // ── Cap at 100 ──
  return Math.min(100, Math.max(0, Math.round(score)))
}

/**
 * Get a label for a score
 */
export function getScoreLabel(score) {
  if (score >= 80) return { label: 'Hot 🔥', color: '#ef4444' }
  if (score >= 60) return { label: 'Warm 🌤️', color: '#f59e0b' }
  if (score >= 40) return { label: 'Medium', color: '#3b82f6' }
  return { label: 'Cold ❄️', color: '#6b7280' }
}
