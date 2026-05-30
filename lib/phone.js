// lib/phone.js
// International-safe phone helpers for WhatsApp (Green API).
// Works for India (default) AND any foreign country with a country code.
//
// Rule: a number that already carries its country code (>=11 digits) is used
// as-is. A bare local 10-digit number gets DEFAULT_COUNTRY_CODE prepended.
// So: keep the country code on foreign numbers when scraping (Maps gives it).

const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '91' // backward-compat: bare 10-digit = India

// Digits only. Keeps the FULL international number (does not cut to last 10).
export function normalizePhone(phone) {
  if (!phone) return ''
  return String(phone).replace(/\D/g, '')
}

// Dedup key — last 10 digits. Same behaviour as before, so existing
// duplicate-prevention keeps working across India numbers with/without 91.
export function phoneKey(phone) {
  const d = normalizePhone(phone)
  return d.slice(-10)
}

// Loose, country-agnostic validity check.
// E.164 allows up to 15 digits; most real numbers are 8-15. Rejects junk.
export function isValidWhatsAppNumber(phone) {
  const d = normalizePhone(phone)
  if (d.length < 8 || d.length > 15) return false
  if (/^(\d)\1+$/.test(d)) return false                 // all same digit
  const junk = new Set(['1234567890', '0123456789', '9876543210'])
  if (junk.has(d)) return false
  return true
}

// Build the Green API number (no '+'): already has a country code → use as-is;
// a bare 10-digit local number → prepend DEFAULT_CC.
export function toWhatsAppNumber(phone) {
  const d = normalizePhone(phone)
  if (!d) return ''
  if (d.length <= 10) return DEFAULT_CC + d.slice(-10)  // local → add default country code
  return d                                              // already international
}
