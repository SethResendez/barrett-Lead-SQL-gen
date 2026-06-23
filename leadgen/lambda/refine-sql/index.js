const https = require('https');

function ensurePropensityCols(sql) {
  const trimmed = sql.trim();
  if (/^SELECT\s+\*/i.test(trimmed)) return trimmed;
  const hasSell = /PROPENSITY_SELL_PERCENTILE_ZIP/i.test(trimmed);
  const hasRefi = /PROPENSITY_REFINANCE_PERCENTILE_ZIP/i.test(trimmed);
  if (hasSell && hasRefi) return trimmed;
  const cols = [];
  if (!hasSell) cols.push('PROPENSITY_SELL_PERCENTILE_ZIP');
  if (!hasRefi) cols.push('PROPENSITY_REFINANCE_PERCENTILE_ZIP');
  return trimmed.replace(/^(SELECT\s+)/i, `$1${cols.join(', ')}, `);
}

function claudeRequest(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a Snowflake SQL expert for Barrett Financial. Given an existing SQL query and a change request, return ONLY the updated SQL query. No explanation, no markdown fences, no preamble.
Preserve the existing style exactly: SELECT *, ILIKE with % wildcards, OR blocks in parentheses, numeric ranges with >= and <=, LIMIT 10000, and always keep AND NOT LIEN1_LENDER_NAME ILIKE '%BARRETT FINANCIAL GROUP%'. Never use IN (...) — always use ILIKE OR combos instead.
Never remove PROPENSITY_SELL_PERCENTILE_ZIP or PROPENSITY_REFINANCE_PERCENTILE_ZIP from the output.`,
      messages
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); }
        catch (e) { return reject(new Error(`Anthropic API returned non-JSON (HTTP ${res.statusCode}): ${data.slice(0, 500)}`)); }
        // Surface API errors instead of silently producing blank SQL.
        if (res.statusCode < 200 || res.statusCode >= 300 || parsed.type === 'error') {
          const detail = parsed.error ? `${parsed.error.type}: ${parsed.error.message}` : JSON.stringify(parsed).slice(0, 500);
          return reject(new Error(`Anthropic API error (HTTP ${res.statusCode}): ${detail}`));
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { sql, change } = JSON.parse(event.body);
    const result = await claudeRequest([{
      role: 'user',
      content: `Existing SQL:\n${sql}\n\nChange requested: ${change}`
    }]);
    const text = result.content?.[0]?.text;
    if (!text) throw new Error('Anthropic API returned no text content: ' + JSON.stringify(result).slice(0, 300));
    const newSQL = ensurePropensityCols(text);
    return { statusCode: 200, headers, body: JSON.stringify({ sql: newSQL }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
