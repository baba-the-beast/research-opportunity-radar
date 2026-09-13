"""Supabase database client wrapper and queries."""
from datetime import UTC, datetime, timedelta
from typing import Any

from supabase import Client, create_client

from radar import config
from radar.models import Opportunity, OpportunityDeadline, OpportunitySource


class _InMemoryTable:
    def __init__(self, name: str):
        self.name = name
        self._rows: list[dict[str, Any]] = []

    def insert(self, record: Any):
        rows = [record] if isinstance(record, dict) else list(record)
        import uuid
        for r in rows:
            if "id" not in r:
                r["id"] = f"{self.name}-{uuid.uuid4().hex[:8]}"
            self._rows.append(r)
        self._last_result = rows
        return self

    def select(self, *args, **kwargs):
        self._last_result = list(self._rows)
        return self

    def update(self, data: dict[str, Any]):
        self._update_data = data
        return self

    def upsert(self, records: Any, **kwargs):
        on_conflict = kwargs.get("on_conflict")
        rows = [records] if isinstance(records, dict) else list(records)
        import uuid
        upserted = []
        for r in rows:
            if on_conflict:
                keys = [k.strip() for k in on_conflict.split(",")]
                matched = None
                for existing in self._rows:
                    if all(existing.get(k) == r.get(k) for k in keys):
                        matched = existing
                        break
                if matched:
                    matched.update(r)
                    upserted.append(matched)
                    continue
            if "id" not in r:
                r["id"] = f"{self.name}-{uuid.uuid4().hex[:8]}"
            self._rows.append(r)
            upserted.append(r)
        self._last_result = upserted
        return self

    def delete(self):
        self._is_delete = True
        return self

    def eq(self, col: str, val: Any):
        if getattr(self, "_is_delete", False):
            self._rows = [r for r in self._rows if r.get(col) != val]
            self._last_result = []
            self._is_delete = False
        elif hasattr(self, "_update_data"):
            for r in self._rows:
                if r.get(col) == val:
                    r.update(self._update_data)
            del self._update_data
        else:
            self._last_result = [r for r in self._rows if r.get(col) == val]
        return self

    def neq(self, col: str, val: Any):
        if hasattr(self, "_update_data"):
            for r in self._rows:
                if r.get(col) != val:
                    r.update(self._update_data)
            del self._update_data
        else:
            self._last_result = [r for r in getattr(self, "_last_result", self._rows) if r.get(col) != val]
        return self

    def lte(self, col: str, val: Any):
        self._last_result = [r for r in getattr(self, "_last_result", self._rows) if r.get(col) and str(r.get(col)) <= str(val)]
        return self

    def gt(self, col: str, val: Any):
        self._last_result = [r for r in getattr(self, "_last_result", self._rows) if r.get(col) and str(r.get(col)) > str(val)]
        return self


    def order(self, *args, **kwargs):
        return self

    def limit(self, count: int):
        self._last_result = getattr(self, "_last_result", self._rows)[:count]
        return self

    def execute(self):
        from types import SimpleNamespace
        data = getattr(self, "_last_result", list(self._rows))
        return SimpleNamespace(data=data)

class _InMemoryClient:
    def __init__(self):
        self._tables: dict[str, _InMemoryTable] = {}

    def table(self, name: str):
        if name not in self._tables:
            self._tables[name] = _InMemoryTable(name)
        return self._tables[name]

_supabase_client = None
_in_memory_client = None

def get_client() -> Any:
    global _supabase_client, _in_memory_client
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        if config.ALLOW_IN_MEMORY_DB:
            if _in_memory_client is None:
                _in_memory_client = _InMemoryClient()
            return _in_memory_client
        raise config.ConfigurationError(
            "Supabase credentials missing! Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment, "
            "or set ALLOW_IN_MEMORY_DB=1 to explicitly permit ephemeral in-memory storage."
        )
    if _supabase_client is None:
        _supabase_client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    return _supabase_client

def start_run_log() -> str:
    client = get_client()
    res = client.table("run_log").insert({
        "started_at": datetime.now(UTC).isoformat(),
        "status": "running"
    }).execute()
    return res.data[0]["id"]

def finish_run_log(run_id: str, status: str, found: int = 0, new: int = 0, errors: list[Any] | None = None) -> None:
    client = get_client()
    client.table("run_log").update({
        "finished_at": datetime.now(UTC).isoformat(),
        "status": status,
        "opportunities_found": found,
        "opportunities_new": new,
        "errors": errors or []
    }).eq("id", run_id).execute()

def start_source_run(run_id: str, source_name: str) -> str:
    client = get_client()
    # lookup or seed source
    src_res = client.table("sources").select("id").eq("name", source_name).execute()
    if src_res.data:
        source_id = src_res.data[0]["id"]
    else:
        new_src = client.table("sources").insert({
            "name": source_name,
            "source_type": "api",
            "base_url": "https://api.example.com",
            "health_status": "healthy"
        }).execute()
        source_id = new_src.data[0]["id"]

    res = client.table("source_runs").insert({
        "run_id": run_id,
        "source_id": source_id,
        "started_at": datetime.now(UTC).isoformat(),
        "status": "running"
    }).execute()
    return res.data[0]["id"]

def finish_source_run(source_run_id: str, status: str, request_count: int = 0, inserted_count: int = 0, updated_count: int = 0, error_count: int = 0, error_category: str | None = None, latency_ms: int | None = None) -> None:
    client = get_client()
    client.table("source_runs").update({
        "finished_at": datetime.now(UTC).isoformat(),
        "status": status,
        "request_count": request_count,
        "inserted_count": inserted_count,
        "updated_count": updated_count,
        "error_count": error_count,
        "error_category": error_category,
        "latency_ms": latency_ms
    }).eq("id", source_run_id).execute()

def load_recent_opportunities(limit: int = 500) -> list[Opportunity]:
    client = get_client()
    res = client.table("opportunities").select("*, opportunity_deadlines(*), opportunity_sources(*)").order("discovered_at", desc=True).limit(limit).execute()
    result: list[Opportunity] = []
    for row in res.data or []:
        opp = Opportunity(
            id=row["id"],
            kind=row["kind"],
            title=row["title"],
            summary=row.get("summary"),
            agency_or_publisher=row.get("agency_or_publisher"),
            venue_name=row.get("venue_name"),
            doi=row.get("doi"),
            status=row.get("status", "unknown"),
            fingerprint=row["fingerprint"],
            metadata=row.get("metadata") or {}
        )
        for dl in row.get("opportunity_deadlines") or []:
            opp.deadlines.append(OpportunityDeadline(
                id=dl["id"],
                deadline_type=dl["deadline_type"],
                deadline_date=datetime.strptime(dl["deadline_date"], "%Y-%m-%d").date() if dl.get("deadline_date") else None,
                timezone=dl.get("timezone", "Asia/Kolkata"),
                confidence=dl.get("confidence", "unknown"),
                raw_text=dl.get("raw_text")
            ))
        for src in row.get("opportunity_sources") or []:
            opp.sources.append(OpportunitySource(
                source_id=src["source_id"],
                source_name="",  # filled when queried
                source_url=src["source_url"],
                external_id=src.get("external_id")
            ))
        result.append(opp)
    return result

def get_opportunity(opportunity_id: str) -> Opportunity:
    client = get_client()
    res = client.table("opportunities").select("*, opportunity_deadlines(*), opportunity_sources(*)").eq("id", opportunity_id).execute()
    if not res.data:
        raise ValueError(f"Opportunity {opportunity_id} not found.")
    row = res.data[0]
    opp = Opportunity(
        id=row["id"],
        kind=row["kind"],
        title=row["title"],
        summary=row.get("summary"),
        agency_or_publisher=row.get("agency_or_publisher"),
        venue_name=row.get("venue_name"),
        doi=row.get("doi"),
        status=row.get("status", "unknown"),
        fingerprint=row["fingerprint"],
        metadata=row.get("metadata") or {}
    )
    for dl in row.get("opportunity_deadlines") or []:
        opp.deadlines.append(OpportunityDeadline(
            id=dl["id"],
            deadline_type=dl["deadline_type"],
            deadline_date=datetime.strptime(dl["deadline_date"], "%Y-%m-%d").date() if dl.get("deadline_date") else None,
            timezone=dl.get("timezone", "Asia/Kolkata"),
            confidence=dl.get("confidence", "unknown"),
            raw_text=dl.get("raw_text")
        ))
    for src in row.get("opportunity_sources") or []:
        opp.sources.append(OpportunitySource(
            source_id=src["source_id"],
            source_name="",
            source_url=src["source_url"],
            external_id=src.get("external_id")
        ))
    return opp

def _get_source_id(client: Client, source_name: str) -> str:
    res = client.table("sources").select("id").eq("name", source_name).execute()
    if res.data:
        return res.data[0]["id"]
    new_src = client.table("sources").insert({
        "name": source_name,
        "source_type": "api",
        "base_url": "https://api.example.com",
        "health_status": "healthy"
    }).execute()
    return new_src.data[0]["id"]

def upsert_opportunities(accepted: list[tuple[Opportunity, str]], provenance_updates: list[tuple[str, str, str]]) -> int:
    client = get_client()
    new_count = 0

    # Apply provenance updates first for matching existing items
    for opp_id, source_name, source_url in provenance_updates:
        source_id = _get_source_id(client, source_name)
        client.table("opportunity_sources").upsert({
            "opportunity_id": opp_id,
            "source_id": source_id,
            "source_url": source_url,
            "last_seen_at": datetime.now(UTC).isoformat()
        }, on_conflict="opportunity_id, source_id").execute()

    for opp, _reason in accepted:
        # Check if already present by fingerprint before upserting
        existing = client.table("opportunities").select("id").eq("fingerprint", opp.fingerprint).execute()
        is_already_present = bool(existing.data)

        # Upsert main opportunity row on fingerprint
        opp_row = {
            "kind": opp.kind,
            "title": opp.title,
            "summary": opp.summary,
            "agency_or_publisher": opp.agency_or_publisher,
            "venue_name": opp.venue_name,
            "doi": opp.doi,
            "status": opp.status,
            "fingerprint": opp.fingerprint,
            "metadata": opp.metadata or {}
        }
        if opp.embedding:
            opp_row["embedding"] = opp.embedding

        res = client.table("opportunities").upsert(opp_row, on_conflict="fingerprint").execute()
        if not res.data:
            continue
        inserted_id = res.data[0]["id"]
        opp.id = inserted_id
        if not is_already_present:
            new_count += 1

        # Insert opportunity sources
        source_name = opp.primary_source_name or "Unknown"
        source_url = opp.primary_source_url or "https://example.com"
        source_id = _get_source_id(client, source_name)
        client.table("opportunity_sources").upsert({
            "opportunity_id": inserted_id,
            "source_id": source_id,
            "external_id": opp.external_id,
            "source_url": source_url,
            "last_seen_at": datetime.now(UTC).isoformat()
        }, on_conflict="opportunity_id, source_id").execute()

        # Insert opportunity deadlines
        for dl in opp.deadlines:
            client.table("opportunity_deadlines").insert({
                "opportunity_id": inserted_id,
                "deadline_type": dl.deadline_type,
                "deadline_date": dl.deadline_date.isoformat() if dl.deadline_date else "2099-12-31",
                "timezone": dl.timezone,
                "confidence": dl.confidence,
                "raw_text": dl.raw_text
            }).execute()

        # Write scoring log if scored
        if opp.score_result:
            # fetch faculty id if available
            prof_res = client.table("faculty_profile").select("id").limit(1).execute()
            if prof_res.data:
                faculty_id = prof_res.data[0]["id"]
                client.table("scoring_log").insert({
                    "opportunity_id": inserted_id,
                    "faculty_id": faculty_id,
                    "final_score": opp.score_result.final_score,
                    "band": opp.score_result.band,
                    "components": opp.score_result.components,
                    "matched_terms": opp.score_result.matched_terms,
                    "negative_matches": opp.score_result.negative_matches,
                    "model_version": opp.score_result.model_version
                }).execute()

    return new_count

def record_feedback(
    opportunity_id: str,
    faculty_id: str,
    rating: str,
    feedback_text: str = "",
    negative_terms: list[str] | None = None
) -> str:
    """Record explicit faculty relevance feedback and negative tuning terms."""
    client = get_client()
    res = client.table("feedback").insert({
        "opportunity_id": opportunity_id,
        "faculty_id": faculty_id,
        "rating": rating,
        "feedback_text": feedback_text,
        "negative_terms": negative_terms or [],
        "created_at": datetime.now(UTC).isoformat()
    }).execute()
    return res.data[0]["id"] if res.data else ""

def load_feedback_signals(rating: str = "not_relevant") -> list[dict[str, Any]]:
    """Load feedback records to adjust scoring models dynamically."""
    client = get_client()
    res = client.table("feedback").select("*").eq("rating", rating).execute()
    return res.data or []


def archive_stale_opportunities(older_than_days: int = 90) -> int:
    """
    Sets status = 'archived' for opportunities where next_deadline < now() - older_than_days.
    Preserves fingerprint deduplication records so expired opportunities are never re-discovered as new.
    """
    client = get_client()
    cutoff_date = (datetime.now(UTC) - timedelta(days=older_than_days)).date().isoformat()

    dl_res = (
        client.table("opportunity_deadlines")
        .select("opportunity_id, deadline_date")
        .lte("deadline_date", cutoff_date)
        .execute()
    )
    if not dl_res.data:
        return 0

    archived_count = 0
    opp_ids = {row["opportunity_id"] for row in dl_res.data}
    for opp_id in opp_ids:
        active_dl = (
            client.table("opportunity_deadlines")
            .select("id")
            .eq("opportunity_id", opp_id)
            .gt("deadline_date", cutoff_date)
            .execute()
        )
        if not active_dl.data:
            client.table("opportunities").update({"status": "archived"}).eq("id", opp_id).neq("status", "archived").execute()
            archived_count += 1

    return archived_count

