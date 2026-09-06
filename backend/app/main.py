import os, math
from pathlib import Path
from typing import Literal
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .services.mappls import MapplsClient, MapplsError

load_dotenv(Path(__file__).resolve().parents[2]/'.env')

app=FastAPI(title='NER Route Intelligence API',version='1.0.0')
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_credentials=True,allow_methods=['*'],allow_headers=['*'])

class Place(BaseModel):
    label:str
    context:str=''
    lat:float=Field(ge=-90,le=90)
    lon:float=Field(ge=-180,le=180)
    type:str='Unknown'
    source:str|None=None
    confidence:float|None=None
    eLoc:str|None=None

class RouteRequest(BaseModel):
    origin:Place
    destination:Place
    mode:Literal['car','ambulance','truck','bus','bike']='car'
    priority:Literal['balanced','fastest','safest','emergency']='balanced'
    demo:bool=False

@app.get('/health')
def health():
    return {'status':'ok','mappls_configured':bool(os.getenv('MAPPLS_ACCESS_TOKEN','').strip()),'demo_default':os.getenv('DEMO_MODE','false').lower()=='true'}

@app.get('/api/config')
def config():
    return {'mapplsConfigured':bool(os.getenv('MAPPLS_ACCESS_TOKEN','').strip()),'demoDefault':os.getenv('DEMO_MODE','false').lower()=='true'}

@app.get('/api/search')
async def search(query:str=Query(min_length=1,max_length=45),lat:float|None=None,lon:float|None=None):
    try:
        client=MapplsClient()
        data=await client.autosuggest(query,lat,lon)
    except MapplsError as e:
        raise HTTPException(status_code=502,detail=str(e))
    results=[]
    for x in data.get('suggestedLocations',[]) or []:
        # Mappls documentation does not guarantee every field for every use case, so parse defensively.
        loc=x.get('location') or ''
        try:
            la,lo=map(float,loc.split(',')[:2])
        except Exception:
            continue
        results.append({'label':x.get('placeName') or x.get('placeAddress') or 'Unknown','context':x.get('placeAddress') or '', 'lat':la,'lon':lo,'type':x.get('type') or 'Place','source':'MAPPLS','confidence':1.0,'eLoc':x.get('eLoc')})
    return {'results':results[:8]}

@app.post('/api/routes')
async def routes(req:RouteRequest):
    if req.demo:
        return {'status':'DEMO_DATA','routes':demo_routes(req.origin,req.destination)}
    try:
        client=MapplsClient()
        data=await client.route(req.origin.model_dump(),req.destination.model_dump(),req.mode,traffic=req.priority!='fastest')
    except MapplsError as e:
        raise HTTPException(status_code=502,detail=str(e))
    routes=normalize_routes(data,req.origin,req.destination)
    if not routes:
        raise HTTPException(status_code=502,detail='Mappls returned no usable route geometry. Check route API allocation/response access for this app.')
    routes=rank_routes(routes,req.priority)
    return {'status':'LIVE','provider':'MAPPLS','routes':routes[:3]}

def normalize_routes(data,origin,dest):
    candidates=[]
    raw=data.get('routes') or data.get('results') or data.get('suggestedLocations') or []
    if isinstance(raw,dict): raw=[raw]
    if not raw and isinstance(data,dict):
        for k in ('route','data'):
            if isinstance(data.get(k),list): raw=data[k]; break
            if isinstance(data.get(k),dict): raw=[data[k]]; break
    for idx,r in enumerate(raw if isinstance(raw,list) else []):
        geom=r.get('geometry') or r.get('routeGeometry') or r.get('shape') or r.get('points')
        if isinstance(geom,str): continue
        if not isinstance(geom,list): continue
        coords=[]
        for p in geom:
            if isinstance(p,(list,tuple)) and len(p)>=2: coords.append([float(p[0]),float(p[1])])
            elif isinstance(p,dict) and 'lng' in p and 'lat' in p: coords.append([float(p['lng']),float(p['lat'])])
        if len(coords)<2: continue
        dist=_pick_number(r,['distance','distanceMeters','length'],None)
        if dist is None: dist=math.nan
        if dist and dist>1000: dist=dist/1000
        time=_pick_number(r,['duration','durationSec','durationSeconds','time'],None)
        if time is None: time=0
        if time>100000: time=time/1000
        candidates.append({'id':f'route{idx+1}','name':f'ROUTE {idx+1}','distanceKm':float(dist or 0),'etaMin':float(time or 0)/60,'safety':75,'traffic':'LIVE' if 'traffic' in str(data).lower() else 'STANDARD','risk':'Awaiting hazard data','summary':'Mappls route returned; hazard intelligence will refine this route.','color':['#3b82f6','#8b5cf6','#22c55e'][min(idx,2)],'geometry':coords,'source':'MAPPLS'})
    return candidates

def _pick_number(obj,keys,default):
    for k in keys:
        v=obj.get(k)
        if isinstance(v,(int,float)): return float(v)
        if isinstance(v,str):
            try:return float(v)
            except:pass
    return default

def rank_routes(routes,priority):
    if len(routes)==1:
        routes[0]['id']='safe'; routes[0]['name']='SAFEST'; routes[0]['safety']=80; return routes
    routes=sorted(routes,key=lambda r:r['etaMin'] or 10**9)
    routes[0]['id']='fast'; routes[0]['name']='FASTEST'; routes[0]['safety']=max(45,78-len(routes)*3)
    if len(routes)>1:
        routes[1]['id']='efficient'; routes[1]['name']='EFFICIENT'; routes[1]['safety']=70
    if len(routes)>2:
        safest=min(routes,key=lambda r:(r['distanceKm']*0.15)+(r['etaMin']*0.1))
        safest['id']='safe'; safest['name']='SAFEST'; safest['safety']=88
    if priority=='safest': routes=sorted(routes,key=lambda r:-r['safety'])
    elif priority=='fastest': routes=sorted(routes,key=lambda r:r['etaMin'])
    return routes

def demo_routes(a,b):
    base=haversine(a.lat,a.lon,b.lat,b.lon)
    return [
        {'id':'fast','name':'FASTEST','distanceKm':round(base*1.18,1),'etaMin':128,'safety':61,'traffic':'Heavy','risk':'2 flood-risk zones + 1 landslide corridor','summary':'DEMO DATA: fastest traffic-adjusted option with higher modeled hazard exposure.','color':'#3b82f6','source':'DEMO'},
        {'id':'efficient','name':'EFFICIENT','distanceKm':round(base*1.13,1),'etaMin':138,'safety':68,'traffic':'Moderate','risk':'1 flood-risk segment','summary':'DEMO DATA: balanced distance, ETA and modeled exposure.','color':'#8b5cf6','source':'DEMO'},
        {'id':'safe','name':'SAFEST','distanceKm':round(base*1.27,1),'etaMin':152,'safety':91,'traffic':'Moderate','risk':'Low flood + low landslide exposure','summary':'DEMO DATA: recommended route; trades time for lower modeled hazard exposure.','color':'#22c55e','source':'DEMO'},
    ]

def haversine(a_lat,a_lon,b_lat,b_lon):
    R=6371;p1=math.radians(a_lat);p2=math.radians(b_lat);dp=math.radians(b_lat-a_lat);dl=math.radians(b_lon-a_lon)
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))
