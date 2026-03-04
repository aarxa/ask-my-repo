import os
import subprocess
import tempfile
import shutil
from openai import OpenAI
import chromadb
from dotenv import load_dotenv

load_dotenv()

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_store")
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)


def detect_dead_code(repo_url: str) -> dict:
    tmpdir = tempfile.mkdtemp()

    try:
        print(f"Cloning {repo_url}...")
        result = subprocess.run(
            ["git", "clone", "--depth=1", repo_url, tmpdir],
            capture_output=True, text=True, timeout=60
        )

        if result.returncode != 0:
            return {"error": f"Failed to clone: {result.stderr}"}

        print("Running vulture...")
        vulture_result = subprocess.run(
            ["vulture", tmpdir, "--min-confidence", "80"],
            capture_output=True, text=True, timeout=30
        )

        findings = []
        for line in vulture_result.stdout.strip().split('\n'):
            if line:
                clean = line.replace(tmpdir + '/', '')
                findings.append(clean)

        return {
            "dead_code_findings": findings,
            "count": len(findings)
        }

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def suggest_improvements(collection_id: str) -> dict:
    collection = chroma_client.get_collection(collection_id)

    results = collection.get(limit=30, include=["documents", "metadatas"])

    file_summary = ""
    seen_paths = set()
    for doc, meta in zip(results['documents'], results['metadatas']):
        if meta['path'] not in seen_paths:
            seen_paths.add(meta['path'])
            file_summary += f"\n--- {meta['path']} ---\n{doc[:500]}\n"

    prompt = f"""You are a senior software architect reviewing a codebase.

Here is a sample of the code:
{file_summary}

Please provide:
1. Architecture Overview: What patterns and structure do you see?
2. Top 3 Improvement Suggestions: Specific, actionable recommendations
3. Security Concerns: Any obvious security issues?
4. Code Quality: Naming, structure, documentation gaps?

Be specific and reference actual file names you observe."""

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4
    )

    return {
        "analysis": response.choices[0].message.content,
        "files_analyzed": len(seen_paths)
    }
