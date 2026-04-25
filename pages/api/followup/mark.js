// pages/api/followup/mark.js
// n8n WhatsApp message পাঠানোর পর এই endpoint call করে mark করে

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secret = req.headers['x-webhook-secret']
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { lead_id, fu_day } = req.body // fu_day = 1, 3, or 7

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
    channel: 'whatsapp',
  }])

  // Save message log
  const msgMap = {
    1: "Hey! Just checking in 👋 Did you get a chance to think about automation for your business?",
    3: "Hi! Quick follow-up 😊 We helped a client save 3 hours/day last week. Want to see how? Reply 'DEMO'",
    7: "Last message from me 🙏 If you're ever ready to automate your business, we're here. Reply anytime!",
  }
  await supabase.from('messages').insert([{
    lead_id,
    direction: 'out',
    channel: 'whatsapp',
    text: msgMap[parseInt(fu_day)] || 'Follow-up sent',
  }])

  return res.status(200).json({ success: true })
}
