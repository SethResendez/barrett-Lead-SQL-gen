const https = require('https');

const SYSTEM_PROMPT = `You are a Snowflake SQL expert for Barrett Financial's HouseCanary property database.
Table: BULK_PROPERTY_DATA_WITH_PROPENSITY_PRIVATE_SHARE_USA
Key fields: HC_ADDRESS_ID, ADDRESS_SLUG, ADDRESS, CITY, STATE, ZIPCODE, COUNTY, HC_VALUE_ESTIMATE, PRINCIPAL_OUTSTANDING_TOTAL, LIEN_AMOUNT_TOTAL, PRINCIPAL_PAID_TOTAL, OWNER_OCCUPIED_YN, DEFAULT_YN, DEFAULT_DATE_LAST, HC_CONDITION_CLASS, BUILDING_CONDITION_CODE, LAST_CLOSE_DATE, LAST_CLOSE_PRICE, DEED_DATE, DEED_PRICE, LIEN1_LOAN_TYPE, LIEN1_AMOUNT, LIEN1_CONTRACT_DATE, LIEN1_LOAN_TERM, LIEN1_INTEREST_RATE_USED, LIEN1_LENDER_NAME, LIEN1_BORROWER1_NAME, LIEN1_BORROWER2_NAME, YEAR_BUILT, LIVING_AREA, LOT_SIZE, PROPERTY_TYPE, BEDROOMS, BATHROOMS_TOTAL, OWNER_NAME, PROPENSITY_SELL_PERCENTILE_ZIP, PROPENSITY_REFINANCE_PERCENTILE_ZIP

STYLE RULES — follow exactly, no exceptions:
- Return ONLY the SQL query. No markdown fences, no explanation, no preamble.
- Always SELECT * FROM BULK_PROPERTY_DATA_WITH_PROPENSITY_PRIVATE_SHARE_USA WHERE ... LIMIT 10000;
- Always end with LIMIT 10000;
- Always include: AND NOT LIEN1_LENDER_NAME ILIKE '%BARRETT FINANCIAL GROUP%'
- All string comparisons use ILIKE with % wildcards on both sides: ILIKE '%value%'
- Multiple values for the same field use OR inside parentheses:
    ( LIEN1_LOAN_TYPE ILIKE '%VA%'
      OR LIEN1_LOAN_TYPE ILIKE '%FHA%'
      OR LIEN1_LOAN_TYPE ILIKE '%CONVENTIONAL%' )
- Numeric ranges use >= and <= inside parentheses:
    (LIEN1_INTEREST_RATE_USED >= 6.250 AND LIEN1_INTEREST_RATE_USED <= 9.000)
- Date ranges use BETWEEN:
    LIEN1_CONTRACT_DATE BETWEEN '2021-09-01' AND '2025-07-31'
- Owner occupied YES: NOT OWNER_OCCUPIED_YN IS NULL
- Owner occupied NO (non-owner): OWNER_OCCUPIED_YN IS NULL
- Dollar equity: (HC_VALUE_ESTIMATE - LIEN1_PRINCIPAL_OUTSTANDING) > amount
- Percent equity: ROUND(((HC_VALUE_ESTIMATE - LIEN1_PRINCIPAL_OUTSTANDING) / NULLIF(HC_VALUE_ESTIMATE, 0)) * 100, 2) >= percent
- The 13 MN county scope: Mille Lacs, Kanabec, Isanti, Chisago, Sherburne, Anoka, Hennepin, Ramsey, Washington, Dakota, Scott, Carver, Wright — use COUNTY IN (...) when targeting these
- If input is a pasted Excel row (tab-separated), parse the values as a lead request form
- If free-form, interpret intent and build appropriate filters matching the style above`;

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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + data)); }
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
    const { request, mode } = JSON.parse(event.body);
    const prompt = mode === 'paste'
      ? `Generate SQL for this pasted Excel row request:\n\n${request}`
      : `Generate SQL for this lead list description:\n\n${request}`;
    const result = await claudeRequest([{ role: 'user', content: prompt }]);
    const sql = ensurePropensityCols(result.content?.[0]?.text || '');
    return { statusCode: 200, headers, body: JSON.stringify({ sql }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
