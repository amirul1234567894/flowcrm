// pages/api/leads/index.js
import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('leads').select('*').order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
    const { name, phone, source, status, notes } = req.body
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' })
    const { data, error } = await supabase
      .from('leads')
      .insert([{ name, phone, source: source || 'Website', status: status || 'New Lead', notes: notes || '', last_contact: new Date().toISOString().slice(0, 10) }])
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
