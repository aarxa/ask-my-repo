import os
from openai import OpenAI
import chromadb
from dotenv import load_dotenv

load_dotenv()

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_store")
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)


def embed_text(text: str) -> list:
    response = openai_client.embeddings.create(
        input=text,
        model="text-embedding-3-small"
    )
    return response.data[0].embedding


def search_repo(collection_id: str, query: str, n_results: int = 5) -> list:
    collection = chroma_client.get_collection(collection_id)
    query_embedding = embed_text(query)

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results,
        include=["documents", "metadatas", "distances"]
    )

    chunks = []
    for doc, meta, dist in zip(
        results['documents'][0],
        results['metadatas'][0],
        results['distances'][0]
    ):
        chunks.append({
            "content": doc,
            "path": meta['path'],
            "url": meta['url'],
            "relevance_score": round(1 - dist, 3)
        })

    return chunks


def answer_question(collection_id: str, question: str, chat_history: list = []) -> dict:
    relevant_chunks = search_repo(collection_id, question)

    context = ""
    sources = []
    for chunk in relevant_chunks:
        context += f"\n\n--- File: {chunk['path']} ---\n{chunk['content']}"
        if chunk['path'] not in [s['path'] for s in sources]:
            sources.append({"path": chunk['path'], "url": chunk['url']})

    system_prompt = f"""You are an expert software engineer analyzing a codebase.

Based ONLY on the following code snippets, answer the user's question.
If the answer isn't clear from the code, say so honestly.

CODE CONTEXT:
{context}"""

    # Build messages array with full chat history
    messages = [{"role": "system", "content": system_prompt}]

    # Add previous questions and answers
    for turn in chat_history:
        messages.append({"role": "user", "content": turn["question"]})
        messages.append({"role": "assistant", "content": turn["answer"]})

    # Add current question
    messages.append({"role": "user", "content": question})

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        temperature=0.3
    )

    return {
        "answer": response.choices[0].message.content,
        "sources": sources,
        "chunks_used": len(relevant_chunks)
    }
