# Deploying Crime-Project

This repo has two parts that deploy **separately**:
- `backend/` — Flask + scikit-learn API (safety report, safe-cities, PDF export)
- `CrimeProject/` — React + Vite frontend (map, heatmap, charts)

Deploy the backend first, then point the frontend at its URL.

## 1. Backend (Render)

1. Push this repo to GitHub (if not already there).
2. Go to https://render.com → New → Web Service → connect your repo.
3. Set:
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn server:app`
4. Deploy. Copy the URL Render gives you, e.g. `https://crime-backend.onrender.com`.
5. Test it: open `https://crime-backend.onrender.com/safe-cities` in a browser — you should get JSON back.

## 2. Frontend (Vercel)

1. Open `CrimeProject/.env.production` and replace the placeholder with your real backend URL from step 1:
   ```
   VITE_API_BASE=https://crime-backend.onrender.com
   ```
2. Go to https://vercel.com → New Project → import your repo.
3. Set:
   - Root directory: `CrimeProject`
   - Build command: `npm run build` (auto-detected)
   - Output directory: `dist` (auto-detected)
4. Deploy. Vercel gives you a live URL — open it and the map should load.

## 3. Local testing (optional, before deploying)

Backend:
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python server.py
```

Frontend (in a second terminal):
```bash
cd CrimeProject
npm install
npm run dev
```

## Notes
- The backend retrains a RandomForest model from `Crime_dataset_fully_mapped.csv` every time it starts — expect a few seconds of startup delay (and Render free tier "spin down" adds a delay to the first request after idling).
- CORS is currently open to all origins (`CORS(app)`) — fine to start, but worth restricting to your Vercel domain once it's live.
