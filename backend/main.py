import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ingestion import ingest_repo
from retrieval import answer_question
from analysis import detect_dead_code, suggest_improvements
from dotenv import load_dotenv
from typing import Optional
from uuid import uuid4
from starlette.concurrency import run_in_threadpool

load_dotenv()

app = FastAPI(title="Ask My Repo")

cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
chroma_path = os.getenv("CHROMA_PATH", "./chroma_store")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

class IngestRequest(BaseModel):
    repo_url: str
    job_id: Optional[str] = None

class QuestionRequest(BaseModel):
    collection_id: str
    question: str
    chat_history: list = []

INGEST_STATUS = {}

@app.get("/")
def home():
    return {"message": "Ask My Repo is running!"}

@app.post("/ingest")
async def ingest(req: IngestRequest):
    job_id = req.job_id or uuid4().hex
    INGEST_STATUS[job_id] = {
        "job_id": job_id,
        "progress": 0,
        "message": "queued",
        "updates": [],
        "done": False,
        "error": None,
    }
    try:
        def progress_callback(progress: int, message: str):
            state = INGEST_STATUS.get(job_id)
            if not state:
                return
            state["progress"] = max(0, min(progress, 99))
            state["message"] = message
            if not state["updates"] or state["updates"][-1] != message:
                state["updates"].append(message)

        result = await run_in_threadpool(ingest_repo, req.repo_url, progress_callback)
        INGEST_STATUS[job_id]["progress"] = 100
        INGEST_STATUS[job_id]["message"] = "completed"
        INGEST_STATUS[job_id]["done"] = True
        return result
    except Exception as e:
        INGEST_STATUS[job_id]["error"] = str(e)
        INGEST_STATUS[job_id]["done"] = True
        INGEST_STATUS[job_id]["message"] = "failed"
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/ingest-status/{job_id}")
async def ingest_status(job_id: str):
    state = INGEST_STATUS.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Unknown ingest job")
    return state

@app.post("/ask")
async def ask(req: QuestionRequest):
    try:
        result = answer_question(req.collection_id, req.question, req.chat_history)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/dead-code")
async def dead_code(req: IngestRequest):
    try:
        result = detect_dead_code(req.repo_url)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/improvements")
async def improvements(req: QuestionRequest):
    try:
        result = suggest_improvements(req.collection_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/files/{collection_id}")
async def get_files(collection_id: str):
    try:
        import chromadb
        chroma_client = chromadb.PersistentClient(path=chroma_path)
        collection = chroma_client.get_collection(collection_id)
        results = collection.get(include=["metadatas"])
        
        seen = set()
        files = []
        for meta in results['metadatas']:
            if meta['path'] not in seen:
                seen.add(meta['path'])
                files.append({
                    "path": meta['path'],
                    "url": meta['url']
                })
        
        files.sort(key=lambda x: x['path'])
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
