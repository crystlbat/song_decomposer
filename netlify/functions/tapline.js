// Tapline sync — the original ?key= endpoint, still answering.
//
// Accounts live beside this in api.js. This is kept working so a device that
// was paired with the endpoint URL does not break the moment accounts ship:
// it goes on serving the projects that were written before there were
// accounts. Once you sign in, those projects belong to your account and this
// endpoint stops seeing them — that is the migration, and it is deliberate.
// Sign in on the other device rather than re-pairing this way.
//
// Set MONGODB_URI and TAPLINE_KEY under Site configuration -> Environment
// variables. Your address is then
// https://<your-site>.netlify.app/.netlify/functions/tapline?key=<your key>
const db = require('../lib/db');

const KEY = process.env.TAPLINE_KEY || '';   // must match the ?key= in the app's URL

// the app may be a static page on another origin, so every reply needs CORS
const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const reply = (code, obj) => ({ statusCode: code, headers: CORS, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const key = (event.queryStringParameters || {}).key || '';
  if (KEY && key !== KEY) return reply(401, { error: 'wrong key' });

  try {
    // a null owner is the documents from before accounts existed, and only those
    if (event.httpMethod === 'GET') return reply(200, { scenes: await db.read(null) });
    if (event.httpMethod === 'POST') {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : (event.body || '');
      let incoming = {};
      try { incoming = JSON.parse(raw || '{}'); } catch (err) {}
      return reply(200, { scenes: await db.write(null, incoming.scenes || []), updated: Date.now() });
    }
    return reply(405, { error: 'use GET or POST' });
  } catch (err) {
    return reply(500, { error: String(err.message || err) });
  }
};
