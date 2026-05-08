// pages/api/whatsapp/send.js — Send WhatsApp via Green API
import { getServiceClient } from '../../../lib/supabase'

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

  const message = customMessage ||
    `Hi ${lead.name||'there'}! 👋 Thanks for reaching out to Autoflowa.\n\nWe help ${lead.niche||'your'} businesses save 10+ hours/week with smart automation.\n\nOur team will be in touch shortly! 🚀\n\nhttps://www.autoflowa.in`

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
