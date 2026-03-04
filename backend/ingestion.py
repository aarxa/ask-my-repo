import os
from github import Github
from openai import OpenAI
import chromadb
from dotenv import load_dotenv

load_dotenv()

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
github_client = Github(os.getenv("GITHUB_TOKEN"))
CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_store")
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

CODE_EXTENSIONS = {'.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go', '.rb', '.cpp', '.c', '.h', '.hpp', '.cc', '.cs', '.swift', '.kt', '.rs'}

def fetch_repo_files(repo_url: str) -> list:
    repo_path = repo_url.strip().rstrip('/')
    repo_path = repo_path.replace('https://github.com/', '')
    repo_path = repo_path.replace('http://github.com/', '')
    repo_path = repo_path.replace('github.com/', '')
    if repo_path.lower().endswith('.git'):
        repo_path = repo_path[:-4]

    parts = [part for part in repo_path.split('/') if part]
    if len(parts) < 2:
        raise ValueError(f"Invalid GitHub repository URL: {repo_url}")

    repo_name = f"{parts[-2]}/{parts[-1]}"
    repo = github_client.get_repo(repo_name)
    files = []

    def traverse(contents):
        for item in contents:
            if item.type == 'dir':
                traverse(repo.get_contents(item.path))
            elif any(item.name.endswith(ext) for ext in CODE_EXTENSIONS):
                try:
                    content = item.decoded_content.decode('utf-8')
                    files.append({
                        "path": item.path,
                        "content": content,
                        "url": item.html_url
                    })
                except Exception:
                    pass

    traverse(repo.get_contents(""))
    return files

def chunk_file(file: dict) -> list:
    content = file['content']
    chunks = []
    chunk_size = 1500
    overlap = 200

    for i in range(0, len(content), chunk_size - overlap):
        chunk = content[i:i + chunk_size]
        if chunk.strip():
            chunks.append({
                "path": file['path'],
                "content": chunk,
                "url": file['url'],
                "chunk_index": len(chunks)
            })
    
    return chunks

def embed_text(text: str) -> list:
    response = openai_client.embeddings.create(
        input=text,
        model="text-embedding-3-small"
    )
    return response.data[0].embedding

def ingest_repo(repo_url: str, progress_callback=None) -> dict:
    repo_id = repo_url.rstrip('/').replace('https://github.com/', '').replace('/', '_')

    try:
        chroma_client.delete_collection(repo_id)
    except:
        pass

    collection = chroma_client.create_collection(repo_id)

    if progress_callback:
        progress_callback(progress=8, message="fetching files from repo")
    print(f"Fetching files from {repo_url}...")
    files = fetch_repo_files(repo_url)
    if progress_callback:
        progress_callback(progress=24, message=f"found {len(files)} code files")
    print(f"Found {len(files)} code files")

    if progress_callback:
        progress_callback(progress=36, message="creating chunks")
    all_chunks = []
    for file in files:
        all_chunks.extend(chunk_file(file))

    if progress_callback:
        progress_callback(progress=52, message=f"created {len(all_chunks)} chunks")
    print(f"Created {len(all_chunks)} chunks, embedding now...")

    if progress_callback:
        progress_callback(progress=62, message="embedding")
    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i:i + batch_size]
        embeddings = [embed_text(f"File: {c['path']}\n\n{c['content']}") for c in batch]

        collection.add(
            embeddings=embeddings,
            documents=[c['content'] for c in batch],
            metadatas=[{"path": c['path'], "url": c['url']} for c in batch],
            ids=[f"{c['path']}_{c['chunk_index']}" for c in batch]
        )

        if progress_callback and len(all_chunks) > 0:
            embedded = min(i + batch_size, len(all_chunks))
            progress = 62 + int((embedded / len(all_chunks)) * 30)
            progress_callback(progress=min(progress, 92), message=f"embedding {embedded}/{len(all_chunks)} chunks")
        print(f"  Embedded {min(i + batch_size, len(all_chunks))}/{len(all_chunks)}")

    if progress_callback:
        progress_callback(progress=97, message="almost done")
    return {
        "repo_url": repo_url,
        "files_found": len(files),
        "chunks_stored": len(all_chunks),
        "collection_id": repo_id
    }
