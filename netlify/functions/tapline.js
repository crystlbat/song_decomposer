// Tapline sync — every project is one document in your MongoDB.
// Save as netlify/functions/tapline.js in your site's repo, put
// mongodb in package.json (npm i mongodb), set MONGODB_URI and
// TAPLINE_KEY under Site configuration -> Environment variables.
// Your address is then
// https://<your-site>.netlify.app/.netlify/functions/tapline?key=<your key>
const { MongoClient } = require('mongodb');

const KEY = process.env.TAPLINE_KEY || '';   // must match the ?key= in the app's URL
const DB  = process.env.TAPLINE_DB  || 'tapline';

// a function is torn down and rebuilt constantly; parking the client on the
// global keeps one connection pool warm instead of dialling Atlas every call
if (!global._tapline) global._tapline = new MongoClient(process.env.MONGODB_URI);
const col = () => global._tapline.db(DB).collection('scenes');

// _id is the project id the app already generates, so a project is the
// same document forever and two devices can never fork it into two rows.
async function read() {
  var docs = await col().find({}).toArray();
  return docs.map(function (d) {
    var s = Object.assign({}, d, { id: d._id });
    delete s._id;
    return s;
  });
}

// newest edit of each project wins — the same rule the app applies locally
async function write(incoming) {
  var have = {};
  (await read()).forEach(function (s) { have[s.id] = s; });
  var ops = [];
  incoming.forEach(function (s) {
    if (!s || !s.id) return;
    var p = have[s.id];
    if (p && (p.updated || 0) > (s.updated || 0)) return;   // what we hold is newer
    have[s.id] = s;
    var doc = Object.assign({}, s);
    delete doc.id;
    ops.push({ replaceOne: { filter: { _id: s.id }, replacement: doc, upsert: true } });
  });
  if (ops.length) await col().bulkWrite(ops, { ordered: false });
  return Object.keys(have).map(function (k) { return have[k]; });
}

// the app is a static page on another origin, so every reply needs CORS
const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const reply = (code, obj) => ({ statusCode: code, headers: CORS, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  var key = (event.queryStringParameters || {}).key || '';
  if (KEY && key !== KEY) return reply(401, { error: 'wrong key' });

  try {
    if (event.httpMethod === 'GET') return reply(200, { scenes: await read() });
    if (event.httpMethod === 'POST') {
      var raw = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : (event.body || '');
      var incoming = {};
      try { incoming = JSON.parse(raw || '{}'); } catch (err) {}
      var merged = await write(incoming.scenes || []);
      return reply(200, { scenes: merged, updated: Date.now() });
    }
    return reply(405, { error: 'use GET or POST' });
  } catch (err) {
    return reply(500, { error: String(err.message || err) });
  }
};
