const mileageLocationTypes = new Set(['home', 'office', 'site', 'hotel', 'airport', 'custom']);

function cleanString(value) {
  return String(value || '').trim();
}

function normalizePlace(place) {
  if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return null;
  return {
    id: cleanString(place.id) || `${place.lat},${place.lng}`,
    label: cleanString(place.label),
    lat: Number(place.lat),
    lng: Number(place.lng),
    city: cleanString(place.city),
    state: cleanString(place.state),
    postcode: cleanString(place.postcode),
  };
}

function normalizeMileageLocation(location) {
  const place = normalizePlace(location?.place || location);
  return {
    id: cleanString(location?.id),
    label: cleanString(location?.label) || cleanString(location?.type) || 'Location',
    type: mileageLocationTypes.has(location?.type) ? location.type : 'custom',
    address: cleanString(location?.address) || place?.label || '',
    place,
  };
}

function normalizeMemberPreferences(preferences = {}) {
  const source = preferences && typeof preferences === 'object' ? preferences : {};
  const seen = new Set();
  const mileageLocations = (Array.isArray(source.mileageLocations) ? source.mileageLocations : [])
    .map(normalizeMileageLocation)
    .filter((location) => location.id && location.address && location.place)
    .filter((location) => {
      if (seen.has(location.id)) return false;
      seen.add(location.id);
      return true;
    })
    .slice(0, 24);

  return { mileageLocations };
}

module.exports = {
  normalizeMemberPreferences,
  normalizeMileageLocation,
};
