const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPin, sanitizeMember, verifyPin } = require('../api/_lib/auth');

test('PIN hashes verify without exposing the original PIN', async () => {
  const fields = await hashPin('2468');

  assert.ok(fields.pinSalt);
  assert.ok(fields.pinHash);
  assert.notEqual(fields.pinHash, '2468');
  assert.equal(await verifyPin('2468', fields), true);
  assert.equal(await verifyPin('1357', fields), false);
});

test('sanitizeMember returns account fields without PIN hash fields', () => {
  const member = sanitizeMember({
    _id: 'member-1',
    siteId: 'default',
    accountNumber: '4321',
    name: 'Jamil',
    email: 'jamil@example.com',
    phone: '555-0100',
    role: 'admin',
    status: 'active',
    pinSalt: 'salt',
    pinHash: 'hash',
  });

  assert.deepEqual(member, {
    id: 'member-1',
    siteId: 'default',
    accountNumber: '4321',
    name: 'Jamil',
    email: 'jamil@example.com',
    phone: '555-0100',
    role: 'admin',
    status: 'active',
    createdAt: null,
    updatedAt: null,
  });
});
