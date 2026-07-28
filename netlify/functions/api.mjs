/* Tapline's account backend — everything under /api, one function.
 *
 * It exists so the Netlify copy can drop the Drive URL, the QR pairing and
 * the push/pull pair entirely: you log in with a username and a password,
 * and saving is just saving. The wire format for the scene payload is
 * deliberately the same shape the Apps Script backend used
 * ({ scenes: [...] }), so the client's merge logic is shared between both.
 *
 * Storage is Netlify Blobs. Nothing here is per-site configuration you have
 * to set up: the store is created on first write and the signing secret is
 * generated on first use, so a fresh deploy works with no environment
 * variables at all. Set TAPLINE_SECRET if you would rather pin it (rotating
 * it signs everyone out, which is the point of having it).
 */
import { getStore } from '@netlify/blobs';

const SESSION_DAYS = 60;
const PBKDF2_ITER = 210000;
const MAX_FAILS = 8;                 /* per username, inside the window */
const FAIL_WINDOW = 15 * 60 * 1000;
const MAX_BODY = 5 * 1024 * 1024;    /* a scene library is text; this is generous */
const COOKIE = 'tl_session';
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

const db = () => getStore({ name: 'tapline', consistency: 'strong' });
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers)
  });

/* Compare without leaking where two hex digests start to differ. */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256);
  return hex(bits);
}

/* The signing secret lives in the blob store so a brand-new deploy needs no
   setup. Two cold starts can race to create it, so always re-read and use
   whatever actually landed — otherwise half the sessions would be signed
   with a secret nobody kept. */
let secretCache = '';
async function secret() {
  if (process.env.TAPLINE_SECRET) return process.env.TAPLINE_SECRET;
  if (secretCache) return secretCache;
  const store = db();
  let s = await store.get('_secret', { type: 'text' });
  if (!s) {
    await store.set('_secret', rand(32));
    s = await store.get('_secret', { type: 'text' });
  }
  secretCache = s;
  return s;
}

async function sign(payload) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(await secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

async function mintToken(user) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const body = user + '.' + exp;
  return body + '.' + (await sign(body));
}

async function readToken(token) {
  if (!token) return '';
  const parts = token.split('.');
  if (parts.length !== 3) return '';
  const [user, exp, mac] = parts;
  if (!USER_RE.test(user) || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return '';
  return sameDigest(mac, await sign(user + '.' + exp)) ? user : '';
}

const cookieHeader = token => token
  ? `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
  : `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function tokenFrom(req) {
  const raw = req.headers.get('cookie') || '';
  for (const bit of raw.split(';')) {
    const eq = bit.indexOf('=');
    if (eq > 0 && bit.slice(0, eq).trim() === COOKIE) return bit.slice(eq + 1).trim();
  }
  return '';
}

async function body(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('too large');
  const txt = await req.text();
  if (txt.length > MAX_BODY) throw new Error('too large');
  if (!txt) return {};
  try { return JSON.parse(txt); } catch (e) { throw new Error('bad json'); }
}

/* Slow down guessing without ever telling the caller whether the username
   is real — the same 429 comes back either way. */
async function failCount(store, user) {
  const rec = await store.get('fail/' + user, { type: 'json' });
  if (!rec || Date.now() - (rec.first || 0) > FAIL_WINDOW) return null;
  return rec;
}
async function noteFail(store, user) {
  const rec = (await failCount(store, user)) || { first: Date.now(), n: 0 };
  rec.n++;
  await store.setJSON('fail/' + user, rec);
}

const stateKey = user => 'state/' + user;

async function loadState(store, user) {
  const s = await store.get(stateKey(user), { type: 'json' });
  return s && Array.isArray(s.scenes) ? s : { scenes: [], rev: 0, updated: 0 };
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname
    .replace(/^\/\.netlify\/functions\/api/, '')
    .replace(/^\/api/, '')
    .replace(/\/+$/, '') || '/';

  try {
    /* The client probes this to decide which world it is in: an answer here
       means accounts, no answer means the Drive + push/pull build. */
    if (route === '/health') return json({ ok: true, cloud: true });

    const store = db();

    if (route === '/signup' || route === '/login') {
      if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
      const b = await body(req);
      const user = String(b.username || '').trim().toLowerCase();
      const pass = String(b.password || '');

      if (!USER_RE.test(user)) {
        return json({ error: 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.' }, 400);
      }
      if (pass.length < 8) return json({ error: 'Passwords need at least 8 characters.' }, 400);

      const fails = await failCount(store, user);
      if (fails && fails.n >= MAX_FAILS) {
        return json({ error: 'Too many attempts. Wait 15 minutes and try again.' }, 429);
      }

      const existing = await store.get('users/' + user, { type: 'json' });

      if (route === '/signup') {
        if (existing) return json({ error: 'That username is taken.' }, 409);
        const salt = rand(16);
        await store.setJSON('users/' + user, {
          user, salt, iter: PBKDF2_ITER, hash: await pbkdf2(pass, salt, PBKDF2_ITER), created: Date.now()
        });
        await store.setJSON(stateKey(user), { scenes: [], rev: 0, updated: Date.now() });
        return json({ user }, 200, { 'set-cookie': cookieHeader(await mintToken(user)) });
      }

      /* Wrong username and wrong password are the same answer on purpose. */
      const ok = existing && sameDigest(await pbkdf2(pass, existing.salt, existing.iter || PBKDF2_ITER), existing.hash);
      if (!ok) {
        await noteFail(store, user);
        return json({ error: 'That username and password do not match.' }, 401);
      }
      await store.delete('fail/' + user).catch(() => {});
      return json({ user }, 200, { 'set-cookie': cookieHeader(await mintToken(user)) });
    }

    if (route === '/logout') {
      return json({ ok: true }, 200, { 'set-cookie': cookieHeader('') });
    }

    const user = await readToken(tokenFrom(req));

    if (route === '/me') {
      return user ? json({ user }) : json({ error: 'not signed in' }, 401);
    }

    if (route === '/state') {
      if (!user) return json({ error: 'not signed in' }, 401);

      if (req.method === 'GET') {
        const s = await loadState(store, user);
        return json({ scenes: s.scenes, rev: s.rev || 0, updated: s.updated || 0 });
      }

      if (req.method === 'POST') {
        const b = await body(req);
        if (!Array.isArray(b.scenes)) return json({ error: 'no scenes' }, 400);

        /* Optimistic concurrency. Two devices editing at once is the normal
           case here, and a blind overwrite is exactly how the old push lost
           work: if the caller is writing against a revision that has moved
           on, hand back what is stored and let the client merge and retry
           with its existing scene-level merge. */
        const cur = await loadState(store, user);
        const rev = Number(b.rev);
        if (!Number.isFinite(rev)) return json({ error: 'no rev' }, 400);
        if (rev !== (cur.rev || 0)) {
          return json({ conflict: true, scenes: cur.scenes, rev: cur.rev || 0 }, 409);
        }
        const next = { scenes: b.scenes, rev: (cur.rev || 0) + 1, updated: Date.now() };
        await store.setJSON(stateKey(user), next);
        return json({ ok: true, rev: next.rev, updated: next.updated });
      }

      return json({ error: 'use GET or POST' }, 405);
    }

    return json({ error: 'no such endpoint' }, 404);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (msg === 'too large') return json({ error: 'That is too much data for one save.' }, 413);
    if (msg === 'bad json') return json({ error: 'malformed request' }, 400);
    return json({ error: 'server error' }, 500);
  }
};
