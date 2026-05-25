const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { getMembersCollection, getSessionsCollection, toObjectId } = require('./mongo');
const { sendJson } = require('./http');

const scryptAsync = promisify(scrypt);
const siteId = 'default';
const sessionCookieName = 'wls_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
let indexPromise;
let seedPromise;

class AuthSetupRequiredError extends Error {
  constructor() {
    super('Admin setup is required before members can sign in.');
    this.code = 'AUTH_SETUP_REQUIRED';
  }
}

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'member';
}

function normalizeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

function sanitizeMember(member) {
  if (!member) return null;
  return {
    id: String(member._id || member.id),
    siteId: member.siteId || siteId,
    accountNumber: String(member.accountNumber || ''),
    name: member.name || '',
    email: member.email || '',
    phone: member.phone || '',
    role: normalizeRole(member.role),
    status: normalizeStatus(member.status),
    createdAt: member.createdAt || null,
    updatedAt: member.updatedAt || null,
  };
}

async function ensureAuthIndexes() {
  if (!indexPromise) {
    indexPromise = Promise.all([
      getMembersCollection().then((collection) =>
        collection.createIndex({ siteId: 1, accountNumber: 1 }, { unique: true })
      ),
      getSessionsCollection().then((collection) => collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })),
      getSessionsCollection().then((collection) => collection.createIndex({ tokenHash: 1 }, { unique: true })),
    ]);
  }
  return indexPromise;
}

async function hashPin(pin) {
  const value = cleanString(pin);
  if (value.length < 4) {
    throw new Error('PIN must be at least 4 digits.');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(value, salt, 64);
  return { pinSalt: salt, pinHash: derived.toString('hex') };
}

async function verifyPin(pin, member) {
  if (!member?.pinSalt || !member?.pinHash) return false;
  const derived = await scryptAsync(cleanString(pin), member.pinSalt, 64);
  const expected = Buffer.from(member.pinHash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const index = item.indexOf('=');
      if (index > -1) cookies[item.slice(0, index)] = decodeURIComponent(item.slice(index + 1));
      return cookies;
    }, {});
}

function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

function setSessionCookie(req, res, token) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${sessionMaxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${sessionCookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function generateAccountNumber(collection, requested = '') {
  const cleaned = cleanString(requested);
  if (/^\d{4}$/.test(cleaned) && Number(cleaned) >= 1000) return cleaned;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = String(1000 + Math.floor(Math.random() * 9000));
    const existing = await collection.findOne({ siteId, accountNumber: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  throw new Error('Could not generate an unused account number.');
}

async function createMemberRecord(input = {}) {
  await ensureAuthIndexes();
  const collection = await getMembersCollection();
  const now = new Date();
  const pinFields = await hashPin(input.pin);
  const doc = {
    siteId,
    accountNumber: await generateAccountNumber(collection, input.accountNumber),
    name: cleanString(input.name) || 'Member',
    email: cleanString(input.email),
    phone: cleanString(input.phone),
    role: normalizeRole(input.role),
    status: normalizeStatus(input.status),
    ...pinFields,
    createdAt: now,
    updatedAt: now,
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await collection.insertOne(doc);
      return sanitizeMember({ ...doc, _id: result.insertedId });
    } catch (error) {
      if (error.code !== 11000 || input.accountNumber) throw error;
      doc.accountNumber = await generateAccountNumber(collection);
    }
  }
  throw new Error('Could not create member with a unique account number.');
}

async function ensureInitialAdmin() {
  if (seedPromise) {
    const cached = await seedPromise;
    if (!cached.setupRequired) return cached;
    seedPromise = null;
  }
  if (!seedPromise) {
    seedPromise = (async () => {
      await ensureAuthIndexes();
      const collection = await getMembersCollection();
      const admin = await collection.findOne({ siteId, role: 'admin' }, { projection: { _id: 1 } });
      if (admin) return { seeded: false };
      if (!process.env.ADMIN_PIN) return { setupRequired: true };
      const count = await collection.countDocuments({ siteId });
      if (count > 0) return { seeded: false };
      const member = await createMemberRecord({
        name: process.env.ADMIN_NAME || 'Administrator',
        pin: process.env.ADMIN_PIN,
        accountNumber: process.env.ADMIN_ACCOUNT_NUMBER,
        role: 'admin',
        status: 'active',
      });
      return { seeded: true, member };
    })();
  }
  return seedPromise;
}

async function assertAuthReady() {
  const setup = await ensureInitialAdmin();
  if (setup.setupRequired) throw new AuthSetupRequiredError();
}

async function createSession(req, res, member) {
  const collection = await getSessionsCollection();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionMaxAgeSeconds * 1000);
  await collection.insertOne({
    siteId,
    tokenHash: tokenHash(token),
    memberId: String(member._id || member.id),
    role: normalizeRole(member.role),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    createdAt: now,
    expiresAt,
  });
  setSessionCookie(req, res, token);
  return expiresAt;
}

async function currentMember(req) {
  await assertAuthReady();
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;

  const sessions = await getSessionsCollection();
  const session = await sessions.findOne({ siteId, tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;

  const members = await getMembersCollection();
  const memberId = toObjectId(session.memberId);
  if (!memberId) return null;
  const member = await members.findOne({ _id: memberId, siteId, status: 'active' });
  if (!member) return null;
  return sanitizeMember(member);
}

async function requireAuth(req, res) {
  try {
    const member = await currentMember(req);
    if (!member) {
      sendJson(res, 401, { error: 'Please sign in.', authenticated: false });
      return null;
    }
    return member;
  } catch (error) {
    if (error.code === 'AUTH_SETUP_REQUIRED') {
      sendJson(res, 503, { error: error.message, setupRequired: true });
      return null;
    }
    throw error;
  }
}

async function requireAdmin(req, res) {
  const member = await requireAuth(req, res);
  if (!member) return null;
  if (member.role !== 'admin') {
    sendJson(res, 403, { error: 'Admin access is required.' });
    return null;
  }
  return member;
}

function defaultSiteFilter() {
  return { $or: [{ siteId }, { siteId: { $exists: false } }] };
}

function projectListFilter(member) {
  if (member.role === 'admin') return defaultSiteFilter();
  return { siteId, memberId: member.id };
}

function projectAccessFilter(member, _id) {
  const idFilter = { _id };
  if (member.role === 'admin') return { $and: [idFilter, defaultSiteFilter()] };
  return { ...idFilter, siteId, memberId: member.id };
}

async function logout(req, res) {
  const token = parseCookies(req)[sessionCookieName];
  if (token) {
    const sessions = await getSessionsCollection();
    await sessions.deleteOne({ siteId, tokenHash: tokenHash(token) });
  }
  clearSessionCookie(req, res);
}

module.exports = {
  AuthSetupRequiredError,
  assertAuthReady,
  clearSessionCookie,
  createMemberRecord,
  createSession,
  currentMember,
  defaultSiteFilter,
  generateAccountNumber,
  hashPin,
  logout,
  projectAccessFilter,
  projectListFilter,
  requireAdmin,
  requireAuth,
  sanitizeMember,
  siteId,
  verifyPin,
};
