// pages/api/outreach/today.js
// Returns today's outreach queue grouped by niche.

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getServiceClient()
  const date = req.query.date || new Date().toISOString().slice(0,10)

  const { data, error } = await supabase
    .from('outreach_queue')
    .select('id,lead_id,lead_name,lead_phone,niche,message,status,sent_at,send_error,created_at')
    .eq('scheduled_for', date)
    .order('niche', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  const items   = data || []
  const summary = {
    total:   items.length,
    pending: items.filter(i => i.status === 'pending').length,
    sent:    items.filter(i => i.status === 'sent').length,
    skipped: items.filter(i => i.status === 'skipped').length,
    failed:  items.filter(i => i.status === 'failed').length,
    byNiche: items.reduce((acc, i) => {
      const k = (i.niche || 'other').toLowerCase().trim()
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {}),
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ items, summary, date })
}
