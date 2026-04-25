// pages/api/leads/[id].js
import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()
  const { id } = req.query

  if (req.method === 'PATCH') {
    const updates = { ...req.body, updated_at: new Date().toISOString() }
    if (updates.status) updates.last_contact = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase.from('leads').update(updates).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
