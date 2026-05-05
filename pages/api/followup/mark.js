// pages/api/followup/mark.js  (v2 — email channel)
// n8n email পাঠানোর পর এই endpoint call করে mark করে

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secret = req.headers['x-webhook-secret']
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { lead_id, fu_day, channel = 'email' } = req.body  // channel default → 'email'

  if (!lead_id || !fu_day) return res.status(400).json({ error: 'lead_id and fu_day required' })

  const supabase = getServiceClient()
  const now = new Date().toISOString()

  const updates = { updated_at: now, last_contact: now.slice(0, 10) }
  if (fu_day === 1 || fu_day === '1') { updates.fu1_sent = true; updates.fu1_sent_at = now }
  if (fu_day === 3 || fu_day === '3') { updates.fu2_sent = true; updates.fu2_sent_at = now }
  if (fu_day === 7 || fu_day === '7') { updates.fu3_sent = true; updates.fu3_sent_at = now }

  const { error: updateErr } = await supabase.from('leads').update(updates).eq('id', lead_id)
  if (updateErr) return res.status(500).json({ error: updateErr.message })

  // Log it
  await supabase.from('followup_logs').insert([{
    lead_id,
    fu_day: parseInt(fu_day),
    status: 'sent',
    channel,           // 'email' now
  }])

  // Email subject log (matches what was actually sent)
  const subjectMap = {
    1: "Did You Get a Chance to Think It Over? — AutoFlow",
    3: "Two Versions of Your Business. Which Is Yours? — AutoFlow",
    7: "My Last Message to You — AutoFlow",
  }
  await supabase.from('messages').insert([{
    lead_id,
    direction: 'out',
    channel: 'email',
    text: subjectMap[parseInt(fu_day)] || 'Follow-up email sent',
  }])

  return res.status(200).json({ success: true })
}
