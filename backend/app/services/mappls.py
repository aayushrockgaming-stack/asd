import os
from typing import Any
import httpx

class MapplsError(Exception):
    pass

class MapplsClient:
    def __init__(self):
        self.token=os.getenv('MAPPLS_ACCESS_TOKEN','').strip()
        self.route_base=os.getenv('MAPPLS_ROUTE_BASE','https://route.mappls.com/route/direction').rstrip('/')
        self.search_base=os.getenv('MAPPLS_SEARCH_BASE','https://search.mappls.com/search/places').rstrip('/')
        if not self.token:
            raise MapplsError('MAPPLS_ACCESS_TOKEN is missing in backend/.env')

    async def _get(self,url:str,params:dict[str,Any]) -> Any:
        params={**params,'access_token':self.token}
        async with httpx.AsyncClient(timeout=20,follow_redirects=True) as client:
            r=await client.get(url,params=params)
        if r.status_code==401:
            raise MapplsError('Mappls returned 401 Unauthorized. Check the Static Key, Web App whitelist, and Console access.')
        if r.status_code==403:
            raise MapplsError('Mappls returned 403 Forbidden. Check allocation/quota for this application.')
        if not r.is_success:
            raise MapplsError(f'Mappls returned HTTP {r.status_code}: {r.text[:300]}')
        return r.json()

    async def autosuggest(self,query:str,lat:float|None=None,lon:float|None=None)->dict[str,Any]:
        params={'query':query}
        if lat is not None and lon is not None:
            params['location']=f'{lat},{lon}'
            params['zoom']='5'
        return await self._get(f'{self.search_base}/autosuggest/json',params)

    async def route(self,origin:dict,destination:dict,vehicle:str='car',traffic:bool=False)->dict[str,Any]:
        profile={'car':'driving','ambulance':'driving','truck':'trucking','bus':'driving','bike':'biking'}.get(vehicle,'driving')
        resource='route_traffic' if traffic else 'route_adv'
        if profile=='trucking' and traffic: resource='route_eta'
        if profile=='biking': resource='route_adv'
        url=f"{self.route_base}/{resource}/{profile}/{origin['lon']},{origin['lat']};{destination['lon']},{destination['lat']}"
        params={'rtype':0,'region':'ind'} if resource in ('route_adv','route_traffic','route_eta') and profile not in ('biking','walking','trucking') else {}
        return await self._get(url,params)
