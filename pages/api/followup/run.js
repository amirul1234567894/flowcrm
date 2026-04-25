// pages/api/followup/run.js
// n8n প্রতিদিন সকাল ১০টায় এই endpoint call করবে
// এটা check করবে কাদের follow-up বাকি আছে এবং list return করবে
// n8n তারপর WhatsApp message পাঠাবে

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = req.headers['x-webhook-secret']
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getServiceClient()
  const now = new Date()

  // Helper: days since created
  const daysSince = (dateStr) => {
    const d = new Date(dateStr)
    return Math.floor((now - d) / (1000 * 60 * 60 * 24))
  }

  // Get all active leads (not closed/lost)
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .not('status', 'in', '("Closed Won","Not Interested")')
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  const fu1_due = [] // day 1 follow-up
  const fu2_due = [] // day 3 follow-up
  const fu3_due = [] // day 7 follow-up

  for (const lead of leads) {
    const days = daysSince(lead.created_at)

    if (!lead.fu1_sent && days >= 1) fu1_due.push(lead)
    else if (lead.fu1_sent && !lead.fu2_sent && days >= 3) fu2_due.push(lead)
    else if (lead.fu2_sent && !lead.fu3_sent && days >= 7) fu3_due.push(lead)
  }

  return res.status(200).json({
    success: true,
    summary: {
      fu1_due: fu1_due.length,
      fu2_due: fu2_due.length,
      fu3_due: fu3_due.length,
      total: fu1_due.length + fu2_due.length + fu3_due.length,
    },
    fu1_due,
    fu2_due,
    fu3_due,
  })
}
