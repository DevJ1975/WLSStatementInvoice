const windows = new Map();

function checkRateLimit(key, options = {}) {
  const limit = options.limit || 20;
  const windowMs = options.windowMs || 60 * 1000;
  const now = Date.now();
  const bucket = windows.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  windows.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

module.exports = {
  checkRateLimit,
};
