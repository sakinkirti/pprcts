const crypto = require('crypto');

const buckets = new Map();

function securityHeaders(req, res, next) {
  const suppliedRequestId = req.get('x-request-id');
  const requestId = typeof suppliedRequestId === 'string'
    && /^[A-Za-z0-9._-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  req.requestId = requestId;
  res.set({
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function corsAllowlist(req, res, next) {
  const origin = req.get('origin');
  const configured = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && !configured.includes(origin)) {
    return res.status(403).json({ error: 'Origin is not allowed' });
  }
  if (origin) res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function getRateLimitKey(keyPrefix, identity) {
  const payload = `${keyPrefix}:${identity}`;
  const salt = process.env.RATE_LIMIT_HASH_SALT;
  return salt
    ? crypto.createHmac('sha256', salt).update(payload).digest('hex')
    : crypto.createHash('sha256').update(payload).digest('hex');
}

async function consumeDistributedRateLimit(client, key, windowMs, limit) {
  const { data, error } = await client.rpc('consume_api_rate_limit', {
    p_key: key,
    p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    p_limit: limit,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.is_allowed !== 'boolean') {
    throw new Error('Rate limit store returned an invalid result');
  }
  return {
    allowed: result.is_allowed,
    remaining: Number(result.remaining_requests) || 0,
    resetAt: new Date(result.resets_at).getTime(),
  };
}

function consumeLocalRateLimit(key, windowMs, limit) {
  const now = Date.now();
  const existing = buckets.get(key);
  const entry = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  entry.count += 1;
  buckets.set(key, entry);
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

function rateLimit({ windowMs, limit, keyPrefix, client = null, failClosed = false }) {
  return async (req, res, next) => {
    const identity = req.user?.id || req.ip;
    const key = getRateLimitKey(keyPrefix, identity);
    let result;
    try {
      result = client
        ? await consumeDistributedRateLimit(client, key, windowMs, limit)
        : consumeLocalRateLimit(key, windowMs, limit);
    } catch (error) {
      console.error(`[${req.requestId || 'rate-limit'}] Rate limit store error:`, error.message);
      if (failClosed) {
        return res.status(503).json({ error: 'Request protection is temporarily unavailable' });
      }
      result = consumeLocalRateLimit(key, windowMs, limit);
    }
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(result.remaining));
    res.set('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

module.exports = {
  consumeDistributedRateLimit,
  getRateLimitKey,
  securityHeaders,
  corsAllowlist,
  rateLimit,
  requireAuth,
  isIsoDate,
};
