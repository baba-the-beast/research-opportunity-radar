from datetime import UTC, datetime, timedelta

import pytest

from radar import config
from radar.db import client as db


@pytest.fixture(autouse=True)
def setup_lock_env(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


def test_pipeline_lock_acquire_and_release():
    """Verify standard lock acquisition and subsequent release."""
    lock_key = "test_lock_standard"
    worker_1 = "worker-1"

    # Acquire lock
    acquired = db.acquire_pipeline_lock(lock_key=lock_key, locked_by=worker_1, ttl_seconds=60)
    assert acquired is True

    # Second worker cannot acquire
    acquired_2 = db.acquire_pipeline_lock(lock_key=lock_key, locked_by="worker-2", ttl_seconds=60)
    assert acquired_2 is False

    # Worker 1 releases
    released = db.release_pipeline_lock(lock_key=lock_key, locked_by=worker_1)
    assert released is True

    # Worker 2 can now acquire
    acquired_3 = db.acquire_pipeline_lock(lock_key=lock_key, locked_by="worker-2", ttl_seconds=60)
    assert acquired_3 is True


def test_pipeline_lock_expires():
    """Verify that an expired lock can be taken over by another worker."""
    lock_key = "test_lock_expired"
    worker_old = "worker-old"
    worker_new = "worker-new"

    client = db.get_client()
    # Seed an already expired lock in the database
    past_time = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
    client.table("pipeline_locks").insert({
        "lock_key": lock_key,
        "locked_by": worker_old,
        "acquired_at": past_time,
        "expires_at": past_time
    })

    # New worker should successfully take over the expired lock
    acquired = db.acquire_pipeline_lock(lock_key=lock_key, locked_by=worker_new, ttl_seconds=60)
    assert acquired is True
