"""Cache service for optional Redis integration.

This module provides a centralized caching layer using Redis when available.
If Redis is unavailable, cache operations gracefully fall back to no-cache
behaviour without generating repeated connection errors.
"""

from contextlib import asynccontextmanager
import json
import logging
from typing import Any, Optional

import redis.asyncio as redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


class CacheService:
    """Service for managing optional Redis cache operations."""

    def __init__(self, redis_url: str, default_ttl: int = 3600):
        """Initialize the cache service."""
        self.redis_url = redis_url
        self.default_ttl = default_ttl
        self._pool: Optional[redis.ConnectionPool] = None
        self._available = False

    async def initialize(self) -> None:
        """Initialize Redis if it is available.

        Redis is optional. If it cannot be reached, caching is disabled
        and the application continues normally.
        """
        try:
            self._pool = redis.ConnectionPool.from_url(
                self.redis_url,
                decode_responses=True,
                max_connections=50,
            )

            async with self._get_client() as client:
                await client.ping()

            self._available = True
            logger.info("Redis cache initialized successfully")

        except Exception as e:
            self._available = False

            if self._pool:
                await self._pool.disconnect()
                self._pool = None

            logger.info(
                "Redis unavailable; continuing without cache: %s",
                e,
            )

    async def close(self) -> None:
        """Close the Redis connection pool."""
        if self._pool:
            await self._pool.disconnect()
            self._pool = None

        self._available = False

    def _disable(self, error: Exception) -> None:
        """Disable Redis after a runtime connection failure."""
        if self._available:
            logger.info(
                "Redis became unavailable; continuing without cache: %s",
                error,
            )

        self._available = False

    @asynccontextmanager
    async def _get_client(self):
        """Get a Redis client from the pool."""
        if not self._pool:
            raise RuntimeError("Cache service not initialized")

        client = redis.Redis(connection_pool=self._pool)

        try:
            yield client
        finally:
            await client.aclose()

    async def get(self, key: str) -> Optional[Any]:
        """Get a value from the cache."""
        if not self._available:
            return None

        try:
            async with self._get_client() as client:
                value = await client.get(key)

                if value is not None:
                    try:
                        return json.loads(value)
                    except json.JSONDecodeError:
                        return value

                return None

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> bool:
        """Set a value in the cache."""
        if not self._available:
            return False

        try:
            async with self._get_client() as client:
                if not isinstance(value, str):
                    value = json.dumps(value)

                ttl = ttl or self.default_ttl
                await client.setex(key, ttl, value)
                return True

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return False

    async def delete(self, key: str) -> bool:
        """Delete a key from the cache."""
        if not self._available:
            return False

        try:
            async with self._get_client() as client:
                result = await client.delete(key)
                return result > 0

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return False

    async def invalidate_pattern(self, pattern: str) -> int:
        """Invalidate all keys matching a pattern."""
        if not self._available:
            return 0

        try:
            async with self._get_client() as client:
                cursor = 0
                deleted = 0

                while True:
                    cursor, keys = await client.scan(
                        cursor,
                        match=pattern,
                        count=100,
                    )

                    if keys:
                        deleted += await client.delete(*keys)

                    if cursor == 0:
                        break

                logger.info(
                    "Invalidated %s keys matching pattern: %s",
                    deleted,
                    pattern,
                )
                return deleted

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return 0

    async def exists(self, key: str) -> bool:
        """Check if a key exists in the cache."""
        if not self._available:
            return False

        try:
            async with self._get_client() as client:
                return await client.exists(key) > 0

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return False

    async def get_ttl(self, key: str) -> int:
        """Get the remaining TTL for a key."""
        if not self._available:
            return -2

        try:
            async with self._get_client() as client:
                return await client.ttl(key)

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return -2

    async def health_check(self) -> bool:
        """Check if Redis is accessible."""
        if not self._available:
            return False

        try:
            async with self._get_client() as client:
                await client.ping()
                return True

        except (RedisError, RuntimeError) as e:
            self._disable(e)
            return False


# Singleton instance
_cache_service: Optional[CacheService] = None


def get_cache_service() -> Optional[CacheService]:
    """Get the global cache service instance."""
    return _cache_service


async def initialize_cache(
    redis_url: str,
    default_ttl: int = 3600,
) -> CacheService:
    """Initialize the global cache service.

    Redis is optional. Failure to connect does not prevent application
    startup.
    """
    global _cache_service

    if _cache_service is None:
        _cache_service = CacheService(redis_url, default_ttl)
        await _cache_service.initialize()

    return _cache_service


async def close_cache() -> None:
    """Close the global cache service."""
    global _cache_service

    if _cache_service is not None:
        await _cache_service.close()
        _cache_service = None