# FlowCRM v3.1 — AI Personalization + Smart Language Detection

## Bhai, ki ki update holo (latest)

**v3 (previous):** AI personalization, all niches, English only
**v3.1 (now):** Same + **automatic Hinglish/English detection per lead**

---

## Smart Language Logic

System automatically picks language per lead:

### Indian Leads (phone starts with 91 or [6-9])

| Niche Type | Language | Reasoning |
|------------|----------|-----------|
| **Mass-market casual** | **Hinglish** | salon, gym, restaurant, cafe, small clinic, dental, coaching, school, spa |
| **Professional / B2B** | **English** | hospital, hotel, law firm, IT company, agency, ecommerce, real estate, travel, logistics |
| **Unknown niche** | **Hinglish** (default) | Broader appeal across Indian businesses |

### Non-Indian Leads (Future)

When you add US/UK/UAE/etc leads (different country codes), system **automatically uses English**. Zero config needed.

---

## Sample Output Comparison

### Indian Clinic (Hinglish):
```
Namaste Skin Square Clinic,

Main Sami hoon — chhote clinics ke liye WhatsApp pe appointment 
reminders aur patient communication automate karta hoon.

Aksar clinics mein appointment confirm karne ke liye manually 
call karna padta hai, jo bohot time leta hai. WhatsApp pe ek 
simple setup se ye sab automatic ho jaata hai.

Agar interested ho to ek 2-minute ka demo video bhej sakta hoon. 
Bas "yes" reply kar dijiye.

— Sami
```

### Indian Hospital (English):
```
Hello Apollo Hospital,

I'm Sami — I help hospitals streamline patient communication 
through WhatsApp automation.

Most hospitals deal with patient communication at scale — 
appointments, reminders, follow-up reports — all of which 
require significant manual effort. WhatsApp automation can 
handle most of this seamlessly.

If you'd like to see how it could work for your hospital, 
reply "yes" and I'll send a 2-minute walkthrough.

— Sami
```

### US Lead (English):
```
Hello [Business],
I'm Sami — I help businesses set up WhatsApp automation...
— Sami
```

---

## Files Updated (4 files)

1. **`lib/aiPersonalizer.js`** — Added `pickLanguage()` + Hinglish prompts + bilingual fallbacks
2. **`pages/api/outreach/generate.js`** — No change (already uses aiPersonalizer)
3. **`pages/api/outreach/followups.js`** — Same language logic + Hinglish followup prompts/fallbacks
4. **`pages/api/whatsapp/send.js`** — Same as v3

---

## Required Env Vars (no change from v3)

```
GROQ_API_KEY=gsk_xxx_tomar_groq_key
SENDER_NAME=Sami
DAILY_OUTREACH_LIMIT=12
```

Get Groq key (FREE): https://console.groq.com

---

## Deploy Steps

1. **Files replace koro** local CRM e (4 files from zip)
2. **Vercel env vars** add koro (GROQ_API_KEY mandatory)
3. **Old pending delete:**
   ```sql
   DELETE FROM outreach_queue WHERE status = 'pending';
   ```
4. **Git push** → Vercel auto-deploy
5. **Test:** Generate → check message language matches expected (clinic=Hinglish, hospital=English)

---

## Important Bhai

### A. Test Hinglish messages carefully

Hinglish AI generate korar por **2-3 ta msg manually pore dekho**:
- Natural feel hocche?
- Spelling weird na?
- "Aap" use korche (na "tu/tum")?
- "Main", "mera" sahi place e?

AI 95% time bhalo korbe, but 5% time weird Hinglish bana te pare. Manual review = safe.

### B. Customize language rules

Jodi tomar mone hoy clinic English e better, ba IT company Hinglish e better — `lib/aiPersonalizer.js` er top e ei 2 ta set edit koro:

```javascript
const HINGLISH_NICHES = new Set([
  'salon', 'spa', 'gym', 'restaurant', 'cafe', 'clinic', 'dental',
  'coaching', 'school'
])
const ENGLISH_NICHES = new Set([
  'hospital', 'hotel', 'law', 'lawyer', 'real_estate', 'realtor',
  'ecommerce', 'travel', 'logistics', 'it', 'agency'
])
```

Niche move kore dao chosen set e.

### C. Future country expansion

Jab tumi US/UK/UAE leads add korbe (different country code), code automatically English use korbe. **Kichu change korte hobe na.**

Bhabishyote jodi tumi Spanish, French, ba Arabic leads target koro - **bolio**, ami language detection extend kore debo:
- Phone country code → language map
- Lead.country field support
- Multi-language fallback templates

---

## Performance & Cost

- **Groq API speed:** ~500ms per request
- **12 messages = ~15 seconds** total (with batching)
- **Cost:** $0 (Groq free tier - 14,400/day)
- **Bilingual handling:** No extra cost (same model handles both languages)

---

## Quick Reference Table

| Lead Niche | Lead Country | → Language |
|------------|--------------|-----------|
| Clinic | India | Hinglish |
| Hospital | India | English |
| Salon | India | Hinglish |
| Hotel | India | English |
| Law firm | India | English |
| Restaurant | India | Hinglish |
| IT company | India | English |
| Gym | India | Hinglish |
| Anything | USA/UK/UAE | English |

---

— v3.1 with smart language detection: Done
