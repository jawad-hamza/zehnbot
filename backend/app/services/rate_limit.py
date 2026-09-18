"""Fixed-window rate limiting. Redis-backed when REDIS_URL is set (required for more than
one worker/replica), otherwise an in-process counter."""
import logging
import threading
import time
from typing import Dict, Tuple

from fastapi import HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)


class _MemoryBackend:
    def __init__(self):
        self._lock = threading.Lock()
        self._counts: Dict[str, Tuple[int, float]] = {}   # key -> (count, expires_at)
        self._last_sweep = 0.0

    def incr(self, key: str, window: int) -> int:
        now = time.monotonic()
        with self._lock:
            if now - self._last_sweep > 60:
                self._counts = {k: v for k, v in self._counts.items() if v[1] > now}
                self._last_sweep = now
            count, expires = self._counts.get(key, (0, now + window))
            if expires <= now:
                count, expires = 0, now + window
            count += 1
            self._counts[key] = (count, expires)
            return count

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


class _RedisBackend:
    def __init__(self, url: str):
        import redis
        self._redis = redis.Redis.from_url(url, socket_timeout=1.0, socket_connect_timeout=1.0)

    def incr(self, key: str, window: int) -> int:
        pipe = self._redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window, nx=True)
        return int(pipe.execute()[0])


_memory = _MemoryBackend()
_redis_backend = _RedisBackend(settings.REDIS_URL) if settings.REDIS_URL else None


def _now() -> float:
    return time.time()   # indirection so tests can hold the clock still


def _incr(key: str, window: int) -> int:
    if _redis_backend is not None:
        try:
            return _redis_backend.incr(key, window)
        except Exception as exc:   # Redis down: degrade to per-process limiting rather than drop traffic
            logger.warning("Rate limiter: Redis unavailable (%s); using in-process counters", exc)
    return _memory.incr(key, window)


def enforce(scope: str, identity: str, limit: int, window_seconds: int, detail: str = "Too many requests. Please slow down.") -> None:
    """Raise 429 once `identity` has made more than `limit` calls to `scope` in the current window."""
    if limit <= 0:
        return
    bucket = int(_now() // window_seconds)
    key = f"rl:{scope}:{identity}:{bucket}"
    if _incr(key, window_seconds) > limit:
        raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": str(window_seconds)})


def client_ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers, so this is already the forwarded client address
    return request.client.host if request.client else "unknown"


def reset_for_tests() -> None:
    _memory.reset()
