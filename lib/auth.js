// lib/auth.js
// API Key validation for the intake endpoint
// Supports: single key OR multiple keys (comma-separated in env)

/**
 * Validates API key from request headers.
 * Accepts two header formats:
 *   Authorization: Bearer <key>
 *   x-api-key: <key>
 *
 * @returns null if valid, error string if invalid
 */
export function validateApiKey(req) {
  // If no API key is configured, skip auth (dev mode)
  if (!process.env.INTAKE_API_KEYS) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[AUTH] WARNING: No INTAKE_API_KEYS set in production!')
    }
    return null // allow through in dev
  }

  // Extract key from header
  let providedKey = null

  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim()
  } else if (req.headers['x-api-key']) {
    providedKey = req.headers['x-api-key'].trim()
  }

  if (!providedKey) {
    return 'API key required. Send as "Authorization: Bearer <key>" or "x-api-key: <key>"'
  }

  // Support multiple valid keys (comma-separated in env)
  const validKeys = process.env.INTAKE_API_KEYS
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)

  if (!validKeys.includes(providedKey)) {
    return 'Invalid API key'
  }

  return null // valid
}
