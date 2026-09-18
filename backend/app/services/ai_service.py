from dataclasses import dataclass
from typing import Iterator, List, Tuple, Optional

from app.config import settings
from app.services.net_guard import UnsafeURLError, assert_public_url
from app.services.providers import ANTHROPIC_PROTOCOL, OPENAI_PROTOCOL, Provider, get_provider

# OpenAI reasoning-style models only accept the default temperature
_OPENAI_FIXED_TEMPERATURE_PREFIXES = ("o1", "o3", "o4", "gpt-5")

MAX_RETRIES = 2


class AIProviderError(Exception):
    """Anything that went wrong talking to a provider. The message may contain provider
    detail, so it is logged and shown to the bot's owner, never to website visitors."""


@dataclass(frozen=True)
class Endpoint:
    """Where a request goes. `base_url` overrides the catalogue's URL (required for `custom`).

    `trusted` is True for endpoints the platform operator configured in the environment.
    A tenant-supplied URL is NOT trusted: the server must never be steered at internal addresses,
    so it has to resolve to a public address and redirects are not followed."""
    provider: str
    model: Optional[str] = None
    base_url: Optional[str] = None
    trusted: bool = True


def _resolve(endpoint: Endpoint) -> Tuple[Provider, str, Optional[str]]:
    provider = get_provider(endpoint.provider)
    if provider is None:
        raise AIProviderError(f"Unsupported provider: {endpoint.provider}")
    model = (endpoint.model or "").strip() or provider.default_model
    if not model:
        raise AIProviderError(f"{provider.label} needs a model name")
    base_url = (endpoint.base_url or "").strip() or provider.base_url
    if provider.needs_base_url and not base_url:
        raise AIProviderError(f"{provider.label} needs a base URL")
    if base_url and not endpoint.trusted and base_url != provider.base_url:
        try:
            assert_public_url(base_url)
        except UnsafeURLError as exc:
            raise AIProviderError(f"Endpoint refused: {exc}") from exc
    return provider, model, base_url


def chat_completion(messages: List[dict], endpoint: Endpoint, api_key: str) -> Tuple[str, int]:
    provider, model, base_url = _resolve(endpoint)
    try:
        if provider.protocol == OPENAI_PROTOCOL:
            reply, tokens = _openai_compatible(messages, provider, model, api_key, base_url, endpoint.trusted)
        elif provider.protocol == ANTHROPIC_PROTOCOL:
            reply, tokens = _anthropic(messages, model, api_key)
        else:
            reply, tokens = _gemini(messages, model, api_key)
    except AIProviderError:
        raise
    except Exception as exc:
        raise AIProviderError(f"{type(exc).__name__}: {exc}") from exc

    if not reply:
        raise AIProviderError("Provider returned an empty reply")
    return reply, tokens


def stream_completion(messages: List[dict], endpoint: Endpoint, api_key: str, usage: dict) -> Iterator[str]:
    """Yields the reply piece by piece. When the stream ends, `usage["tokens"]` holds the total
    token count if the provider reported one."""
    provider, model, base_url = _resolve(endpoint)
    try:
        if provider.protocol == OPENAI_PROTOCOL:
            yield from _openai_compatible_stream(messages, provider, model, api_key, base_url, endpoint.trusted, usage)
        elif provider.protocol == ANTHROPIC_PROTOCOL:
            yield from _anthropic_stream(messages, model, api_key, usage)
        else:
            yield from _gemini_stream(messages, model, api_key, usage)
    except AIProviderError:
        raise
    except Exception as exc:
        raise AIProviderError(f"{type(exc).__name__}: {exc}") from exc


# ---------- OpenAI and OpenAI-compatible (DeepSeek, Grok) ----------

def _openai_request(messages, provider: Provider, model, key, base_url, trusted):
    import openai
    client_kwargs = {}
    if not trusted:
        # The SDK follows redirects by default. For a tenant-supplied endpoint that would let a
        # public URL bounce the request (and the API key) to an internal address.
        client_kwargs["http_client"] = openai.DefaultHttpxClient(follow_redirects=False, timeout=settings.AI_TIMEOUT_SECONDS)
    client = openai.OpenAI(
        api_key=key,
        base_url=base_url,
        timeout=settings.AI_TIMEOUT_SECONDS,
        max_retries=MAX_RETRIES,
        **client_kwargs,
    )
    kwargs = {"model": model, "messages": messages}
    # Only when really talking to OpenAI: behind a custom base URL sits some other server
    if provider.openai_native and base_url is None:
        kwargs["max_completion_tokens"] = settings.AI_MAX_OUTPUT_TOKENS
        if not model.lower().startswith(_OPENAI_FIXED_TEMPERATURE_PREFIXES):
            kwargs["temperature"] = 0.7
    else:
        kwargs["max_tokens"] = settings.AI_MAX_OUTPUT_TOKENS
        kwargs["temperature"] = 0.7
    return client, kwargs


def _openai_compatible(messages, provider, model, key, base_url, trusted):
    client, kwargs = _openai_request(messages, provider, model, key, base_url, trusted)
    response = client.chat.completions.create(**kwargs)
    reply = (response.choices[0].message.content or "").strip()
    tokens = getattr(response.usage, "total_tokens", 0) or 0
    return reply, tokens


def _openai_compatible_stream(messages, provider, model, key, base_url, trusted, usage):
    client, kwargs = _openai_request(messages, provider, model, key, base_url, trusted)
    if provider.stream_usage and base_url == provider.base_url:
        kwargs["stream_options"] = {"include_usage": True}
    for chunk in client.chat.completions.create(stream=True, **kwargs):
        if getattr(chunk, "usage", None):
            usage["tokens"] = chunk.usage.total_tokens or 0
        if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


# ---------- Anthropic ----------

def _anthropic_request(messages, model, key):
    import anthropic
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    system = "\n\n".join(system_parts) if system_parts else ""
    convo = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
    client = anthropic.Anthropic(api_key=key, timeout=settings.AI_TIMEOUT_SECONDS, max_retries=MAX_RETRIES)
    # No sampling parameters: the 1.x SDK removed `temperature` from messages.create
    kwargs = {"model": model, "max_tokens": settings.AI_MAX_OUTPUT_TOKENS, "messages": convo}
    if system:
        kwargs["system"] = system
    return client, kwargs


def _anthropic_tokens(message) -> int:
    usage = getattr(message, "usage", None)
    return ((getattr(usage, "input_tokens", 0) or 0) + (getattr(usage, "output_tokens", 0) or 0)) if usage else 0


def _anthropic(messages, model, key):
    client, kwargs = _anthropic_request(messages, model, key)
    response = client.messages.create(**kwargs)
    reply = "".join(block.text for block in response.content if getattr(block, "type", "") == "text").strip()
    return reply, _anthropic_tokens(response)


def _anthropic_stream(messages, model, key, usage):
    client, kwargs = _anthropic_request(messages, model, key)
    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            if text:
                yield text
        usage["tokens"] = _anthropic_tokens(stream.get_final_message())


# ---------- Gemini ----------

def _gemini_request(messages, model, key):
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

    config_kwargs = {"temperature": 0.7, "max_output_tokens": settings.AI_MAX_OUTPUT_TOKENS}
    if system:
        config_kwargs["system_instruction"] = system

    client = genai.Client(
        api_key=key,
        http_options=types.HttpOptions(timeout=int(settings.AI_TIMEOUT_SECONDS * 1000)),
    )
    return client, {"model": model, "contents": contents, "config": types.GenerateContentConfig(**config_kwargs)}


def _gemini_tokens(response) -> int:
    usage = getattr(response, "usage_metadata", None)
    return (getattr(usage, "total_token_count", 0) or 0) if usage else 0


def _gemini(messages, model, key):
    client, kwargs = _gemini_request(messages, model, key)
    response = client.models.generate_content(**kwargs)
    return (response.text or "").strip(), _gemini_tokens(response)


def _gemini_stream(messages, model, key, usage):
    client, kwargs = _gemini_request(messages, model, key)
    for chunk in client.models.generate_content_stream(**kwargs):
        usage["tokens"] = _gemini_tokens(chunk) or usage.get("tokens", 0)   # the last chunk carries the totals
        text = chunk.text
        if text:
            yield text
