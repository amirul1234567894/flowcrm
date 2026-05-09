// pages/api/outreach/[id].js
// PATCH  — update single queue item (edit message, mark sent/skipped)
// DELETE — remove from queue
//
// AUTO-SYNC on status='sent':
//   • outreach_queue.status = 'sent', sent_at = now
//   • leads.status: 'New Lead' → 'Contacted' (only if currently 'New Lead')
//   • leads.last_contact = today
//   • messages: insert outbound entry (so it appears in CRM Inbox history)
//
// Note: No "POST /send" endpoint because user uses WhatsApp Business App (phone),
// which doesn't support API send. Frontend uses wa.me/intent link and user presses
// Send manually, then taps "Mark Sent" → triggers this PATCH.

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()
  const { id } = req.query

  if (!id) return res.status(400).json({ error: 'id required' })

  // ── PATCH: update message text or status ──────────────────────────
  if (req.method === 'PATCH') {
    const { message, status } = req.body

    // Build updates
    const updates = {}
    if (message !== undefined) updates.message = message
    if (status  !== undefined) {
      updates.status = status
      if (status === 'sent') updates.sent_at = new Date().toISOString()
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'nothing to update' })
    }

    // 1. Update outreach_queue row
    const { data: queueRow, error: qErr } = await supabase
      .from('outreach_queue')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (qErr) return res.status(500).json({ error: qErr.message })

    // 2. ── AUTO-SYNC on status='sent' ────────────────────────────────
    //    Update leads row + log to messages table
    if (status === 'sent' && queueRow.lead_id) {
      const today = new Date().toISOString().slice(0, 10)

      // Fetch current lead status — only auto-promote 'New Lead' → 'Contacted'
      // Don't downgrade leads that are already further along (Interested, Demo Booked, etc.)
      const { data: lead } = await supabase
        .from('leads')
        .select('id,status')
        .eq('id', queueRow.lead_id)
        .single()

      if (lead) {
        const leadUpdates = { last_contact: today }
        if (lead.status === 'New Lead') {
          leadUpdates.status = 'Contacted'
        }
        // Don't fail the whole request if lead update fails — log and continue
        const { error: lErr } = await supabase
          .from('leads')
          .update(leadUpdates)
          .eq('id', queueRow.lead_id)
        if (lErr) console.error('lead sync failed:', lErr.message)
      }

      // 3. Log to messages table — appears in CRM Inbox so you have history
      try {
        await supabase
          .from('messages')
          .insert([{
            lead_id:   queueRow.lead_id,
            direction: 'out',
            channel:   'whatsapp',
            text:      queueRow.message,
            // created_at defaults to now()
          }])
      } catch(e) {
        // messages table insert isn't critical — don't fail the user's action
        console.error('message log failed:', e.message)
      }
    }

    return res.status(200).json(queueRow)
  }

  // ── DELETE: remove from queue ─────────────────────────────────────
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('outreach_queue').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
