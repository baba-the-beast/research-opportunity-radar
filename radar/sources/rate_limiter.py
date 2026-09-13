"""
Thread-safe rate limiting utility for academic data sources and scrapers.
"""
import threading
import time


class RateLimiter:
    """Thread-safe rate limiter implementing fixed-window or minimum-interval delays."""

    def __init__(self, calls_per_second: float = 5.0, name: str = "generic"):
        self.calls_per_second = max(0.1, calls_per_second)
        self.interval = 1.0 / self.calls_per_second
        self.name = name
        self.last_called = 0.0
        self.lock = threading.Lock()

    def wait(self) -> None:
        """Blocks if necessary to ensure requests do not exceed the rate limit."""
        with self.lock:
            now = time.time()
            elapsed = now - self.last_called
            if elapsed < self.interval:
                sleep_time = self.interval - elapsed
                time.sleep(sleep_time)
            self.last_called = time.time()


# Standardized limiters for academic sources
openalex_limiter = RateLimiter(calls_per_second=5.0, name="openalex")
crossref_limiter = RateLimiter(calls_per_second=5.0, name="crossref")
grants_gov_limiter = RateLimiter(calls_per_second=3.0, name="grants_gov")
scraper_limiter = RateLimiter(calls_per_second=2.0, name="scrapers")
