"""
Minimal async client for a local Ollama instance, used by the "Ask Your
Diary" feature. No vector database — retrieval is done with a lightweight
keyword-overlap score over the user's own diary entries (see
retrieve_relevant_entries below), then the matched excerpts are handed to
the local model as context. Good enough for a personal diary's scale
(hundreds to a few thousand entries) without adding a vector-store
dependency, and everything stays entirely on your own network.
"""
import os
import re
import httpx

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://192.168.10.103:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "60"))

STOPWORDS = {
    "the","a","an","is","are","was","were","be","been","to","of","in","on","at","for",
    "and","or","but","with","about","did","do","does","i","me","my","you","your","he",
    "she","it","we","they","this","that","what","when","where","who","how","why","not",
    "did","have","has","had","will","would","can","could","should","did","last","did",
}

def _tokenize(text: str) -> set:
    return {w for w in re.findall(r"[a-zA-Z0-9']+", text.lower()) if w not in STOPWORDS and len(w) > 1}


def retrieve_relevant_entries(question: str, entries: list, top_n: int = 12) -> list:
    """
    entries: list of objects with .date and .content (already scoped to
    the current user). Returns up to top_n entries most relevant to the
    question, using simple keyword overlap plus a recency nudge, so recent
    entries surface even without an exact keyword hit.
    """
    q_tokens = _tokenize(question)
    if not q_tokens:
        return sorted(entries, key=lambda e: e.date, reverse=True)[:top_n]

    scored = []
    for e in entries:
        e_tokens = _tokenize(e.content or "")
        overlap = len(q_tokens & e_tokens)
        scored.append((overlap, e.date, e))

    # Sort by keyword overlap first, then by recency
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    top = [e for score, _date, e in scored[:top_n] if score > 0]

    # If keyword matching found little/nothing, fall back to most recent entries
    if len(top) < 3:
        recent = sorted(entries, key=lambda e: e.date, reverse=True)[:top_n]
        seen_ids = {e.id for e in top}
        for e in recent:
            if e.id not in seen_ids:
                top.append(e)
                seen_ids.add(e.id)
            if len(top) >= top_n:
                break

    return top[:top_n]


async def ask_ollama(question: str, context_entries: list) -> str:
    """context_entries: list of (date, plain_text_content) tuples."""
    context_block = "\n\n".join(f"[{date}]\n{text}" for date, text in context_entries) or "(no diary entries found)"

    system_prompt = (
        "You are a helpful assistant answering questions about the user's personal diary. "
        "Only use the diary excerpts provided below — do not invent facts. "
        "If the excerpts don't contain the answer, say so plainly. "
        "When you reference something, mention the date it happened. Be concise."
    )
    prompt = f"{system_prompt}\n\n--- DIARY EXCERPTS ---\n{context_block}\n\n--- QUESTION ---\n{question}\n\n--- ANSWER ---"

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("response") or "").strip() or "No answer generated."
    except httpx.RequestError as e:
        return (
            f"Couldn't reach Ollama at {OLLAMA_URL} ({type(e).__name__}). Make sure Ollama is running "
            "and reachable from the Headspace backend container (check the OLLAMA_URL environment "
            "variable in docker-compose.yml)."
        )
    except httpx.HTTPStatusError as e:
        return f"Ollama returned an error ({e.response.status_code}). Is the model '{OLLAMA_MODEL}' pulled?"
    except Exception as e:
        return f"Something went wrong asking Ollama: {e or repr(e)}"
