const https = require('https');

// ─── CONFIG (from environment variables) ─────────────────────────────────────
const TENANT_ID   = process.env.AZURE_TENANT_ID;
const CLIENT_ID   = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const SITE_HOSTNAME = 'barrettfinancial.sharepoint.com';
const SITE_PATH   = '/sites/BusinessIntelligence';
const FILE_PATH   = '/Files/10. Leads/10. Claude/Lead Gen Pipeline.xlsx';

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default'
  }).toString();
  const r = await httpRequest({
    hostname: 'login.microsoftonline.com',
    path: `/${TENANT_ID}/oauth2/v2.0/token`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!r.body.access_token) throw new Error('Auth failed: ' + JSON.stringify(r.body));
  return r.body.access_token;
}

// ─── GRAPH HELPERS ────────────────────────────────────────────────────────────
async function graphGet(token, path) {
  const r = await httpRequest({
    hostname: 'graph.microsoft.com',
    path: '/v1.0' + path,
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  });
  return r;
}

async function graphPut(token, path, body) {
  const data = JSON.stringify(body);
  const r = await httpRequest({
    hostname: 'graph.microsoft.com',
    path: '/v1.0' + path,
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, data);
  return r;
}

// ─── SHAREPOINT FILE OPERATIONS ───────────────────────────────────────────────
// We store sessions as a JSON file in SharePoint.
// Structure: { sessions: [ ...session objects ] }
const encodedPath = encodeURIComponent(FILE_PATH.replace(/^\//, ''));

async function getSiteId(token) {
  const r = await graphGet(token, `/sites/${SITE_HOSTNAME}:${SITE_PATH}`);
  if (!r.body.id) throw new Error('Could not get site ID: ' + JSON.stringify(r.body));
  return r.body.id;
}

async function getDriveId(token, siteId) {
  const r = await graphGet(token, `/sites/${siteId}/drives`);
  const drives = r.body.value || [];
  // Find the main document library (named "Files" or "Documents")
  const drive = drives.find(d => d.name === 'Files' || d.name === 'Documents') || drives[0];
  if (!drive) throw new Error('No drive found');
  return drive.id;
}

async function readSessionsFile(token, siteId, driveId) {
  const path = `/drives/${driveId}/root:${FILE_PATH}:/content`;
  try {
    const r = await graphGet(token, path);
    if (typeof r.body === 'object' && r.body.sessions) return r.body;
    return { sessions: [] };
  } catch {
    return { sessions: [] };
  }
}

async function writeSessionsFile(token, driveId, data) {
  const content = JSON.stringify(data, null, 2);
  const r = await httpRequest({
    hostname: 'graph.microsoft.com',
    path: `/v1.0/drives/${driveId}/root:${FILE_PATH}:/content`,
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(content)
    }
  }, content);
  return r;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
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
    const token = await getToken();
    const siteId = await getSiteId(token);
    const driveId = await getDriveId(token, siteId);
    const store = await readSessionsFile(token, siteId, driveId);

    if (action === 'load') {
      // Return all sessions sorted newest first
      const sorted = (store.sessions || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return { statusCode: 200, headers, body: JSON.stringify({ sessions: sorted }) };
    }

    if (action === 'save') {
      const sessions = store.sessions || [];
      const i = sessions.findIndex(s => s.id === session.id);
      if (i >= 0) sessions[i] = session; else sessions.unshift(session);
      await writeSessionsFile(token, driveId, { sessions });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'delete') {
      const sessions = (store.sessions || []).filter(s => s.id !== id);
      await writeSessionsFile(token, driveId, { sessions });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
