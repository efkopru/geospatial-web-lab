import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { arcgisPolygonRings, graphicOptions } from '../shared/geometry.js';
import GeoMap from '../shared/map.jsx';

const mocked = vi.hoisted(() => ({ views: [], layers: [] }));
vi.mock('@arcgis/core/Map', () => ({ default: class {} }));
vi.mock('@arcgis/core/layers/TileLayer', () => ({ default: class {} }));
vi.mock('@arcgis/core/config', () => ({ default: {} }));
vi.mock('@arcgis/core/Graphic', () => ({ default: class { constructor(options) { Object.assign(this, options); } } }));
vi.mock('@arcgis/core/layers/GraphicsLayer', () => ({ default: class {
  constructor() { this.graphics = []; mocked.layers.push(this); }
  removeAll() { this.graphics = []; }
  addMany(graphics) { this.graphics.push(...graphics); }
} }));
vi.mock('@arcgis/core/views/MapView', () => ({ default: class {
  constructor(options) { Object.assign(this, options); this.hitTest = vi.fn(); this.destroy = vi.fn(); mocked.views.push(this); }
  when(callback) { return new Promise((resolve, reject) => { this.ready = () => { callback(); resolve(); }; this.fail = reject; }); }
  on(_name, callback) { this.clicked = callback; return { remove: vi.fn() }; }
} }));

const square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
const signedArea = (ring) => ring.reduce((area, point, index) => { const next = ring[(index + 1) % ring.length]; return area + point[0] * next[1] - next[0] * point[1]; }, 0);
const point = (x) => ({ type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [x, 0] } });
beforeEach(() => { mocked.views.length = 0; mocked.layers.length = 0; });
afterEach(cleanup);

describe('GeoJSON to ArcGIS geometry', () => {
  it('converts GeoJSON exterior and hole winding without mutating source coordinates', () => {
    const geometry = { type: 'Polygon', coordinates: [structuredClone(square), structuredClone(hole)] };
    const before = structuredClone(geometry);
    const rings = arcgisPolygonRings(geometry);
    expect(signedArea(rings[0])).toBeLessThan(0);
    expect(signedArea(rings[1])).toBeGreaterThan(0);
    expect(geometry).toEqual(before);
    rings[0][0][0] = 99;
    expect(geometry).toEqual(before);
  });

  it('preserves separate exteriors and holes when flattening MultiPolygons', () => {
    const rings = arcgisPolygonRings({ type: 'MultiPolygon', coordinates: [[square, hole], [square.map(([x, y]) => [x + 10, y])]] });
    expect(rings.map(signedArea)).toEqual([-32, 2, -32]);
  });

  it('does not select anonymous features and gives each a separate lookup index', () => {
    expect(graphicOptions(point(1), 0).symbol.size).toBe(10);
    expect(graphicOptions(point(2), 1).attributes._featureIndex).toBe(1);
    expect(graphicOptions({ ...point(0), id: 0 }, 2, '0').symbol.size).toBe(16);
    expect(graphicOptions({ ...point(0), id: 'undefined' }, 3).symbol.size).toBe(10);
  });
});

describe('map lifecycle and selection', () => {
  it('selects the clicked anonymous feature rather than the first missing ID', async () => {
    const features = [point(1), point(2)];
    const select = vi.fn();
    render(<GeoMap features={features} onSelect={select} />);
    const view = mocked.views[0];
    view.hitTest.mockResolvedValue({ results: [{ graphic: mocked.layers[0].graphics[1] }] });
    await act(async () => { await view.clicked({}); });
    expect(select).toHaveBeenCalledExactlyOnceWith(features[1]);
  });

  it('ignores pending selections after unmount or replacement of displayed features', async () => {
    const features = [point(1), point(2)];
    const select = vi.fn();
    const component = render(<GeoMap features={features} onSelect={select} />);
    const view = mocked.views[0];
    const graphic = mocked.layers[0].graphics[1];
    let resolveHit;
    view.hitTest.mockImplementation(() => new Promise((resolve) => { resolveHit = resolve; }));
    const pending = view.clicked({});
    component.rerender(<GeoMap features={[point(3), point(4)]} onSelect={select} />);
    await act(async () => { resolveHit({ results: [{ graphic }] }); await pending; });
    expect(select).not.toHaveBeenCalled();
    const afterUnmount = view.clicked({});
    component.unmount();
    await act(async () => { resolveHit({ results: [{ graphic }] }); await afterUnmount; view.fail(new Error('Destroyed')); });
    expect(select).not.toHaveBeenCalled();
    expect(view.destroy).toHaveBeenCalledOnce();
  });

  it('handles selection failures and updates changed center and zoom props', async () => {
    const component = render(<GeoMap features={[]} center={[-96, 32]} zoom={10} />);
    const view = mocked.views[0];
    view.hitTest.mockRejectedValue(new Error('Renderer unavailable'));
    await act(async () => { await view.clicked({}); });
    expect(screen.getByRole('alert')).toHaveTextContent('Renderer unavailable');
    component.rerender(<GeoMap features={[]} center={[-105, 40]} zoom={13} />);
    expect(view.center).toEqual([-105, 40]);
    expect(view.zoom).toBe(13);
  });
});
