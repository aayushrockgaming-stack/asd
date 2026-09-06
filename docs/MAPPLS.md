# Mappls integration notes

The current Mappls Web Maps JS documentation says the main Web SDK is loaded with:
`https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=<Static Key>`

The same documentation says access must be enabled in the Mappls Console app and the Static Key comes from the credentials section. A Web App Static Key can be domain-whitelisted.

Autosuggest: `https://search.mappls.com/search/places/autosuggest/json`
Geocode: `https://search.mappls.com/search/address/geocode`
Reverse geocode: `https://search.mappls.com/search/address/rev-geocode`
Routing base: `https://route.mappls.com/route/direction/`

Routing resources documented by Mappls include `route_adv`; traffic-aware `route_eta` and `route_traffic` are documented for India.
