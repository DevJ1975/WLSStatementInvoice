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
