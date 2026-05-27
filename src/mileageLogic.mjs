export function workLogDatesMissingMileage(workLogs = [], mileageRows = []) {
  const existingDates = new Set(
    mileageRows
      .map((row) => row?.date)
      .filter(Boolean)
  );
  return workLogs
    .map((row) => row?.date)
    .filter(Boolean)
    .filter((date, index, dates) => dates.indexOf(date) === index)
    .filter((date) => !existingDates.has(date));
}

export function reverseRouteGeometry(routeGeometry = []) {
  return [...routeGeometry].reverse().map((point) => ({ ...point }));
}

export function createRoundTripRows(baseRow, createId) {
  const outbound = {
    ...baseRow,
    id: createId(),
    purpose: baseRow.purpose || 'Outbound trip',
  };
  const inbound = {
    ...baseRow,
    id: createId(),
    from: baseRow.to,
    to: baseRow.from,
    fromPlace: baseRow.toPlace || null,
    toPlace: baseRow.fromPlace || null,
    routeGeometry: reverseRouteGeometry(baseRow.routeGeometry || []),
    purpose: baseRow.returnPurpose || 'Return trip',
  };
  delete outbound.returnPurpose;
  delete inbound.returnPurpose;
  return [outbound, inbound];
}

export function routeThumbnailPolyline(points = [], width = 96, height = 42, padding = 5) {
  const validPoints = points
    .map((point) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lng),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (!validPoints.length) return '';
  if (validPoints.length === 1) {
    return `${width / 2},${height / 2}`;
  }

  const minLat = Math.min(...validPoints.map((point) => point.lat));
  const maxLat = Math.max(...validPoints.map((point) => point.lat));
  const minLng = Math.min(...validPoints.map((point) => point.lng));
  const maxLng = Math.max(...validPoints.map((point) => point.lng));
  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  return validPoints
    .map((point) => {
      const x = padding + ((point.lng - minLng) / lngRange) * (width - padding * 2);
      const y = padding + ((maxLat - point.lat) / latRange) * (height - padding * 2);
      return `${Number(x.toFixed(1))},${Number(y.toFixed(1))}`;
    })
    .join(' ');
}
