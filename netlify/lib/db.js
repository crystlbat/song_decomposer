// Shared by both endpoints: the Mongo connection, the per-project merge, and
// the account bits. The merge rule is the one the ?key= endpoint has always
// used — newest edit of each project wins — because that is the part that
// works and there was never a reason to change it.
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);

const DB = process.env.TAPLINE_DB || 'tapline';
const ITER = 210000;
const SESSION_DAYS = 60;
const COOKIE = 'tl_session';
const MAX_FAILS = 8;
const FAIL_WINDOW = 15 * 60 * 1000;
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

// a function is torn down and rebuilt constantly; parking the client on the
// global keeps one connection pool warm instead of dialling Atlas every call
if (!global._tapline) global._tapline = new MongoClient(process.env.MONGODB_URI);
const db = () => global._tapline.db(DB);
const scenes = () => db().collection('scenes');
const users = () => db().collection('users');
const meta = () => db().collection('meta');

// ── projects ────────────────────────────────────────────────────────────
// `owner` is absent on every document written before accounts existed, and
// that absence is what the ?key= endpoint still reads. An account's
// documents carry the username. _id stays the project id the app generates,
// so nothing already stored has to be rewritten to move across — see adopt().
const scope = owner => (owner ? { owner } : { owner: { $exists: false } });

async function read(owner) {
  const docs = await scenes().find(scope(owner)).toArray();
  return docs.map(function (d) {
    const s = Object.assign({}, d, { id: d._id });
    delete s._id;
    delete s.owner;
    return s;
  });
}

// newest edit of each project wins — the same rule the app applies locally
async function write(owner, incoming) {
  const have = {};
  (await read(owner)).forEach(function (s) { have[s.id] = s; });
  const ops = [];
  (incoming || []).forEach(function (s) {
    if (!s || !s.id) return;
    const p = have[s.id];
    if (p && (p.updated || 0) > (s.updated || 0)) return;   // what we hold is newer
    have[s.id] = s;
    const doc = Object.assign({}, s);
    delete doc.id;
    if (owner) doc.owner = owner;
    // Filtering on the owner as well as the id means a write can only ever
    // land on a document this account already owns. Two accounts holding the
    // same project id would collide on the upsert and fail loudly, which is
    // the right outcome — far better than one quietly overwriting the other.
    ops.push({ replaceOne: { filter: Object.assign({ _id: s.id }, scope(owner)), replacement: doc, upsert: true } });
  });
  if (ops.length) await scenes().bulkWrite(ops, { ordered: false });
  return Object.keys(have).map(function (k) { return have[k]; });
}

// Everything written through the ?key= endpoint has no owner. The first
// account to exist takes it, so the projects already in the database are
// simply there after signing in — one field set on each document, no export,
// no import, nothing to go wrong. Later accounts start empty.
async function adopt(owner) {
  const first = await users().countDocuments({}, { limit: 2 });
  if (first > 1) return 0;
  const r = await scenes().updateMany({ owner: { $exists: false } }, { $set: { owner } });
  return r.modifiedCount || 0;
}

// ── accounts ────────────────────────────────────────────────────────────
const hex = b => Buffer.from(b).toString('hex');
const rand = n => crypto.randomBytes(n).toString('hex');

function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const hash = async (password, salt, iter) => hex(await pbkdf2(password, salt, iter || ITER, 32, 'sha256'));

// Kept in the database so a fresh deploy needs no extra environment variable.
// Set TAPLINE_SECRET to pin it instead; changing it signs everyone out.
let secretCache = '';
async function secret() {
  if (process.env.TAPLINE_SECRET) return process.env.TAPLINE_SECRET;
  if (secretCache) return secretCache;
  // upsert-then-read, so two cold starts racing to create it still agree
  await meta().updateOne({ _id: 'secret' }, { $setOnInsert: { value: rand(32) } }, { upsert: true });
  const doc = await meta().findOne({ _id: 'secret' });
  secretCache = doc.value;
  return secretCache;
}

const sign = async payload =>
  crypto.createHmac('sha256', await secret()).update(payload).digest('hex');

async function mintToken(user) {
  const body = user + '.' + (Date.now() + SESSION_DAYS * 864e5);
  return body + '.' + (await sign(body));
}

async function readToken(token) {
  if (!token) return '';
  const parts = String(token).split('.');
  if (parts.length !== 3) return '';
  const [user, exp, mac] = parts;
  if (!USER_RE.test(user) || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return '';
  return sameDigest(mac, await sign(user + '.' + exp)) ? user : '';
}

const cookieHeader = token => token
  ? COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400
  : COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

function tokenFrom(headers) {
  const raw = (headers && (headers.cookie || headers.Cookie)) || '';
  for (const bit of String(raw).split(';')) {
    const eq = bit.indexOf('=');
    if (eq > 0 && bit.slice(0, eq).trim() === COOKIE) return bit.slice(eq + 1).trim();
  }
  return '';
}

// Slow guessing down without ever saying whether the username is real —
// an unknown name and a wrong password give the same answer either way.
async function tooManyFails(user) {
  const u = await users().findOne({ _id: user });
  if (!u || !u.failFirst) return false;
  if (Date.now() - u.failFirst > FAIL_WINDOW) return false;
  return (u.failN || 0) >= MAX_FAILS;
}
async function noteFail(user) {
  const u = await users().findOne({ _id: user });
  if (!u) return;
  const fresh = !u.failFirst || Date.now() - u.failFirst > FAIL_WINDOW;
  await users().updateOne({ _id: user },
    { $set: fresh ? { failFirst: Date.now(), failN: 1 } : { failN: (u.failN || 0) + 1 } });
}
const clearFails = user => users().updateOne({ _id: user }, { $unset: { failFirst: '', failN: '' } });

module.exports = {
  ITER, USER_RE, COOKIE,
  scenes, users, meta,
  read, write, adopt,
  hash, sameDigest, rand,
  mintToken, readToken, cookieHeader, tokenFrom,
  tooManyFails, noteFail, clearFails
};
