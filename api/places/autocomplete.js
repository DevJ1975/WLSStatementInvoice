const { sendJson } = require('../_lib/http');

const cache = new Map();
const cacheTtlMs = 15 * 60 * 1000;

function getQuery(req, key) {
  const value = req.query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function cached(key) {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.createdAt > cacheTtlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { value, createdAt: Date.now() });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      sendJson(res, 503, { error: 'Missing GEOAPIFY_API_KEY environment variable.' });
      return;
    }

    const text = (getQuery(req, 'text') || '').trim();
    if (text.length < 3) {
      sendJson(res, 200, { suggestions: [] });
      return;
    }

    const cacheKey = text.toLowerCase();
    const cachedSuggestions = cached(cacheKey);
    if (cachedSuggestions) {
      sendJson(res, 200, { suggestions: cachedSuggestions, cached: true });
      return;
    }

    const country = (getQuery(req, 'country') || '').trim().toLowerCase();
    const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
    url.searchParams.set('text', text);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    url.searchParams.set('apiKey', apiKey);
    if (country) {
      url.searchParams.set('filter', `countrycode:${country}`);
    }

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WLSStatementInvoice/1.0',
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      sendJson(res, response.status, { error: payload.message || 'Address autocomplete failed.' });
      return;
    }

    const suggestions = (payload.results || [])
      .map((result) => ({
        id: result.place_id || `${result.lat},${result.lon}`,
        label: result.formatted || result.address_line1 || text,
        lat: Number(result.lat),
        lng: Number(result.lon),
        city: result.city || '',
        state: result.state || '',
        postcode: result.postcode || '',
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));

    setCache(cacheKey, suggestions);
    sendJson(res, 200, { suggestions });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Unexpected address autocomplete error.' });
  }
};
