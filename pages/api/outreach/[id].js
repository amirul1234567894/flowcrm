// pages/api/outreach/[id].js
// PATCH  — update single queue item (edit message, mark sent/skipped)
// DELETE — remove from queue
//
// Note: We don't have a "POST /send" endpoint because user uses WhatsApp Business App
// (phone app) which doesn't support API send. Frontend uses wa.me link and user
// manually presses Send in the app.

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()
  const { id } = req.query

  if (!id) return res.status(400).json({ error: 'id required' })

  // ── PATCH: update message text or status ──────────────────────────
  if (req.method === 'PATCH') {
    const { message, status } = req.body
    const updates = {}
    if (message !== undefined) updates.message = message
    if (status  !== undefined) {
      updates.status = status
      if (status === 'sent') updates.sent_at = new Date().toISOString()
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'nothing to update' })
    }
    const { data, error } = await supabase
      .from('outreach_queue')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  // ── DELETE: remove from queue ─────────────────────────────────────
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('outreach_queue').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
