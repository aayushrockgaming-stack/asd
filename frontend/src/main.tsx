import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Crosshair, Gauge, Hospital, Layers3, MapPin, Menu, Navigation, RefreshCw, Search, ShieldCheck, Siren, Truck, CloudRain, X } from 'lucide-react';
import './styles.css';

declare global {
  interface Window { mappls?: any; }
}

type Place = {
  label: string;
  context: string;
  lat: number;
  lon: number;
  type: string;
  source?: string;
  confidence?: number;
  eLoc?: string;
};

type Route = {
  id: string;
  name: string;
  distanceKm: number;
  etaMin: number;
  safety: number;
  traffic: string;
  risk: string;
  summary: string;
  color: string;
  geometry?: [number, number][];
  source: 'MAPPLS' | 'DEMO';
};

type LayerKey = 'traffic'|'weather'|'rainfall'|'flood'|'landslide'|'rockslide'|'earthquake'|'cyclone'|'fire'|'closures';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const token = String(import.meta.env.VITE_MAPPLS_ACCESS_TOKEN || '').trim();

const seedPlaces: Place[] = [
  ['Guwahati','Assam, India',26.1445,91.7362,'City'],['Ziro','Arunachal Pradesh, India',27.544,93.8197,'Town'],
  ['Shillong','Meghalaya, India',25.5788,91.8933,'City'],['Itanagar','Arunachal Pradesh, India',27.0844,93.6053,'City'],
  ['Kohima','Nagaland, India',25.6751,94.1086,'City'],['Imphal','Manipur, India',24.817,93.9368,'City'],
  ['Aizawl','Mizoram, India',23.7271,92.7176,'City'],['Agartala','Tripura, India',23.8315,91.2868,'City'],
  ['Gangtok','Sikkim, India',27.3389,88.6065,'City'],['Kathmandu','Bagmati, Nepal',27.7172,85.324,'City'],
  ['Thimphu','Bhutan',27.4728,89.639,'City'],['Dhaka','Bangladesh',23.8103,90.4125,'City'],
  ['New Delhi','Delhi, India',28.6139,77.209,'City'],['Kolkata','West Bengal, India',22.5726,88.3639,'City'],
].map(([label,context,lat,lon,type]) => ({label,context,lat:lat as number,lon:lon as number,type:type as string}));

function loadMappls(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.mappls) return resolve();
    if (!token) return reject(new Error('Mappls Static Key missing. Add VITE_MAPPLS_ACCESS_TOKEN to frontend/.env'));
    const old = document.querySelector('script[data-mappls="true"]') as HTMLScriptElement | null;
    if (old) {
      old.addEventListener('load', () => resolve(), { once: true });
      old.addEventListener('error', () => reject(new Error('Mappls SDK request failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.mappls = 'true';
    script.async = true;
    script.defer = true;
    script.src = `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${encodeURIComponent(token)}`;
    script.onload = () => window.mappls ? resolve() : reject(new Error('Mappls SDK loaded without the mappls object'));
    script.onerror = () => reject(new Error('Mappls SDK request failed (check Static Key / whitelist / Console access)'));
    document.head.appendChild(script);
  });
}

function formatDuration(m: number) {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h ? `${h}h ${min}m` : `${min}m`;
}

function haversine(a: Place, b: Place) {
  const R=6371, p1=a.lat*Math.PI/180, p2=b.lat*Math.PI/180, dp=(b.lat-a.lat)*Math.PI/180, dl=(b.lon-a.lon)*Math.PI/180;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

function App() {
  const mapDiv = useRef<HTMLDivElement|null>(null);
  const mapObj = useRef<any>(null);
  const routeObjects = useRef<any[]>([]);
  const markerObjects = useRef<any[]>([]);
  const [status,setStatus] = useState('INITIALIZING');
  const [error,setError] = useState('');
  const [originQ,setOriginQ] = useState('Guwahati');
  const [destQ,setDestQ] = useState('Ziro');
  const [origin,setOrigin] = useState<Place>(seedPlaces[0]);
  const [destination,setDestination] = useState<Place>(seedPlaces[1]);
  const [focused,setFocused] = useState<'origin'|'destination'>('origin');
  const [suggestions,setSuggestions] = useState<Place[]>([]);
  const [routes,setRoutes] = useState<Route[]>([]);
  const [selected,setSelected] = useState('safe');
  const [busy,setBusy] = useState(false);
  const [demo,setDemo] = useState(false);
  const [vehicle,setVehicle] = useState('car');
  const [priority,setPriority] = useState('balanced');
  const [layers,setLayers] = useState<Record<LayerKey,boolean>>({traffic:true,weather:true,rainfall:true,flood:true,landslide:true,rockslide:true,earthquake:false,cyclone:false,fire:false,closures:true});

  useEffect(() => {
    let cancelled=false;
    (async()=>{
      try {
        await loadMappls();
        if(cancelled || !mapDiv.current) return;
        const map = new window.mappls.Map(mapDiv.current,{center:{lat:23.2599,lng:77.4126},zoom:5,zoomControl:true,geolocation:true});
        mapObj.current = map;
        setStatus('LIVE');
      } catch(e) {
        const msg = e instanceof Error ? e.message : 'Mappls SDK unavailable';
        setError(msg); setStatus('MAP UNAVAILABLE');
      }
    })();
    return ()=>{cancelled=true};
  },[]);

  const popular = useMemo(()=>{
    const q=(focused==='origin'?originQ:destQ).toLowerCase().trim();
    if(!q) return seedPlaces.slice(0,6);
    const match=seedPlaces.filter(p=>(p.label+' '+p.context).toLowerCase().includes(q));
    return match.slice(0,6);
  },[originQ,destQ,focused]);

  const clearOverlays=()=>{
    routeObjects.current.forEach(o=>{try{o.remove?.()}catch{}}); routeObjects.current=[];
    markerObjects.current.forEach(o=>{try{o.remove?.()}catch{}}); markerObjects.current=[];
  };

  const drawRoutes=(rs:Route[])=>{
    const map=mapObj.current; if(!map || !window.mappls) return;
    clearOverlays();
    rs.forEach(r=>{
      if(!r.geometry?.length) return;
      try{
        const line=new window.mappls.Polyline({map,path:r.geometry.map(([lon,lat])=>({lat,lng:lon})),strokeColor:r.color,strokeOpacity:r.id===selected?1:0.62,strokeWeight:r.id===selected?7:4});
        routeObjects.current.push(line);
      }catch(e){console.error(e)}
    });
    [origin,destination].forEach(p=>{
      try { markerObjects.current.push(new window.mappls.Marker({map,position:{lat:p.lat,lng:p.lon},fitbounds:false})); } catch(e){console.error(e)}
    });
  };

  useEffect(()=>{ drawRoutes(routes); },[routes,selected,origin,destination]);

  async function fetchSuggestions(q:string) {
    const query=q.trim();
    if(!query){setSuggestions(seedPlaces.slice(0,6));return;}
    try {
      const r=await fetch(`${API}/api/search?query=${encodeURIComponent(query)}&lat=${origin.lat}&lon=${origin.lon}`);
      if(!r.ok) throw new Error('search failed');
      const data=await r.json();
      setSuggestions(data.results?.length ? data.results : popular);
    } catch { setSuggestions(popular); }
  }

  function choose(p:Place){
    if(focused==='origin'){setOrigin(p);setOriginQ(p.label)} else {setDestination(p);setDestQ(p.label)}
    setSuggestions([]);
  }

  async function locate(){
    if(!navigator.geolocation) return setError('Browser geolocation is not available.');
    navigator.geolocation.getCurrentPosition(async pos=>{
      const p:Place={label:'Current location',context:'GPS',lat:pos.coords.latitude,lon:pos.coords.longitude,type:'GPS',confidence:1};
      if(focused==='origin'){setOrigin(p);setOriginQ('Current location')} else {setDestination(p);setDestQ('Current location')}
      setSuggestions([]);
    }, err=>setError(err.message),{enableHighAccuracy:true,timeout:10000});
  }

  async function getRoutes(){
    setError(''); setBusy(true);
    try {
      const r=await fetch(`${API}/api/routes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,destination,mode:vehicle,priority,demo})});
      const data=await r.json();
      if(!r.ok) throw new Error(data.detail || 'Route request failed');
      if(!data.routes?.length) throw new Error(data.reason || 'No route data available');
      setRoutes(data.routes); setSelected(data.routes.find((x:Route)=>x.id==='safe')?.id || data.routes[0].id);
    } catch(e) { setRoutes([]); setError(e instanceof Error?e.message:'Route request failed'); }
    finally {setBusy(false)}
  }

  const selectedRoute=routes.find(r=>r.id===selected);

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Navigation size={20}/></div><div><h1>NER Route Intelligence</h1><span>Live road + multi-hazard safety engine</span></div></div>
      <div className="modebar"><span className={status==='LIVE'?'live-dot':'warn-dot'}></span><b>{status}</b><span className="mode-right">{demo?'DEMO':'PRODUCTION'}</span></div>
      <section className="panel search-panel">
        <div className="field-label">ORIGIN</div>
        <div className="searchbox"><MapPin size={16}/><input value={originQ} onFocus={()=>{setFocused('origin');fetchSuggestions(originQ)}} onChange={e=>{setFocused('origin');setOriginQ(e.target.value);fetchSuggestions(e.target.value)}}/><button title="Use current location" onClick={locate}><Crosshair size={16}/></button></div>
        <div className="field-label">DESTINATION</div>
        <div className="searchbox"><MapPin size={16}/><input value={destQ} onFocus={()=>{setFocused('destination');fetchSuggestions(destQ)}} onChange={e=>{setFocused('destination');setDestQ(e.target.value);fetchSuggestions(e.target.value)}}/></div>
        {suggestions.length>0 && <div className="suggestions">{suggestions.map((p,i)=><button key={`${p.label}-${p.lat}-${i}`} onMouseDown={e=>{e.preventDefault();choose(p)}}><b>{p.label}</b><span>{p.context} · {p.type}{p.source?' · '+p.source:''}</span></button>)}</div>}
        <div className="controls"><label><span>VEHICLE</span><select value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="car">Car</option><option value="ambulance">Ambulance</option><option value="truck">Truck</option><option value="bus">Bus</option><option value="bike">Bike</option></select></label><label><span>PRIORITY</span><select value={priority} onChange={e=>setPriority(e.target.value)}><option value="balanced">Balanced</option><option value="fastest">Fastest</option><option value="safest">Safest</option><option value="emergency">Emergency</option></select></label></div>
        <button className="primary" onClick={getRoutes} disabled={busy}>{busy?<><RefreshCw className="spin" size={16}/>Calculating...</>:<>Find safest routes <Navigation size={16}/></>}</button>
        <label className="demo-toggle"><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/><span>Enable DEMO DATA</span></label>
      </section>
      <section className="panel corridor"><div className="section-title"><CloudRain size={16}/> ROUTE CORRIDOR WEATHER</div><div className="weather-main"><strong>--°C</strong><div><b>No live weather yet</b><span>Configure IMD adapter in backend</span></div></div><div className="weather-row"><span>Rain --%</span><span>Wind -- km/h</span><span>Visibility --</span></div></section>
      <section className="panel route-panel"><div className="section-title"><ShieldCheck size={16}/> ROUTE OPTIONS</div>{routes.length===0?<div className="empty">No routes yet.<br/>Choose locations and press <b>Find safest routes</b>.</div>:routes.map(r=><button className={`route-card ${r.id===selected?'selected':''}`} key={r.id} onClick={()=>setSelected(r.id)}><div className="route-head"><span className="route-stripe" style={{background:r.color}}></span><div><b>{r.name}</b><span>{r.distanceKm.toFixed(1)} km · {formatDuration(r.etaMin)}</span></div><strong>{r.safety}/100</strong></div><div className="route-detail"><span>{r.traffic}</span><span>{r.risk}</span></div><small>{r.summary}</small></button>)}</section>
      {selectedRoute && <section className="panel explain"><b>{selectedRoute.name}</b><div>{selectedRoute.source} route · {selectedRoute.safety}/100 safety</div><p>{selectedRoute.summary}</p></section>}
    </aside>
    <main className="main">
      <div className="topbar"><button><AlertTriangle size={15}/> Current issues</button><button><Siren size={15}/> Hazard signals</button><button><Gauge size={15}/> Live pace</button><button><Hospital size={15}/> Hospitals & fuel</button><button><MapPin size={15}/> Field reports</button><button><Truck size={15}/> Report</button><div className="top-status"><span className={status==='LIVE'?'live-dot':'warn-dot'}></span>{status}<small>Data freshness enforced</small></div></div>
      <div className="map-shell"><div ref={mapDiv} className="map"></div>{error && <div className="map-error"><div className="error-box"><div className="error-title"><AlertTriangle size={18}/> Map / routing issue</div><div>{error}</div><div className="error-hint">Check <code>VITE_MAPPLS_ACCESS_TOKEN</code>, Mappls Web App whitelisting, allocations, and the backend on port 8000.</div><button onClick={()=>setError('')}>Dismiss</button></div></div>}
        <div className="layer-panel"><div className="layer-title"><Layers3 size={14}/> MAP LAYERS</div>{(Object.keys(layers) as LayerKey[]).map(k=><label key={k}><input type="checkbox" checked={layers[k]} onChange={e=>setLayers({...layers,[k]:e.target.checked})}/><span>{k.replace(/^./,c=>c.toUpperCase())}</span></label>)}</div>
        <div className="legend"><b>RISK</b><span>🟢 Low</span><span>🟡 Moderate</span><span>🟠 High</span><span>🔴 Severe</span></div>
        <div className="corner-note">Map provider: Mappls · Routing/provider adapters isolated in backend</div>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
