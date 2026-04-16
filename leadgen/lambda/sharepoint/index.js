const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const BUCKET = process.env.SESSIONS_BUCKET;
const KEY = 'sessions/sessions.json';

async function readSessions() {
  try {
    const r = await s3.getObject({ Bucket: BUCKET, Key: KEY }).promise();
    return JSON.parse(r.Body.toString());
  } catch (e) {
    if (e.code === 'NoSuchKey') return { sessions: [] };
    throw e;
  }
}

async function writeSessions(data) {
  await s3.putObject({
    Bucket: BUCKET,
    Key: KEY,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  }).promise();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const path = event.path || event.rawPath || '';
  const action = path.includes('save') ? 'save' : path.includes('delete') ? 'delete' : 'load';
  const { session, id } = JSON.parse(event.body || '{}');

  try {
    const store = await readSessions();

    if (action === 'load') {
      const sorted = (store.sessions || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return { statusCode: 200, headers, body: JSON.stringify({ sessions: sorted }) };
    }

    if (action === 'save') {
      const sessions = store.sessions || [];
      const i = sessions.findIndex(s => s.id === session.id);
      if (i >= 0) sessions[i] = session; else sessions.unshift(session);
      await writeSessions({ sessions });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'delete') {
      const sessions = (store.sessions || []).filter(s => s.id !== id);
      await writeSessions({ sessions });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
