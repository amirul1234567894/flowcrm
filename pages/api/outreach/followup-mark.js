// pages/api/outreach/followup-mark.js
// POST — mark a follow-up message as "sent" for a specific lead.
//
// Body: { lead_id, stage: 'day3'|'day7'|'day14', message: '...' }
//
// What it does:
//   1. Update leads.fu1_sent / fu2_sent / fu3_sent + timestamp
//   2. Log to messages table (so it appears in CRM Inbox)
//   3. Update last_contact = today

import { getServiceClient } from '../../../lib/supabase'

const STAGE_FIELDS = {
  day3:  { flag: 'fu1_sent', ts: 'fu1_sent_at' },
  day7:  { flag: 'fu2_sent', ts: 'fu2_sent_at' },
  day14: { flag: 'fu3_sent', ts: 'fu3_sent_at' },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lead_id, stage, message } = req.body || {}
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' })
  if (!STAGE_FIELDS[stage]) return res.status(400).json({ error: 'invalid stage' })

  const supabase = getServiceClient()
  const now   = new Date().toISOString()
  const today = now.slice(0,10)
  const { flag, ts } = STAGE_FIELDS[stage]

  try {
    // 1. Update lead's follow-up flag
    const leadUpdates = {
      [flag]: true,
      [ts]: now,
      last_contact: today,
    }
    const { error: lErr } = await supabase
      .from('leads')
      .update(leadUpdates)
      .eq('id', lead_id)
    if (lErr) return res.status(500).json({ error: lErr.message })

    // 2. Log to messages table (best-effort, don't block on failure)
    if (message) {
      try {
        await supabase
          .from('messages')
          .insert([{
            lead_id,
            direction: 'out',
            channel:   'whatsapp',
            text:      message,
          }])
      } catch(e) {
        console.error('message log failed:', e.message)
      }
    }

    return res.status(200).json({ success: true, stage, lead_id })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
