// lib/intakeLogger.js
// Logs every incoming lead to the intake_logs table
// This gives you a full audit trail: what came in, when, from where

import { getServiceClient } from './supabase'

/**
 * Log an intake event to the database.
 *
 * @param {object} opts
 * @param {'success'|'duplicate'|'error'|'rejected'} opts.status
 * @param {object} opts.body     - raw request body
 * @param {string} [opts.lead_id]
 * @param {string} [opts.existing_id]
 * @param {string} [opts.error]
 */
export async function logIntake({ status, body, lead_id, existing_id, error }) {
  try {
    const supabase = getServiceClient()

    // Sanitize: don't log sensitive data
    const safeBody = {
      name:    body.name,
      phone:   body.phone ? `${body.phone.slice(0, 4)}****` : null, // mask phone
      email:   body.email ? `${body.email.split('@')[0].slice(0, 2)}***@${body.email.split('@')[1]}` : null,
      source:  body.source,
      niche:   body.niche,
      website: body.website,
      tags:    body.tags,
    }

    await supabase.from('intake_logs').insert([{
      status,
      source:      body.source || 'unknown',
      lead_id:     lead_id || null,
      existing_id: existing_id || null,
      error_msg:   error || null,
      payload:     safeBody, // JSONB column
    }])
  } catch (e) {
    // Don't let logging errors break the main flow
    console.error('[INTAKE LOGGER] Failed to log:', e.message)
  }
}
