// ArcGIS polygon rings use clockwise exteriors and counterclockwise holes.
// GeoJSON commonly uses the opposite winding. Preserve every polygon's ring
// role when flattening MultiPolygons, and never reverse the source coordinates.
export function arcgisPolygonRings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => polygon.map((ring, index) => {
    const copy = ring.map((point) => [...point]);
    let area = 0;
    for (let i = 0; i < copy.length; i += 1) {
      const current = copy[i];
      const next = copy[(i + 1) % copy.length];
      area += current[0] * next[1] - next[0] * current[1];
    }
    if ((index === 0 && area > 0) || (index > 0 && area < 0)) copy.reverse();
    return copy;
  }));
}

export function graphicOptions(feature, index, selectedId) {
  if (!feature) return null;
  const { geometry: shape } = feature;
  const properties = feature.properties || {};
  if (!shape) return null;
  const id = feature.id ?? properties.id;
  const selected = id != null && selectedId != null && String(id) === String(selectedId);
  const color = properties.color || '#24766b';
  const attributes = { ...properties, _id: id, _featureIndex: index };
  const base = { spatialReference: { wkid: 4326 } };
  let geometry;
  let symbol;
  if (shape.type === 'Point') {
    geometry = { type: 'point', longitude: shape.coordinates[0], latitude: shape.coordinates[1], ...base };
    symbol = { type: 'simple-marker', style: 'circle', size: selected ? 16 : 10, color, outline: { color: selected ? '#ffca61' : 'white', width: selected ? 3 : 1.5 } };
  }
  if (shape.type === 'MultiPoint') {
    geometry = { type: 'multipoint', points: shape.coordinates, ...base };
    symbol = { type: 'simple-marker', style: 'circle', size: selected ? 14 : 9, color, outline: { color: 'white', width: 1.5 } };
  }
  if (shape.type === 'LineString') {
    geometry = { type: 'polyline', paths: [shape.coordinates], ...base };
    symbol = { type: 'simple-line', color, width: selected ? 4 : 2.5 };
  }
  if (shape.type === 'MultiLineString') {
    geometry = { type: 'polyline', paths: shape.coordinates, ...base };
    symbol = { type: 'simple-line', color, width: selected ? 4 : 2 };
  }
  if (shape.type === 'Polygon' || shape.type === 'MultiPolygon') {
    geometry = { type: 'polygon', rings: arcgisPolygonRings(shape), ...base };
    symbol = { type: 'simple-fill', color: selected ? [225, 170, 63, .32] : [40, 120, 106, .17], outline: { color: selected ? '#bc8419' : color, width: selected ? 3 : 1.5 } };
  }
  return geometry ? { geometry, symbol, attributes } : null;
}
