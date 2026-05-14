// pages/api/whatsapp/send.js — Send WhatsApp via Green API
//
// v2 update: Default fallback message is now plain text (no emojis,
// no banner). Uses SENDER_NAME env var for consistent identity across
// outreach, follow-ups, and direct sends.

import { getServiceClient } from '../../../lib/supabase'

const SENDER_NAME = process.env.SENDER_NAME || 'Sami'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { lead_id, message: customMessage } = req.body
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' })

  const supabase = getServiceClient()
  const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).single()
  if (!lead) return res.status(404).json({ error: 'Lead not found' })

  const phone = lead.phone?.replace(/\D/g, '')
  if (!phone || phone.length < 10) return res.status(400).json({ error: 'Invalid phone' })
  const formatted = phone.startsWith('91') && phone.length === 12 ? phone : '91' + phone.slice(-10)

  const INSTANCE_ID    = process.env.GREEN_API_INSTANCE_ID
  const INSTANCE_TOKEN = process.env.GREEN_API_TOKEN
  const API_URL        = process.env.GREEN_API_URL || 'https://7107.api.greenapi.com'
  if (!INSTANCE_ID || !INSTANCE_TOKEN) return res.status(500).json({ error: 'Green API not configured' })

  // Default fallback message — plain, no emoji, no banner.
  // This is rare path (only when customMessage not provided).
  const SITE = process.env.MARKETING_SITE_URL || 'https://www.autoflowa.in'
  const message = customMessage ||
    `Hello ${lead.name || 'there'},

Thanks for reaching out. I'm ${SENDER_NAME} — I'll get back to you shortly with details on how we can help your ${lead.niche || 'business'}.

If you'd like a quick look in the meantime: ${SITE}

— ${SENDER_NAME}`

  try {
    const resp = await fetch(`${API_URL}/waInstance${INSTANCE_ID}/sendMessage/${INSTANCE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: formatted + '@c.us', message })
    })
    const result = await resp.json()
    if (!resp.ok) return res.status(500).json({ error: result.error || 'Send failed' })

    // Log message + update last_contact
    await Promise.all([
      supabase.from('messages').insert([{ lead_id, direction:'out', channel:'whatsapp', text:message }]),
      supabase.from('leads').update({ last_contact: new Date().toISOString().slice(0,10) }).eq('id', lead_id)
    ])
    return res.status(200).json({ success: true, message_id: result.idMessage, phone: formatted })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
