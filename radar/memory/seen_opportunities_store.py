"""Seen opportunities deduplication memory store module."""
from radar.db import client as db_client


def is_new(fingerprint: str) -> bool:
    """Checks if opportunity fingerprint already exists in database."""
    client = db_client.get_client()
    res = client.table("opportunities").select("id").eq("fingerprint", fingerprint).limit(1).execute()
    return len(res.data or []) == 0
