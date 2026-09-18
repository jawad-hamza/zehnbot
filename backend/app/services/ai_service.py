from typing import List, Tuple, Optional
from fastapi import HTTPException
from app.config import settings


DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "gemini": "gemini-2.0-flash",
    "deepseek": "deepseek-chat",
    "grok": "grok-2-latest",
}

OPENAI_COMPATIBLE_BASE_URLS = {
    "openai": None,
    "deepseek": "https://api.deepseek.com",
    "grok": "https://api.x.ai/v1",
}


def chat_completion(
    messages: List[dict],
    provider: str = "openai",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Tuple[str, int]:
    provider = (provider or "openai").lower()
    model = model or DEFAULT_MODELS.get(provider)
    key = api_key or (settings.OPENAI_API_KEY if provider == "openai" else "")
    if not key:
        raise HTTPException(status_code=503, detail=f"No API key configured for provider '{provider}'")
    if not model:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    if provider in OPENAI_COMPATIBLE_BASE_URLS:
        return _openai_compatible(messages, model, key, OPENAI_COMPATIBLE_BASE_URLS[provider])
    if provider == "anthropic":
        return _anthropic(messages, model, key)
    if provider == "gemini":
        return _gemini(messages, model, key)
    raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")


def _openai_compatible(messages, model, key, base_url):
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url=base_url) if base_url else OpenAI(api_key=key)
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.7,
        max_tokens=600,
    )
    reply = response.choices[0].message.content.strip()
    tokens = getattr(response.usage, "total_tokens", 0) or 0
    return reply, tokens


def _anthropic(messages, model, key):
    import anthropic
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    system = "\n\n".join(system_parts) if system_parts else ""
    convo = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
    client = anthropic.Anthropic(api_key=key)
    kwargs = {"model": model, "max_tokens": 600, "temperature": 0.7, "messages": convo}
    if system:
        kwargs["system"] = system
    response = client.messages.create(**kwargs)
    reply = "".join(block.text for block in response.content if getattr(block, "type", "") == "text").strip()
    usage = getattr(response, "usage", None)
    tokens = (getattr(usage, "input_tokens", 0) + getattr(usage, "output_tokens", 0)) if usage else 0
    return reply, tokens


def _gemini(messages, model, key):
    from google import genai
    from google.genai import types

    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    system = "\n\n".join(system_parts) if system_parts else None

    contents = []
    for m in messages:
        if m["role"] == "system":
            continue
        role = "user" if m["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=m["content"])]))

    config_kwargs = {"temperature": 0.7, "max_output_tokens": 600}
    if system:
        config_kwargs["system_instruction"] = system

    client = genai.Client(api_key=key)
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    reply = (response.text or "").strip()
    usage = getattr(response, "usage_metadata", None)
    tokens = getattr(usage, "total_token_count", 0) if usage else 0
    return reply, tokens
