// Prova nel browser del corso con la rete simulata: Firebase finto (accesso con email e password già verificata) e Worker finto.
// Si prova il corso con il login del Worker SPENTO e ACCESO (come le variabili ACCESSO_CORSO / ACCESSO_TTS / ACCESSO_LEAD_CORSO).
// Lancio:   node tests/corso.e2e.js      (serve Playwright con un Chromium; variabili facoltative: PLAYWRIGHT_MODULE, CHROMIUM, PAGINA)
const http = require('http'), fs = require('fs'), path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const PAGINA = fs.readFileSync(process.env.PAGINA || path.join(__dirname, '../index.html'), 'utf8')
let esito = 0
const ok = (c, t) => { console.log((c ? 'OK    ' : 'FALLITO ') + t); if (!c) esito = 1 }
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGINA) }).listen(0)
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST, OPTIONS' }
const JS = { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }

// ── Firebase finto (moduli ES serviti al posto di quelli di gstatic.com) ──
const FAKE_APP = `export function initializeApp(c){ return {} }`
const FAKE_AUTH = `
const mk = e => ({ uid: 'UTENTE-1', email: e, emailVerified: true, getIdToken: async () => 'TOKEN-FINTO', reload: async () => {} })
let current = null, cb = null
const auth = { get currentUser() { return current } }
export function getAuth() { return auth }
export async function createUserWithEmailAndPassword(a, e) { current = mk(e); return { user: current } }
export async function signInWithEmailAndPassword(a, e) { current = mk(e); setTimeout(() => cb && cb(current), 0); return { user: current } }
export async function sendEmailVerification() {}
export function onAuthStateChanged(a, f) { cb = f; setTimeout(() => f(current), 0); return () => {} }
export async function signOut() { current = null; cb && cb(null) }`
const FAKE_FS = `
const st = () => (globalThis.__store = globalThis.__store || {})
export function getFirestore() { return {} }
export function doc(db, col, id) { return { k: col + '/' + id } }
export async function getDoc(r) { const d = st()[r.k]; return { exists: () => !!d, data: () => d } }
export async function setDoc(r, data, o) { st()[r.k] = (o && o.merge) ? Object.assign({}, st()[r.k] || {}, data) : data }
export async function updateDoc(r, data) { st()[r.k] = Object.assign({}, st()[r.k] || {}, data) }`

async function corso(br, modo, { privacy = true, marketing = false, haCruscotto = 'si' } = {}) {
  const p = await br.newPage(), richieste = { corso: [], tts: [], lead: [] }, esterne = []
  await p.route('**/*', rt => {
    const q = rt.request(), u = q.url()
    if (u.startsWith('http://localhost')) return rt.continue()
    if (u.includes('firebasejs') && u.includes('firebase-app')) return rt.fulfill({ status: 200, headers: JS, body: FAKE_APP })
    if (u.includes('firebasejs') && u.includes('firebase-auth')) return rt.fulfill({ status: 200, headers: JS, body: FAKE_AUTH })
    if (u.includes('firebasejs') && u.includes('firebase-firestore')) return rt.fulfill({ status: 200, headers: JS, body: FAKE_FS })
    if (u.includes('workers.dev')) {
      if (q.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: CORS })
      const rotta = new URL(u).pathname, auth = q.headers()['authorization'] || '', corpo = JSON.parse(q.postData() || '{}')
      const chiave = rotta === '/corso' ? 'corso' : rotta === '/tts' ? 'tts' : 'lead'
      const registra = { rotta, auth, corpo }; richieste[chiave].push(registra)
      const login = modo === 'acceso'
      if (login && auth !== 'Bearer TOKEN-FINTO') { registra.esito = 401; return rt.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"error":"Token mancante"}' }) }
      if (login && rotta === '/registra-lead-corso' && corpo.uid !== 'UTENTE-1') { registra.esito = 403; return rt.fulfill({ status: 403, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"error":"uid non corrispondente al login"}' }) }
      registra.esito = 200
      if (rotta === '/corso') return rt.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: 'Ciao, sono Marco Ferretti. Cominciamo.' }] }) })
      if (rotta === '/tts') return rt.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'audio/mpeg' }, body: Buffer.from('ID3') })
      return rt.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"ok":true}' })
    }
    esterne.push(u); return rt.abort()
  })
  await p.goto(`http://localhost:${srv.address().port}/`)
  await p.evaluate(() => window.mostraAuth()); await p.evaluate(() => window.toggleAuthMode())            // schermata di accesso (account già esistente e verificato)
  await p.fill('#auth-email', 'corsista@azienda.it'); await p.fill('#auth-password', 'password123'); await p.evaluate(() => window.submitAuth())
  await p.waitForSelector('#onboarding', { state: 'visible' })
  await p.fill('#inp-nome', 'Anna'); await p.evaluate(() => window.step1Next())
  await p.evaluate(() => window.selezionaTipo('imprenditore')); await p.evaluate(() => window.step2Next())
  await p.selectOption('#inp-settore', 'Commercio'); await p.evaluate(() => window.step3Next())
  await p.evaluate(v => window.selezionaCruscotto(v), haCruscotto)
  if (privacy) await p.check('#cons-privacy'); if (marketing) await p.check('#cons-marketing')
  return { p, richieste, esterne }
}
async function proseguiFinoAlCorso(p) {
  await p.evaluate(() => window.step4Next()); await p.waitForTimeout(400)
  await p.evaluate(() => window.selezionaVoce('si')); await p.evaluate(() => window.step5Next())
  await p.waitForSelector('#corso', { state: 'visible' }); await p.waitForTimeout(900)
}

;(async () => {
  const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  for (const modo of ['spento', 'acceso']) {
    const { p, richieste } = await corso(br, modo, { marketing: true })
    await proseguiFinoAlCorso(p)
    // un secondo messaggio dell'utente
    await p.fill('#chat-input', 'Mi spieghi il DSCR?'); await p.evaluate(() => window.sendMessage()); await p.waitForTimeout(900)
    const chat = await p.locator('#chat-messages').innerText()
    ok(/Marco Ferretti/.test(chat), `login Worker ${modo.toUpperCase()}: il corso funziona, Marco risponde in chat`)
    ok(richieste.corso.length >= 2 && richieste.corso.every(r => r.esito === 200), `login ${modo}: tutte le chiamate a /corso riuscite (${richieste.corso.length})`)
    ok(richieste.tts.length >= 1 && richieste.tts.every(r => r.esito === 200), `login ${modo}: le chiamate a /tts riuscite (${richieste.tts.length})`)
    ok(richieste.lead.length === 1 && richieste.lead[0].esito === 200, `login ${modo}: /registra-lead-corso riuscita`)
    const tutte = [...richieste.corso, ...richieste.tts, ...richieste.lead]
    ok(tutte.length > 0 && tutte.every(r => r.auth === 'Bearer TOKEN-FINTO'), `login ${modo}: TUTTE le chiamate (${tutte.length}) mandano «Authorization: Bearer <idToken>»`)
    const c = richieste.lead[0].corpo
    ok(c.uid === 'UTENTE-1' && c.email === 'corsista@azienda.it' && c.nome === 'Anna' && c.tipo === 'imprenditore', `login ${modo}: lead con uid, email, nome e tipo`)
    ok(c.haCruscotto === 'si' && c.interesse === 'corso', `login ${modo}: haCruscotto «si» e interesse «corso»`)
    ok(c.consensoPrivacy === true && c.consensoMarketing === true, `login ${modo}: consensi privacy e marketing inviati`)
    const corpoCorso = richieste.corso[0].corpo
    ok(corpoCorso.model === 'claude-sonnet-4-6' && corpoCorso.max_tokens === 1500 && typeof corpoCorso.system === 'string' && corpoCorso.system.length > 1000 && Array.isArray(corpoCorso.messages), `login ${modo}: il corpo di /corso è quello di sempre (model, max_tokens 1500, system lungo, messages)`)
    ok((await p.evaluate(() => globalThis.__store['corsoUtenti/UTENTE-1'].hasCruscotto)) === true, `login ${modo}: i dati del corso restano salvati su corsoUtenti come prima`)
    await p.close()
  }
  { const { p, richieste } = await corso(br, 'spento', { privacy: true, marketing: false, haCruscotto: 'no' }); await proseguiFinoAlCorso(p)
    const c = richieste.lead[0].corpo; ok(c.haCruscotto === 'no' && c.consensoPrivacy === true && c.consensoMarketing === false, 'risposta «No, non ancora» → haCruscotto «no»; marketing non spuntato → falso'); await p.close() }
  { const { p, richieste } = await corso(br, 'spento', { privacy: false }); await p.evaluate(() => window.step4Next()); await p.waitForTimeout(400)
    ok(richieste.lead.length === 0 && (await p.locator('#cons-errore').isVisible()) && await p.locator('#step4').evaluate(e => e.classList.contains('active')), 'senza consenso privacy: non si procede, non parte nessun contatto, compare l\'avviso'); await p.close() }
  { const { p } = await corso(br, 'spento', {}); 
    ok((await p.locator('#cons-privacy').isChecked()) && !(await p.locator('#cons-marketing').isChecked()), 'la casella marketing non è pre-spuntata (la privacy l\'ha spuntata la prova)'); 
    ok(await p.locator('label[for="cons-privacy"] a').getAttribute('href') === 'https://controllogestione.ceo/legal#privacy', 'il link dell\'informativa porta a controllogestione.ceo/legal#privacy'); await p.close() }
  await br.close(); srv.close(); process.exit(esito)
})().catch(e => { console.error('ERRORE', e.message); process.exit(1) })
