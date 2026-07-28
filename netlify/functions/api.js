// Tapline accounts — everything the app talks to under /api.
//
// The ?key= endpoint beside this one is untouched and still answers: this
// adds a username and a password in front of the same database, so a device
// is set up by signing in rather than by carrying a secret URL to it, and
// saving can then happen on its own instead of being a Push you remember.
//
// Storage, and the rule for merging two devices' work, are exactly what
// tapline.js has always used — one document per project, newest edit wins.
// Only who may read which documents is new.
const db = require('../lib/db');

const MAX_BODY = 5 * 1024 * 1024;

// Same-origin, so no CORS: the cookie is the whole point and a cookie that
// travelled cross-origin would be a different security question.
const reply = (code, obj, cookie) => ({
  statusCode: code,
  headers: Object.assign(
    { 'content-type': 'application/json', 'cache-control': 'no-store' },
    cookie === undefined ? {} : { 'set-cookie': cookie }
  ),
  body: JSON.stringify(obj)
});

function bodyOf(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (raw.length > MAX_BODY) throw new Error('too large');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error('bad json'); }
}

exports.handler = async function (event) {
  const path = String(event.path || '')
    .replace(/^\/\.netlify\/functions\/api/, '')
    .replace(/^\/api/, '')
    .replace(/\/+$/, '') || '/';
  const method = event.httpMethod;

  try {
    // The app probes this at startup to find out which build it is running
    // in. No answer means the static build, which keeps its own sync.
    if (path === '/health') return reply(200, { ok: true, cloud: true });

    if (path === '/signup' || path === '/login') {
      if (method !== 'POST') return reply(405, { error: 'use POST' });
      const b = bodyOf(event);
      const user = String(b.username || '').trim().toLowerCase();
      const pass = String(b.password || '');

      if (!db.USER_RE.test(user)) {
        return reply(400, { error: 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.' });
      }
      if (pass.length < 8) return reply(400, { error: 'Passwords need at least 8 characters.' });
      if (await db.tooManyFails(user)) {
        return reply(429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
      }

      const existing = await db.users().findOne({ _id: user });

      if (path === '/signup') {
        if (existing) return reply(409, { error: 'That username is taken.' });
        const salt = db.rand(16);
        await db.users().insertOne({
          _id: user, salt, iter: db.ITER, hash: await db.hash(pass, salt, db.ITER), created: Date.now()
        });
        // whatever the ?key= endpoint wrote before today belongs to whoever
        // signs up first — this is the migration, and it is one field
        const took = await db.adopt(user);
        return reply(200, { user, adopted: took }, db.cookieHeader(await db.mintToken(user)));
      }

      const ok = existing && db.sameDigest(await db.hash(pass, existing.salt, existing.iter), existing.hash);
      if (!ok) {
        await db.noteFail(user);
        return reply(401, { error: 'That username and password do not match.' });
      }
      await db.clearFails(user);
      return reply(200, { user }, db.cookieHeader(await db.mintToken(user)));
    }

    if (path === '/logout') return reply(200, { ok: true }, db.cookieHeader(''));

    const user = await db.readToken(db.tokenFrom(event.headers || {}));

    if (path === '/me') {
      return user ? reply(200, { user }) : reply(401, { error: 'not signed in' });
    }

    if (path === '/state') {
      if (!user) return reply(401, { error: 'not signed in' });

      if (method === 'GET') return reply(200, { scenes: await db.read(user) });

      // A save is also a fetch: the reply is the merged set, so the other
      // device's work arrives as part of saving rather than needing a Pull.
      if (method === 'POST') {
        const b = bodyOf(event);
        if (!Array.isArray(b.scenes)) return reply(400, { error: 'no scenes' });
        return reply(200, { scenes: await db.write(user, b.scenes), updated: Date.now() });
      }

      return reply(405, { error: 'use GET or POST' });
    }

    return reply(404, { error: 'no such endpoint' });
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (msg === 'too large') return reply(413, { error: 'That is too much data for one save.' });
    if (msg === 'bad json') return reply(400, { error: 'malformed request' });
    return reply(500, { error: msg });
  }
};
