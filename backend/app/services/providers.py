"""The catalogue of AI providers a bot (or the platform) can use.

Nearly the whole ecosystem speaks the OpenAI chat-completions protocol, so one adapter plus a base
URL covers it. Adding a provider is one entry here; the dashboard's form is generated from this
list (GET /api/admin/providers), so nothing else needs touching. Anything not listed is reachable
through `custom`: any OpenAI-compatible endpoint by URL (LiteLLM, vLLM, Azure-style gateways, ...).

`default_model` is only set where the name is stable and verified. Elsewhere the model is
required, because a stale default fails for every bot at once.
"""
from dataclasses import dataclass
from typing import Dict, Optional

OPENAI_PROTOCOL = "openai"
ANTHROPIC_PROTOCOL = "anthropic"
GEMINI_PROTOCOL = "gemini"

CUSTOM = "custom"


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    protocol: str = OPENAI_PROTOCOL
    base_url: Optional[str] = None          # None = the SDK's own default (OpenAI) or not applicable
    default_model: Optional[str] = None
    model_hint: str = ""
    keys_url: str = ""
    # Send stream_options.include_usage. Only where the provider documents it: an endpoint that
    # rejects unknown parameters would otherwise fail every streamed reply.
    stream_usage: bool = False
    # OpenAI's newer models take max_completion_tokens and a fixed temperature
    openai_native: bool = False
    needs_base_url: bool = False


_CATALOGUE = [
    Provider("deepseek", "DeepSeek", base_url="https://api.deepseek.com", default_model="deepseek-flash",
             model_hint="deepseek-flash (fast, low cost) or deepseek-v4-pro (stronger reasoning)",
             keys_url="https://platform.deepseek.com/api_keys", stream_usage=True),
    Provider("openrouter", "OpenRouter (one key, hundreds of models)", base_url="https://openrouter.ai/api/v1",
             model_hint="A model slug from openrouter.ai/models, in the form vendor/model",
             keys_url="https://openrouter.ai/keys"),
    Provider("openai", "OpenAI", default_model="gpt-4o-mini", model_hint="Any chat model your key can use",
             keys_url="https://platform.openai.com/api-keys", stream_usage=True, openai_native=True),
    Provider("anthropic", "Anthropic (Claude)", protocol=ANTHROPIC_PROTOCOL, default_model="claude-haiku-4-5",
             model_hint="claude-haiku-4-5 (fast, low cost), claude-sonnet-5, claude-opus-5",
             keys_url="https://console.anthropic.com/settings/keys"),
    Provider("gemini", "Google Gemini", protocol=GEMINI_PROTOCOL, default_model="gemini-2.5-flash",
             model_hint="e.g. gemini-2.5-flash, gemini-2.5-pro", keys_url="https://aistudio.google.com/apikey"),
    Provider("groq", "Groq", base_url="https://api.groq.com/openai/v1",
             model_hint="A model id from console.groq.com/docs/models", keys_url="https://console.groq.com/keys"),
    Provider("mistral", "Mistral", base_url="https://api.mistral.ai/v1",
             model_hint="e.g. mistral-small-latest", keys_url="https://console.mistral.ai/api-keys"),
    Provider("grok", "xAI Grok", base_url="https://api.x.ai/v1",
             model_hint="A model id from docs.x.ai/docs/models", keys_url="https://console.x.ai"),
    Provider("together", "Together AI", base_url="https://api.together.xyz/v1",
             model_hint="A model id from api.together.ai/models", keys_url="https://api.together.ai/settings/api-keys"),
    Provider("fireworks", "Fireworks AI", base_url="https://api.fireworks.ai/inference/v1",
             model_hint="e.g. accounts/fireworks/models/<model>", keys_url="https://fireworks.ai/account/api-keys"),
    Provider("cerebras", "Cerebras", base_url="https://api.cerebras.ai/v1",
             model_hint="A model id from inference-docs.cerebras.ai", keys_url="https://cloud.cerebras.ai"),
    Provider("perplexity", "Perplexity", base_url="https://api.perplexity.ai",
             model_hint="e.g. sonar", keys_url="https://www.perplexity.ai/settings/api"),
    Provider(CUSTOM, "Custom (any OpenAI-compatible endpoint)", needs_base_url=True,
             model_hint="The model name your endpoint expects"),
]

PROVIDERS: Dict[str, Provider] = {p.id: p for p in _CATALOGUE}


def get_provider(provider_id: Optional[str]) -> Optional[Provider]:
    return PROVIDERS.get((provider_id or "").strip().lower())
