const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPin, sanitizeMember, verifyPin } = require('../api/_lib/auth');
const { normalizeMemberPreferences } = require('../api/_lib/preferences');

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

test('normalizeMemberPreferences keeps valid mileage locations only', () => {
  const preferences = normalizeMemberPreferences({
    mileageLocations: [
      {
        id: 'home-1',
        label: 'Home',
        type: 'home',
        address: '123 Main St',
        place: { id: 'place-1', label: '123 Main St', lat: 34.1, lng: -117.2 },
      },
      { id: 'bad', label: 'No coordinates', address: 'Unknown' },
      {
        id: 'home-1',
        label: 'Duplicate',
        type: 'home',
        address: 'Duplicate',
        place: { lat: 34.2, lng: -117.3 },
      },
    ],
  });

  assert.deepEqual(preferences.mileageLocations, [
    {
      id: 'home-1',
      label: 'Home',
      type: 'home',
      address: '123 Main St',
      place: {
        id: 'place-1',
        label: '123 Main St',
        lat: 34.1,
        lng: -117.2,
        city: '',
        state: '',
        postcode: '',
      },
    },
  ]);
});
