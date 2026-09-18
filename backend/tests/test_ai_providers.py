"""Drives the REAL provider SDKs against a fake HTTP layer.

The adapters pass keyword arguments straight into third-party SDKs. An SDK upgrade that renames
or removes one (as anthropic 1.x did with `temperature`) would otherwise only show up in
production, as every bot of that provider failing."""
import importlib
import json
import socket

import pytest

from urllib.parse import urlparse

from app.services.ai_service import AIProviderError, Endpoint, chat_completion, stream_completion
from app.services.providers import CUSTOM, OPENAI_PROTOCOL, PROVIDERS

MESSAGES = [
    {"role": "system", "content": "You are a test."},
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi!"},
    {"role": "user", "content": "How are you?"},
]

OPENAI_STYLE = {
    "id": "x", "object": "chat.completion", "created": 0, "model": "m",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": " pong "}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
}
ANTHROPIC_STYLE = {
    "id": "msg_1", "type": "message", "role": "assistant", "model": "m",
    "content": [{"type": "text", "text": " pong "}],
    "stop_reason": "end_turn", "stop_sequence": None,
    "usage": {"input_tokens": 5, "output_tokens": 2},
}
GEMINI_STYLE = {
    "candidates": [{"content": {"role": "model", "parts": [{"text": " pong "}]}, "finishReason": "STOP"}],
    "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 2, "totalTokenCount": 7},
}
def ep(provider, model=None, **kwargs):
    """An endpoint for `provider`; providers without a default model get a placeholder one."""
    if model is None and provider in PROVIDERS and PROVIDERS[provider].default_model is None:
        model = "some-vendor/some-model"
    return Endpoint(provider=provider, model=model, **kwargs)


# Every OpenAI-protocol provider in the catalogue is exercised, so adding one adds its test
OPENAI_LIKE = [p.id for p in PROVIDERS.values() if p.protocol == OPENAI_PROTOCOL and p.id != CUSTOM]
ALL_NAMED = [p.id for p in PROVIDERS.values() if p.id != CUSTOM]


def host_of(provider):
    base = PROVIDERS[provider].base_url
    if base:
        return urlparse(base).hostname
    return {"openai": "api.openai.com", "anthropic": "api.anthropic.com", "gemini": "generativelanguage.googleapis.com"}[provider]


def _pick(table, host):
    if host == "api.anthropic.com":
        return table["anthropic"]
    if host == "generativelanguage.googleapis.com":
        return table["gemini"]
    return table["openai"]


RESPONSES = {"openai": OPENAI_STYLE, "anthropic": ANTHROPIC_STYLE, "gemini": GEMINI_STYLE}


def _http_libraries():
    """The SDKs have moved between HTTP client packages across versions; cover whichever are installed."""
    found = []
    for name in ("httpx", "httpx2"):
        try:
            found.append(importlib.import_module(name))
        except ImportError:
            pass
    return found


def _intercept(monkeypatch, respond):
    """Answers every SDK request locally. Real sockets are blocked as well, so a missed
    interception fails loudly instead of quietly calling a provider."""
    def no_network(*args, **kwargs):
        raise AssertionError("test tried to open a real network connection")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    for lib in _http_libraries():
        def send(self, request, _lib=lib, **kwargs):
            status, body = respond(request)
            if isinstance(body, bytes):   # a server-sent-event stream
                return _lib.Response(status, content=body, headers={"content-type": "text/event-stream"}, request=request)
            return _lib.Response(status, json=body, request=request)
        monkeypatch.setattr(lib.Client, "send", send)


@pytest.fixture
def wire(monkeypatch):
    sent = []

    def respond(request):
        sent.append(request)
        return 200, _pick(RESPONSES, request.url.host)

    _intercept(monkeypatch, respond)
    return sent


@pytest.mark.parametrize("provider", ALL_NAMED)
def test_each_provider_adapter_works_with_the_installed_sdk(wire, provider):
    host = host_of(provider)
    reply, tokens = chat_completion(MESSAGES, ep(provider, None), "test-key")

    assert (reply, tokens) == ("pong", 7)
    assert [r.url.host for r in wire] == [host]
    body = json.loads(wire[0].content)
    expected_model = PROVIDERS[provider].default_model or "some-vendor/some-model"
    assert expected_model in (body.get("model", "") + str(wire[0].url))


def test_anthropic_and_gemini_receive_the_system_prompt_separately(wire):
    chat_completion(MESSAGES, ep("anthropic", None), "k")
    body = json.loads(wire[-1].content)
    assert body["system"] == "You are a test."
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]

    chat_completion(MESSAGES, ep("gemini", None), "k")
    body = json.loads(wire[-1].content)
    assert "You are a test." in json.dumps(body["systemInstruction"])
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]


def test_openai_reasoning_models_are_not_sent_a_temperature(wire):
    chat_completion(MESSAGES, ep("openai", "gpt-5-mini"), "k")
    assert "temperature" not in json.loads(wire[-1].content)
    chat_completion(MESSAGES, ep("openai", "gpt-4o-mini"), "k")
    assert json.loads(wire[-1].content)["temperature"] == 0.7


def test_provider_failures_become_aiprovidererror(monkeypatch):
    _intercept(monkeypatch, lambda request: (401, {"error": {"message": "Incorrect API key", "type": "invalid_request_error"}}))
    with pytest.raises(AIProviderError, match="AuthenticationError"):
        chat_completion(MESSAGES, ep("openai", None), "bad")


def test_empty_reply_and_unknown_provider_are_errors(wire, monkeypatch):
    monkeypatch.setitem(RESPONSES, "openai", {**OPENAI_STYLE, "choices": [{"index": 0, "message": {"role": "assistant", "content": None}, "finish_reason": "stop"}]})
    with pytest.raises(AIProviderError, match="empty"):
        chat_completion(MESSAGES, ep("openai", None), "k")
    with pytest.raises(AIProviderError, match="Unsupported"):
        chat_completion(MESSAGES, ep("skynet", None), "k")


# ---- streaming ----

def _sse(*payloads, named=False) -> bytes:
    lines = []
    for payload in payloads:
        if named:
            lines.append(f"event: {payload['type']}")
        lines.append("data: " + (payload if isinstance(payload, str) else json.dumps(payload)))
        lines.append("")
    return ("\n".join(lines) + "\n").encode()


def _openai_chunk(text=None, usage=None):
    choices = [] if text is None else [{"index": 0, "delta": {"content": text}, "finish_reason": None}]
    return {"id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m", "choices": choices, "usage": usage}


OPENAI_STREAM = _sse(
    _openai_chunk("po"), _openai_chunk("ng"),
    _openai_chunk(usage={"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}),
    "[DONE]",
)
ANTHROPIC_STREAM = _sse(
    {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "model": "m", "content": [],
                                          "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 5, "output_tokens": 0}}},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "po"}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "ng"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 2}},
    {"type": "message_stop"},
    named=True,
)
GEMINI_STREAM = _sse(
    {"candidates": [{"content": {"role": "model", "parts": [{"text": "po"}]}}]},
    {"candidates": [{"content": {"role": "model", "parts": [{"text": "ng"}]}, "finishReason": "STOP"}],
     "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 2, "totalTokenCount": 7}},
)
STREAMS = {"openai": OPENAI_STREAM, "anthropic": ANTHROPIC_STREAM, "gemini": GEMINI_STREAM}


@pytest.fixture
def stream_wire(monkeypatch):
    sent = []

    def respond(request):
        sent.append(request)
        return 200, _pick(STREAMS, request.url.host)

    _intercept(monkeypatch, respond)
    return sent


@pytest.mark.parametrize("provider", ALL_NAMED)
def test_each_provider_streams_with_the_installed_sdk(stream_wire, provider):
    usage = {}
    pieces = list(stream_completion(MESSAGES, ep(provider, None), "test-key", usage))

    assert pieces == ["po", "ng"]
    assert usage["tokens"] == 7
    assert len(stream_wire) == 1


def test_token_usage_is_only_requested_from_providers_known_to_support_it(stream_wire):
    list(stream_completion(MESSAGES, ep("openai", None), "k", {}))
    assert json.loads(stream_wire[-1].content)["stream_options"] == {"include_usage": True}
    list(stream_completion(MESSAGES, ep("grok", None), "k", {}))
    body = json.loads(stream_wire[-1].content)
    assert body["stream"] is True and "stream_options" not in body


def test_stream_failures_become_aiprovidererror(monkeypatch):
    _intercept(monkeypatch, lambda request: (429, {"error": {"message": "slow down", "type": "rate_limit_error"}}))
    for provider in ("openai", "anthropic", "gemini"):
        with pytest.raises(AIProviderError):
            list(stream_completion(MESSAGES, ep(provider, None), "k", {}))
