const { sendJson } = require('../_lib/http');

const cache = new Map();
const cacheTtlMs = 60 * 60 * 1000;
const metersPerMile = 1609.344;

function getQuery(req, key) {
  const value = req.query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function readCoordinate(req, key) {
  const value = Number(getQuery(req, key));
  return Number.isFinite(value) ? value : null;
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

    const fromLat = readCoordinate(req, 'fromLat');
    const fromLng = readCoordinate(req, 'fromLng');
    const toLat = readCoordinate(req, 'toLat');
    const toLng = readCoordinate(req, 'toLng');

    if ([fromLat, fromLng, toLat, toLng].some((value) => value === null)) {
      sendJson(res, 400, { error: 'Valid from/to coordinates are required.' });
      return;
    }

    const cacheKey = [fromLat, fromLng, toLat, toLng].map((value) => value.toFixed(5)).join(',');
    const cachedRoute = cached(cacheKey);
    if (cachedRoute) {
      sendJson(res, 200, { route: cachedRoute, cached: true });
      return;
    }

    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}`);
    url.searchParams.set('overview', 'simplified');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WLSStatementInvoice/1.0',
      },
    });
    const payload = await response.json().catch(() => ({}));
    const route = payload.routes?.[0];
    if (!response.ok || !route) {
      sendJson(res, response.status || 502, { error: payload.message || 'Route calculation failed.' });
      return;
    }

    const geometry = (route.geometry?.coordinates || [])
      .map(([lng, lat]) => ({
        lat: Number(Number(lat).toFixed(6)),
        lng: Number(Number(lng).toFixed(6)),
      }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    const result = {
      distanceMeters: route.distance,
      distanceMiles: Number((route.distance / metersPerMile).toFixed(2)),
      durationSeconds: Math.round(route.duration || 0),
      routeGeometry: geometry,
    };

    setCache(cacheKey, result);
    sendJson(res, 200, { route: result });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Unexpected route calculation error.' });
  }
};
