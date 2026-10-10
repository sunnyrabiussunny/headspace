"""
AI-written diary narratives for imported calendar events (Settings →
Automation → AI Diary Writer).

Turns a bare calendar event ("Go to Juma prayer, 📍 Leiri mosque...") into a
short first-person diary paragraph, using whatever provider the user has
configured: their own local Ollama model, or their own OpenAI / Anthropic
API key. Nothing here is called unless the user has picked a model in
Settings — with nothing configured, callers fall back to the plain
mechanical format (see calendar.py's _mechanical_event_content).
"""
import os
import httpx

from .ollama_client import OLLAMA_URL, OLLAMA_TIMEOUT

AI_TIMEOUT = float(os.getenv("AI_DIARY_TIMEOUT", "90"))   # local models can be slow

NARRATIVE_PROMPT = """You are writing a short first-person diary entry for someone, about an upcoming event on their calendar, in a natural, reflective, personal voice — the way someone jots down their own thoughts before heading somewhere. Ground it in the facts given below and the person's own background, and you may reasonably speculate about timing, who they might see, or what else they might do nearby — the way a person naturally would when thinking ahead about their day.

Background about this person (use it to personalize the entry; don't just repeat it back verbatim):
{context}

The calendar event:
{event_block}

Write 3-6 sentences in first person ("I will...", "I should...", "I might..."). Plain prose only — no headers, no bullet points, no markdown, no quotation marks around the whole thing. Do not mention that you are an AI or that this was generated. Output only the diary entry text itself."""


def _event_block(title: str, description: str | None, location: str | None, start_label: str, end_label: str | None) -> str:
    lines = [f"Activity: {title or '(untitled event)'}"]
    if description and description.strip() and description.strip() != (title or "").strip():
        lines.append(f"Details: {description.strip()}")
    if location and location.strip():
        lines.append(f"Location: {location.strip()}")
    when = f"Time: {start_label}" + (f" to {end_label}" if end_label else "")
    lines.append(when)
    return "\n".join(lines)


async def generate_diary_narrative(
    provider: str,
    model: str | None,
    context: str | None,
    title: str,
    description: str | None,
    location: str | None,
    start_label: str,
    end_label: str | None,
    openai_api_key: str | None = None,
    anthropic_api_key: str | None = None,
) -> tuple[str | None, str | None]:
    """Returns (narrative_text, error). error is None on success."""
    if not model:
        return None, "No AI model selected — pick one in Settings → Automation → AI Diary Writer."

    prompt = NARRATIVE_PROMPT.format(
        context=(context or "").strip() or "(no personal background provided)",
        event_block=_event_block(title, description, location, start_label, end_label),
    )

    provider = (provider or "ollama").lower()
    try:
        if provider == "ollama":
            return await _ollama_narrative(model, prompt)
        elif provider == "openai":
            if not openai_api_key:
                return None, "No OpenAI API key saved in Settings → Automation → AI Diary Writer."
            return await _openai_narrative(model, prompt, openai_api_key)
        elif provider == "anthropic":
            if not anthropic_api_key:
                return None, "No Anthropic API key saved in Settings → Automation → AI Diary Writer."
            return await _anthropic_narrative(model, prompt, anthropic_api_key)
        else:
            return None, f"Unknown AI provider '{provider}'."
    except httpx.RequestError as e:
        return None, f"Couldn't reach {provider} ({type(e).__name__})."
    except httpx.HTTPStatusError as e:
        return None, f"{provider} returned an error ({e.response.status_code}) — check the model name and API key."
    except Exception as e:
        return None, f"AI diary generation failed: {type(e).__name__}: {e or repr(e)}"


async def _ollama_narrative(model: str, prompt: str) -> tuple[str | None, str | None]:
    async with httpx.AsyncClient(timeout=AI_TIMEOUT) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
        )
        resp.raise_for_status()
        data = resp.json()
    text = (data.get("response") or "").strip()
    return (text, None) if text else (None, f"Ollama model '{model}' returned an empty response.")


async def _openai_narrative(model: str, prompt: str, api_key: str) -> tuple[str | None, str | None]:
    async with httpx.AsyncClient(timeout=AI_TIMEOUT) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.8},
        )
        resp.raise_for_status()
        data = resp.json()
    text = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    return (text, None) if text else (None, f"OpenAI model '{model}' returned an empty response.")


async def _anthropic_narrative(model: str, prompt: str, api_key: str) -> tuple[str | None, str | None]:
    async with httpx.AsyncClient(timeout=AI_TIMEOUT) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={"model": model, "max_tokens": 500, "messages": [{"role": "user", "content": prompt}]},
        )
        resp.raise_for_status()
        data = resp.json()
    blocks = data.get("content") or []
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    return (text, None) if text else (None, f"Claude model '{model}' returned an empty response.")


# ── Model listing (Settings → Automation → AI Diary Writer) ────────────────

async def list_ollama_models() -> tuple[list[str], str | None]:
    """Queries the local Ollama instance for installed models, so a model
    pulled with `ollama pull` shows up here automatically on next load —
    nothing is hardcoded or cached."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            data = resp.json()
        names = sorted({m.get("name") for m in data.get("models", []) if m.get("name")})
        return names, None
    except httpx.RequestError as e:
        return [], f"Couldn't reach Ollama at {OLLAMA_URL} ({type(e).__name__})."
    except Exception as e:
        return [], f"Couldn't list Ollama models: {e or repr(e)}"


async def list_openai_models(api_key: str) -> tuple[list[str], str | None]:
    if not api_key:
        return [], None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {api_key}"})
            resp.raise_for_status()
            data = resp.json()
        names = sorted({
            m.get("id") for m in data.get("data", [])
            if m.get("id") and ("gpt" in m["id"] or "o1" in m["id"] or "o3" in m["id"] or "o4" in m["id"])
        })
        return names, None
    except httpx.HTTPStatusError as e:
        return [], f"OpenAI rejected the API key (HTTP {e.response.status_code})."
    except Exception as e:
        return [], f"Couldn't list OpenAI models: {e or repr(e)}"


async def list_anthropic_models(api_key: str) -> tuple[list[str], str | None]:
    if not api_key:
        return [], None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
            resp.raise_for_status()
            data = resp.json()
        names = sorted({m.get("id") for m in data.get("data", []) if m.get("id")})
        return names, None
    except httpx.HTTPStatusError as e:
        return [], f"Anthropic rejected the API key (HTTP {e.response.status_code})."
    except Exception as e:
        return [], f"Couldn't list Claude models: {e or repr(e)}"
