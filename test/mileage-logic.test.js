const test = require('node:test');
const assert = require('node:assert/strict');

test('workLogDatesMissingMileage skips dates that already have mileage', async () => {
  const { workLogDatesMissingMileage } = await import('../src/mileageLogic.mjs');
  const dates = workLogDatesMissingMileage(
    [{ date: '2026-05-11' }, { date: '2026-05-12' }, { date: '2026-05-12' }, { date: '' }],
    [{ date: '2026-05-11' }]
  );

  assert.deepEqual(dates, ['2026-05-12']);
});

test('createRoundTripRows creates outbound and reversed return rows', async () => {
  const { createRoundTripRows } = await import('../src/mileageLogic.mjs');
  let index = 0;
  const rows = createRoundTripRows(
    {
      date: '2026-05-11',
      from: 'Home',
      to: 'Site',
      purpose: 'Travel to site',
      returnPurpose: 'Return from site',
      routeGeometry: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
      fromPlace: { label: 'Home' },
      toPlace: { label: 'Site' },
    },
    () => `row-${++index}`
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'row-1');
  assert.equal(rows[1].id, 'row-2');
  assert.equal(rows[0].from, 'Home');
  assert.equal(rows[1].from, 'Site');
  assert.equal(rows[1].to, 'Home');
  assert.deepEqual(rows[1].routeGeometry, [{ lat: 2, lng: 2 }, { lat: 1, lng: 1 }]);
  assert.equal(rows[1].purpose, 'Return from site');
});

test('routeThumbnailPolyline normalizes route points into an SVG polyline', async () => {
  const { routeThumbnailPolyline } = await import('../src/mileageLogic.mjs');
  const polyline = routeThumbnailPolyline(
    [
      { lat: 34, lng: -118 },
      { lat: 35, lng: -117 },
    ],
    100,
    50,
    5
  );

  assert.equal(polyline, '5,45 95,5');
  assert.equal(routeThumbnailPolyline([]), '');
});
