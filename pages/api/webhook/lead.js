// pages/api/webhook/lead.js
// এই একটা endpoint সব source থেকে lead নেয়:
// - Landing page form
// - Facebook Lead Ads (n8n দিয়ে)
// - WhatsApp, Telegram, Instagram

import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Secret check
  const secret = req.headers['x-webhook-secret']
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { name, phone, source, notes, status, fb_lead_id, email } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  if (!phone?.trim()) return res.status(400).json({ error: 'phone is required' })

  const supabase = getServiceClient()

  // Duplicate check for Facebook Lead Ads
  if (fb_lead_id) {
    const { data: existing } = await supabase
      .from('leads').select('id').eq('fb_lead_id', fb_lead_id).single()
    if (existing) return res.status(200).json({ success: true, duplicate: true, message: 'Lead already exists' })
  }

  // Insert lead
  const { data: lead, error } = await supabase
    .from('leads')
    .insert([{
      name: name.trim(),
      phone: phone.trim(),
      source: source || 'Website',
      status: status || 'New Lead',
      notes: notes?.trim() || (email ? `Email: ${email}` : ''),
      fb_lead_id: fb_lead_id || null,
      last_contact: new Date().toISOString().slice(0, 10),
    }])
    .select().single()

  if (error) {
    console.error('Insert error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Save first outgoing message log
  await supabase.from('messages').insert([{
    lead_id: lead.id,
    direction: 'out',
    channel: 'whatsapp',
    text: `Hi ${name}! Thanks for reaching out. We help businesses save 10-20 hours/week with automation. What's your biggest pain point right now?`,
  }])

  return res.status(200).json({ success: true, lead })
}
