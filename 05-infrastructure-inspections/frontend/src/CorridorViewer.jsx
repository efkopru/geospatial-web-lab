import React, { useEffect, useRef, useState } from 'react';
import { Viewer, EllipsoidTerrainProvider, Cartesian3, Cartesian2, Matrix4, BoundingSphere, Color, HeadingPitchRange, ScreenSpaceEventType, ScreenSpaceEventHandler, defined, LabelStyle, VerticalOrigin, DistanceDisplayCondition, PolygonHierarchy, Math as CesiumMath } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export default function CorridorViewer({ assets, selectedId, onSelect, exaggeration, showLabels, focusRequest }) {
  const container = useRef(null);
  const viewerRef = useRef(null);
  const selectRef = useRef(onSelect);
  const initialView = useRef(false);
  const [error, setError] = useState('');
  const [compact, setCompact] = useState(false);
  selectRef.current = onSelect;

  useEffect(() => {
    let viewer;
    let handler;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 500));
    observer.observe(container.current);
    try {
      initialView.current = false;
      viewer = new Viewer(container.current, {
        terrainProvider: new EllipsoidTerrainProvider(), baseLayer: false, baseLayerPicker: false,
        geocoder: false, animation: false, timeline: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
        selectionIndicator: false, infoBox: false, skyBox: false,
        requestRenderMode: true, maximumRenderTimeChange: Infinity,
        contextOptions: { webgl: { alpha: false, antialias: true } }
      });
      viewer.scene.globe.baseColor = Color.fromCssColorString('#d8e0d2');
      viewer.scene.backgroundColor = Color.fromCssColorString('#172a2f');
      viewer.scene.globe.enableLighting = false;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 100000;
      viewer.scene.skyAtmosphere.show = false;
      viewerRef.current = viewer;
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement) => {
        const hit = viewer.scene.pick(movement.position);
        const assetId = hit?.id?.properties?.assetId?.getValue();
        if (defined(assetId)) selectRef.current(assetId);
      }, ScreenSpaceEventType.LEFT_CLICK);
    } catch (failure) {
      setError(`3D view could not initialize: ${failure.message}. Use a WebGL-capable browser; asset records remain available below.`);
    }
    return () => { observer.disconnect(); handler?.destroy(); if (viewer && !viewer.isDestroyed()) viewer.destroy(); viewerRef.current = null; };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !assets.length) return;
    viewer.entities.removeAll();
    const baseline = Math.min(...assets.map((asset) => asset.ground_elevation_m));
    const displayedGround = (asset) => baseline + (asset.ground_elevation_m - baseline) * exaggeration;
    assets.slice(0, -1).forEach((asset, index) => {
      const next = assets[index + 1];
      const offset = 0.00022;
      const coordinates = [asset.longitude, asset.latitude - offset, displayedGround(asset), next.longitude, next.latitude - offset, displayedGround(next), next.longitude, next.latitude + offset, displayedGround(next), asset.longitude, asset.latitude + offset, displayedGround(asset)];
      viewer.entities.add({ polygon: { hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArrayHeights(coordinates)), perPositionHeight: true, material: Color.fromCssColorString(index % 2 ? '#90ab8d' : '#9fb497'), outline: false } });
      viewer.entities.add({ polyline: { positions: Cartesian3.fromDegreesArrayHeights([asset.longitude, asset.latitude, displayedGround(asset) + 0.6, next.longitude, next.latitude, displayedGround(next) + 0.6]), width: 2, material: Color.fromCssColorString('#dbe5d6') } });
    });
    assets.forEach((asset) => {
      const active = asset.id === selectedId;
      const color = Color.fromCssColorString(asset.critical_inspections ? '#ef4444' : asset.open_inspections ? '#f59e0b' : '#267b91');
      const base = displayedGround(asset);
      const height = asset.structure_height_m * exaggeration;
      const common = { properties: { assetId: asset.id } };
      if (asset.kind === 'cabinet') {
        viewer.entities.add({ ...common, position: Cartesian3.fromDegrees(asset.longitude, asset.latitude, base + height / 2), box: { dimensions: new Cartesian3(3.5 * exaggeration, 2.5 * exaggeration, height), material: color, outline: active, outlineColor: Color.WHITE } });
      } else {
        viewer.entities.add({ ...common, position: Cartesian3.fromDegrees(asset.longitude, asset.latitude, base + height / 2), cylinder: { length: height, topRadius: asset.kind === 'tower' ? 1 * exaggeration : 0.7 * exaggeration, bottomRadius: asset.kind === 'tower' ? 5 * exaggeration : 0.8 * exaggeration, material: color.withAlpha(active ? 1 : 0.86), outline: active, outlineColor: Color.WHITE } });
        viewer.entities.add({ ...common, polyline: { positions: Cartesian3.fromDegreesArrayHeights([asset.longitude - 0.00003 * exaggeration, asset.latitude, base + height * 0.8, asset.longitude + 0.00003 * exaggeration, asset.latitude, base + height * 0.8]), width: active ? 5 : 3, material: color } });
      }
      viewer.entities.add({ ...common, id: `asset-${asset.id}`, position: Cartesian3.fromDegrees(asset.longitude, asset.latitude, base + height + 2),
        point: { pixelSize: active ? 12 : 7, color, outlineColor: Color.WHITE, outlineWidth: active ? 3 : 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { show: showLabels && (!compact || active), text: `${asset.asset_code}\n${asset.structure_height_m} m`, font: active ? 'bold 13px sans-serif' : '12px sans-serif', fillColor: Color.WHITE, style: LabelStyle.FILL_AND_OUTLINE, outlineColor: Color.fromCssColorString('#1b3039'), outlineWidth: 4, verticalOrigin: VerticalOrigin.BOTTOM, showBackground: true, backgroundColor: Color.fromCssColorString('#1b3039').withAlpha(0.72), pixelOffset: new Cartesian2(0, -16), distanceDisplayCondition: new DistanceDisplayCondition(0, 15000), disableDepthTestDistance: Number.POSITIVE_INFINITY }
      });
    });
    if (!initialView.current) {
      initialView.current = true;
      const center = Cartesian3.fromDegrees(assets.reduce((sum, asset) => sum + asset.longitude, 0) / assets.length, assets.reduce((sum, asset) => sum + asset.latitude, 0) / assets.length, baseline + 30);
      viewer.camera.lookAt(center, new HeadingPitchRange(CesiumMath.toRadians(15), CesiumMath.toRadians(-32), 2800));
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    }
    viewer.scene.requestRender();
  }, [assets, selectedId, exaggeration, showLabels, compact]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !assets.length || !focusRequest) return;
    if (focusRequest.mode === 'all') {
      const center = Cartesian3.fromDegrees(assets.reduce((sum, asset) => sum + asset.longitude, 0) / assets.length, assets.reduce((sum, asset) => sum + asset.latitude, 0) / assets.length, Math.min(...assets.map((asset) => asset.ground_elevation_m)) + 30);
      viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 1), { duration: 0.8, offset: new HeadingPitchRange(0.25, -0.6, 2800) });
    }
    else {
      const asset = assets.find((item) => item.id === selectedId);
      if (asset) {
        const baseline = Math.min(...assets.map((item) => item.ground_elevation_m));
        const center = Cartesian3.fromDegrees(asset.longitude, asset.latitude, baseline + (asset.ground_elevation_m - baseline + asset.structure_height_m / 2) * exaggeration);
        viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 1), { duration: 0.8, offset: new HeadingPitchRange(0.3, -0.45, 280) });
      }
    }
  }, [focusRequest]);

  return <div className="corridor-viewer-shell"><div ref={container} className="corridor-viewer" aria-label="Interactive Cesium 3D infrastructure corridor" />{error && <div className="corridor-webgl-error" role="alert">{error}</div>}<div className="corridor-map-caption">Synthetic surface · Ellipsoid terrain · Height display {exaggeration}×</div></div>;
}
