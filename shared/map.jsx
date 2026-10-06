import React,{useEffect,useRef,useState} from 'react';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import TileLayer from '@arcgis/core/layers/TileLayer';
import Graphic from '@arcgis/core/Graphic';
import esriConfig from '@arcgis/core/config';
import {graphicOptions} from './geometry.js';
import '@arcgis/core/assets/esri/themes/light/main.css';
esriConfig.assetsPath='https://js.arcgis.com/5.1/@arcgis/core/assets';
export default function GeoMap({features=[],onSelect,selectedId,center=[-96.8,32.78],zoom=12,onMapClick,height}){
 const node=useRef(),view=useRef(),layer=useRef(),source=useRef([]),select=useRef(onSelect),click=useRef(onMapClick);
 const revision=useRef(0),initial=useRef({center,zoom});
 const [longitude,latitude]=center;
 const [ready,setReady]=useState(false),[error,setError]=useState('');select.current=onSelect;click.current=onMapClick;
 useEffect(()=>{
  let active=true;
  const graphics=new GraphicsLayer();layer.current=graphics;
  const map=new Map({layers:[new TileLayer({url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer'}),graphics]});
  const v=new MapView({container:node.current,map,center:initial.current.center,zoom:initial.current.zoom,ui:{components:[]},constraints:{snapToZoom:false}});view.current=v;
  v.when(()=>{if(active&&view.current===v)setReady(true);}).catch(e=>{if(active&&view.current===v)setError(e.message);});
  const handle=v.on('click',async event=>{
   const clickedSource=source.current;
   const clickedRevision=revision.current;
   try {
    const result=await v.hitTest(event,{include:graphics});
    if(!active||view.current!==v||clickedRevision!==revision.current)return;
    const hit=result.results.find(x=>x.graphic);
    if(hit){const index=hit.graphic.attributes?._featureIndex;const feature=Number.isInteger(index)?clickedSource[index]:null;if(feature)select.current?.(feature);}
    else if(event.mapPoint){click.current?.([event.mapPoint.longitude,event.mapPoint.latitude]);}
    setError('');
   } catch(failure) {if(active&&view.current===v&&failure.name!=='AbortError')setError(failure.message);}
  });
  return ()=>{active=false;handle.remove();v.destroy();if(view.current===v)view.current=null;if(layer.current===graphics)layer.current=null;};
 },[]);
 useEffect(()=>{if(!layer.current)return;const list=Array.isArray(features)?features:features?.features||[];source.current=list;revision.current+=1;layer.current.removeAll();layer.current.addMany(list.map((feature,index)=>graphicOptions(feature,index,selectedId)).filter(Boolean).map(options=>new Graphic(options)));},[features,selectedId,ready]);
 useEffect(()=>{if(view.current)view.current.center=[longitude,latitude];},[longitude,latitude]);
 useEffect(()=>{if(view.current)view.current.zoom=zoom;},[zoom]);
 return <div className="geo-map" style={height?{height}:undefined}><div ref={node} className="map-canvas" role="region" aria-label="Interactive geographic map"/><div className="map-controls"><button type="button" aria-label="Zoom in" onClick={()=>{if(view.current)view.current.zoom+=1;}}>+</button><button type="button" aria-label="Zoom out" onClick={()=>{if(view.current)view.current.zoom-=1;}}>−</button></div>{error&&<div className="map-error" role="alert">Map could not load: {error}</div>}<span className="map-label">ArcGIS · WGS 84</span><a className="map-attribution" href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer" target="_blank" rel="noreferrer">Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China, OpenStreetMap contributors, GIS user community</a></div>;
}
