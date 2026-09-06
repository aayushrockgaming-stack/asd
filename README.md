# NER Route Intelligence — Working Mappls Foundation

This package is a runnable React/Vite + FastAPI foundation for the SIH project. It uses the current Mappls Web Maps JS v3 URL with a Web App Static Key supplied as `access_token`, and routes/search through backend provider adapters.

## Requirements
- Node.js LTS
- Python 3.10+
- A Mappls Web application with the required Maps / Search / Directions allocations

## Windows CMD — first run

### CMD 1 — backend
```cmd
cd /d "C:\YOUR\PATH\NER_Route_Intelligence\backend"
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
notepad .env
python -m uvicorn app.main:app --reload --port 8000
```

Put your Mappls Static Key in `backend\.env`:
```env
MAPPLS_ACCESS_TOKEN=YOUR_STATIC_KEY
DEMO_MODE=false
```

### CMD 2 — frontend
```cmd
cd /d "C:\YOUR\PATH\NER_Route_Intelligence\frontend"
npm install
copy .env.example .env
notepad .env
npm run dev
```

Put the same Web Maps Static Key in `frontend\.env`:
```env
VITE_API_BASE_URL=http://localhost:8000
VITE_MAPPLS_ACCESS_TOKEN=YOUR_STATIC_KEY
```

Open: http://localhost:5173
Backend docs: http://localhost:8000/docs
Health: http://localhost:8000/health

## Important Mappls note
The Web Maps JS SDK currently documents:
`https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=<Static Key>`
The Static Key is obtained from the Mappls Console credentials section and can be domain-whitelisted for a Web App.

If the browser or `curl` returns `401 Unauthorized`, the code cannot make that credential valid. Fix the Mappls Static Key / app authorization / whitelist / allocations, then restart Vite.

## Current scope
- Mappls map bootstrapping
- precise coordinate models
- backend Mappls Autosuggest adapter
- backend Mappls route adapter
- current-location support
- up to three route presentation slots when the provider returns usable alternatives
- route explanation cards
- hazard-layer controls and emergency-style UI shell
- production mode default (demo is opt-in)
- explicit errors instead of silently fabricating live data

The hazard/weather/traffic adapters are intentionally separate so official data sources can be added without coupling them to React or Mappls.
