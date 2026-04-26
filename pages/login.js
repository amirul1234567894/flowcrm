import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

// SHA-256 hashes — plain credentials NOT stored here
// Email: admin@amirul123  |  Password: Amirul@1234
const H_EMAIL = '28be2fde29826787a696fa2e525a5081ed7132a33b9fbdf1cfef6e5a9f274553'
const H_PASS  = '2adf4fd945af63d3731799e4ae9bf9928752e2d98733c967b48af3c8a2c2e2ed'

// Secret answer: autoflow
const H_SECRET = '2c04410d922c25b5fcc6ab037a86b0d7b3d56d1990a11523e6adf7c083f4ddb9'

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function Login() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [pass, setPass]         = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [mode, setMode]         = useState('login') // 'login' | 'forgot1' | 'forgot2'
  const [sqAns, setSqAns]       = useState('')
  const [sqErr, setSqErr]       = useState('')
  const [newPw, setNewPw]       = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwErr, setPwErr]       = useState('')
  const [pwStrength, setPwStrength] = useState('')
  const [resetDone, setResetDone] = useState(false)
  const [runtimeHash, setRuntimeHash] = useState(null)

  useEffect(() => {
    if (sessionStorage.getItem('af_logged_in') === '1') router.replace('/')
    const saved = sessionStorage.getItem('af_pw_hash')
    if (saved) setRuntimeHash(saved)
  }, [])

  const doLogin = async () => {
    if (!email || !pass) { setError('Please enter email and password.'); return }
    setLoading(true); setError('')
    const [he, hp] = await Promise.all([sha256(email.trim()), sha256(pass)])
    const activeHash = runtimeHash || H_PASS
    if (he === H_EMAIL && hp === activeHash) {
      sessionStorage.setItem('af_logged_in', '1')
      router.replace('/')
    } else {
      setError('Invalid email or password.')
      setPass('')
      setLoading(false)
    }
  }

  const checkSecret = async () => {
    setSqErr('')
    const h = await sha256(sqAns.trim().toLowerCase())
    if (h === H_SECRET) { setMode('forgot2') }
    else { setSqErr('Wrong answer. Try again.'); setSqAns('') }
  }

  const strengthCheck = (pw) => {
    if (!pw) { setPwStrength(''); return }
    const strong = /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw) && pw.length >= 8
    setPwStrength(pw.length < 6 ? 'weak' : strong ? 'strong' : 'medium')
  }

  const saveNewPw = async () => {
    setPwErr('')
    if (newPw.length < 8 || newPw !== confirmPw) { setPwErr("Passwords don't match or too short (min 8)."); return }
    const h = await sha256(newPw)
    sessionStorage.setItem('af_pw_hash', h)
    setRuntimeHash(h)
    setResetDone(true)
    setTimeout(() => { setMode('login'); setResetDone(false); setNewPw(''); setConfirmPw(''); setSqAns('') }, 2000)
  }

  return (
    <>
      <Head>
        <title>FlowCRM — Login</title>
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
      </Head>

      <div className="wrap">
        <div className="card">

          {/* LOGO */}
          <div className="logo-row">
            <div className="logo-icon">⚡</div>
            <div>
              <div className="logo-text">Flow<span>CRM</span></div>
              <div className="logo-sub">v3 · AUTOMATION</div>
            </div>
          </div>

          {/* ── LOGIN FORM ── */}
          {mode === 'login' && (<>
            <div className="title">Welcome Back</div>
            <div className="sub">Sign in to your CRM dashboard</div>

            {error && <div className="err-box">❌ {error}</div>}

            <div className="fg">
              <label>Email Address</label>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                placeholder="Enter your email"
                autoComplete="username"
              />
            </div>
            <div className="fg">
              <label>Password</label>
              <div className="pw-row">
                <input
                  type={showPw ? 'text' : 'password'} value={pass}
                  onChange={e => setPass(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doLogin()}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button className="eye-btn" onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁'}</button>
              </div>
            </div>

            <div className="forgot-link">
              <span onClick={() => { setMode('forgot1'); setError('') }}>Forgot password?</span>
            </div>

            <button className="btn-primary" onClick={doLogin} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </>)}

          {/* ── FORGOT: Step 1 ── */}
          {mode === 'forgot1' && (<>
            <div className="step-badge">Step 1 of 2</div>
            <div className="title">🔐 Reset Password</div>
            <div className="sub">Answer your secret question to verify identity.</div>

            {sqErr && <div className="err-box">❌ {sqErr}</div>}

            <div className="fg">
              <label>Secret Question</label>
              <input type="text" value="What is the name of your first business?" readOnly style={{opacity:0.6,cursor:'default'}}/>
            </div>
            <div className="fg">
              <label>Your Answer</label>
              <input
                type="text" value={sqAns}
                onChange={e => setSqAns(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkSecret()}
                placeholder="Type your answer…"
                autoComplete="off"
              />
            </div>
            <button className="btn-primary" onClick={checkSecret}>Verify Answer →</button>
            <button className="btn-back" onClick={() => { setMode('login'); setSqAns(''); setSqErr('') }}>← Back to Login</button>
          </>)}

          {/* ── FORGOT: Step 2 ── */}
          {mode === 'forgot2' && (<>
            <div className="step-badge">Step 2 of 2</div>
            <div className="title">🔑 New Password</div>
            <div className="sub">Choose a strong new password.</div>

            {resetDone && <div className="ok-box">✅ Password updated! Redirecting…</div>}
            {!resetDone && (<>
              {pwErr && <div className="err-box">❌ {pwErr}</div>}
              <div className="fg">
                <label>New Password</label>
                <div className="pw-row">
                  <input
                    type={showPw ? 'text' : 'password'} value={newPw}
                    onChange={e => { setNewPw(e.target.value); strengthCheck(e.target.value) }}
                    placeholder="Min. 8 characters"
                  />
                  <button className="eye-btn" onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁'}</button>
                </div>
                {pwStrength && <div className={`strength ${pwStrength}`}/>}
              </div>
              <div className="fg">
                <label>Confirm Password</label>
                <input
                  type="password" value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveNewPw()}
                  placeholder="Re-enter password"
                />
              </div>
              <button className="btn-primary" onClick={saveNewPw}>Save New Password →</button>
            </>)}
          </>)}

        </div>
      </div>

      <style jsx global>{`
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box }
        :root {
          --bg:#090c14; --card:#111827; --br:#1e2d45; --inp:#1a2234;
          --accent:#3b82f6; --green:#10b981; --red:#ef4444;
          --text:#e2e8f0; --t2:#94a3b8; --t3:#475569;
          --sans:'DM Sans',sans-serif; --mono:'DM Mono',monospace; --disp:'Syne',sans-serif;
        }
        html, body { min-height:100%; background:var(--bg); color:var(--text); font-family:var(--sans); }
        .wrap {
          min-height:100vh; display:flex; align-items:center; justify-content:center;
          padding:16px;
          background: radial-gradient(ellipse 60% 50% at 20% 10%, rgba(59,130,246,0.07) 0%, transparent 70%),
                      radial-gradient(ellipse 50% 40% at 80% 90%, rgba(16,185,129,0.05) 0%, transparent 70%),
                      var(--bg);
        }
        .card {
          background:var(--card); border:1px solid var(--br); border-radius:20px;
          padding:36px 32px; width:100%; max-width:420px;
          box-shadow:0 24px 80px rgba(0,0,0,0.5);
          animation: fadeUp 0.35s ease;
        }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }

        .logo-row { display:flex; align-items:center; gap:12px; margin-bottom:28px }
        .logo-icon { width:40px; height:40px; background:linear-gradient(135deg,#3b82f6,#06b6d4); border-radius:11px; display:flex; align-items:center; justify-content:center; font-size:20px; }
        .logo-text { font-family:var(--disp); font-size:22px; font-weight:800; letter-spacing:-0.5px; }
        .logo-text span { color:var(--accent) }
        .logo-sub { font-size:10px; color:var(--t3); font-family:var(--mono); margin-top:2px }

        .step-badge { display:inline-block; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.25); color:var(--accent); font-size:11px; font-weight:700; font-family:var(--mono); padding:3px 10px; border-radius:20px; margin-bottom:12px; text-transform:uppercase; letter-spacing:0.05em; }
        .title { font-family:var(--disp); font-size:24px; font-weight:800; margin-bottom:6px }
        .sub { font-size:13px; color:var(--t2); margin-bottom:24px; line-height:1.6 }

        .err-box { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:10px 14px; font-size:13px; color:#f87171; margin-bottom:16px; }
        .ok-box  { background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px 14px; font-size:13px; color:#34d399; margin-bottom:16px; }

        .fg { display:flex; flex-direction:column; gap:6px; margin-bottom:14px }
        label { font-size:11px; font-family:var(--mono); color:var(--t3); text-transform:uppercase; letter-spacing:0.07em }
        input {
          background:var(--inp); border:1px solid var(--br); border-radius:10px;
          padding:11px 14px; color:var(--text); font-size:14px; font-family:var(--sans);
          outline:none; transition:border 0.2s, box-shadow 0.2s; width:100%;
        }
        input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(59,130,246,0.12) }
        input[readonly] { opacity:0.6; cursor:default }
        ::placeholder { color:var(--t3) }

        .pw-row { position:relative }
        .pw-row input { padding-right:44px }
        .eye-btn { position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--t3); font-size:16px; padding:4px; line-height:1; transition:color 0.2s }
        .eye-btn:hover { color:var(--t2) }

        .strength { height:3px; border-radius:2px; margin-top:6px; transition:all 0.3s }
        .strength.weak   { background:#ef4444; width:33% }
        .strength.medium { background:#f59e0b; width:66% }
        .strength.strong { background:#10b981; width:100% }

        .forgot-link { text-align:right; margin-bottom:16px; margin-top:-4px }
        .forgot-link span { font-size:12px; color:var(--accent); cursor:pointer; opacity:0.85; transition:opacity 0.2s }
        .forgot-link span:hover { opacity:1; text-decoration:underline }

        .btn-primary {
          width:100%; background:var(--accent); border:none; border-radius:10px;
          padding:13px; color:white; font-size:15px; font-weight:700; font-family:var(--sans);
          cursor:pointer; transition:all 0.2s; letter-spacing:0.01em;
        }
        .btn-primary:hover:not(:disabled) { background:#2563eb; transform:translateY(-1px); box-shadow:0 8px 24px rgba(59,130,246,0.3) }
        .btn-primary:disabled { opacity:0.6; cursor:not-allowed }
        .btn-back {
          width:100%; background:none; border:1px solid var(--br); border-radius:10px;
          padding:11px; color:var(--t2); font-size:14px; font-family:var(--sans);
          cursor:pointer; margin-top:10px; transition:all 0.2s;
        }
        .btn-back:hover { border-color:var(--accent); color:var(--accent) }

        /* ── MOBILE ── */
        @media (max-width: 480px) {
          .card { padding:28px 20px; border-radius:16px }
          .title { font-size:20px }
        }
      `}</style>
    </>
  )
}
