// pages/api/messages/index.js
import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()

  if (req.method === 'GET') {
    const { lead_id } = req.query
    let q = supabase.from('messages').select('*').order('created_at', { ascending: true })
    if (lead_id) q = q.eq('lead_id', lead_id)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
    const { lead_id, direction, text, channel } = req.body
    if (!lead_id || !text) return res.status(400).json({ error: 'lead_id and text required' })
    const { data, error } = await supabase
      .from('messages')
      .insert([{ lead_id, direction: direction || 'out', text, channel: channel || 'whatsapp' }])
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    await supabase.from('leads').update({ last_contact: new Date().toISOString().slice(0, 10) }).eq('id', lead_id)
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
