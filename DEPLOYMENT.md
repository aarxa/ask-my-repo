# Deploying: Render (Backend) + Netlify (Frontend)

## 1) Deploy backend on Render

Create a new **Web Service** from this repo with:

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Set environment variables in Render:

- `OPENAI_API_KEY` = your OpenAI key
- `GITHUB_TOKEN` = your GitHub personal access token
- `CORS_ORIGINS` = `http://localhost:5173,https://YOUR_NETLIFY_SITE.netlify.app`
- `CHROMA_PATH` = `/var/data/chroma_store`

Attach a persistent disk to the backend service:

- Mount path: `/var/data/chroma_store`
- Recommended size: 1 GB+ (increase as your indexed repos grow)

After deploy, copy your backend URL, for example:

- `https://ask-my-repo-backend.onrender.com`

## 2) Deploy frontend on Netlify

This repo already contains `netlify.toml` configured for Vite:

- Base directory: `frontend`
- Build command: `npm run build`
- Publish directory: `dist`

In Netlify site environment variables, add:

- `VITE_API_URL` = your Render backend URL (for example, `https://ask-my-repo-backend.onrender.com`)

Deploy the site and copy your Netlify URL:

- `https://YOUR_NETLIFY_SITE.netlify.app`

## 3) Final CORS update

Go back to Render and update `CORS_ORIGINS` to include your final frontend origin(s):

- `https://YOUR_NETLIFY_SITE.netlify.app,http://localhost:5173`

If you add a custom frontend domain later, include that domain too in `CORS_ORIGINS`.

## 4) Smoke test

1. Open `https://YOUR_RENDER_BACKEND.onrender.com/` and confirm it returns:
   `{"message":"Ask My Repo is running!"}`
2. Open your Netlify app.
3. Ingest a GitHub repo and ask a question.
4. Confirm no CORS errors in browser devtools.
