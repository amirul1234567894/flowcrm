// pages/api/followup/run.js
// n8n প্রতিদিন সকাল ১০টায় এই endpoint call করবে
// এটা check করবে কাদের follow-up বাকি আছে এবং list return করবে
// n8n তারপর WhatsApp message পাঠাবে
//
// PERFORMANCE FIX:
//   পুরোনো version `select('*')` করে ১৭k rows pull করছিল — n8n cron timeout খাচ্ছিল।
//   এখন:
//     1. শুধু দরকারি columns fetch
//     2. created_at filter DB-level — শুধু relevant window-এর leads
//     3. fu3_sent=true leads আগেই বাদ — তাদের আর follow-up নেই
//     4. closed/lost আগেই বাদ DB level

import { getServiceClient } from '../../../lib/supabase'

const FU_COLUMNS = 'id,name,phone,email,niche,source,status,fu1_sent,fu2_sent,fu3_sent,created_at'

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

  const daysSince = (dateStr) => {
    const d = new Date(dateStr)
    return Math.floor((now - d) / (1000 * 60 * 60 * 24))
  }

  // Only leads ≥1 day old AND ≤45 days old.
  // After day 7 follow-up done, no more relevant — and we cap at 45d to avoid scanning ancient rows.
  const minDate = new Date(now.getTime() - 45 * 86400000).toISOString()
  const maxDate = new Date(now.getTime() -  1 * 86400000).toISOString()

  const { data: leads, error } = await supabase
    .from('leads')
    .select(FU_COLUMNS)
    .not('status', 'in', '("Closed Won","Not Interested")')
    .eq('fu3_sent', false)               // day-7 follow-up still pending
    .gte('created_at', minDate)
    .lte('created_at', maxDate)
    .order('created_at', { ascending: true })
    .limit(5000)                          // safety cap

  if (error) return res.status(500).json({ error: error.message })

  const fu1_due = []
  const fu2_due = []
  const fu3_due = []

  for (const lead of leads || []) {
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
