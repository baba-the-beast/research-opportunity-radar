"""Supabase database client wrapper and queries."""
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from postgrest.exceptions import APIError

from radar import config
from radar.logging_config import get_logger, sanitize_log_text
from radar.models import Opportunity, OpportunityDeadline, OpportunitySource, ScoreResult
from supabase import Client, create_client

logger = get_logger(__name__)


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
        # Deferred like PostgREST: filters chained after update()/delete() narrow the mutation,
        # which is applied once at execute(). (Applying on the first .eq() silently ignored later
        # filters, e.g. the updated_at guard in save_profile_embedding.)
        self._mutation = ("update", data)
        self._mutation_filters = []
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
        self._mutation = ("delete", None)
        self._mutation_filters = []
        return self

    def _filter(self, predicate):
        if getattr(self, "_mutation", None):
            self._mutation_filters.append(predicate)
        else:
            self._last_result = [r for r in getattr(self, "_last_result", self._rows) if predicate(r)]
        return self

    def eq(self, col: str, val: Any):
        return self._filter(lambda r: r.get(col) == val)

    def neq(self, col: str, val: Any):
        return self._filter(lambda r: r.get(col) != val)

    def in_(self, col: str, vals: list[Any]):
        return self._filter(lambda r: r.get(col) in vals)

    def lt(self, col: str, val: Any):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) < str(val))

    def lte(self, col: str, val: Any):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) <= str(val))

    def gt(self, col: str, val: Any):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) > str(val))

    def order(self, *args, **kwargs):
        return self

    def limit(self, count: int):
        self._last_result = getattr(self, "_last_result", self._rows)[:count]
        return self

    def execute(self):
        from types import SimpleNamespace
        mutation = getattr(self, "_mutation", None)
        if mutation:
            kind, data = mutation
            filters = self._mutation_filters
            matched = [r for r in self._rows if all(f(r) for f in filters)]
            if kind == "update":
                for r in matched:
                    r.update(data)
            else:
                self._rows = [r for r in self._rows if not any(r is m for m in matched)]
            self._mutation = None
            self._mutation_filters = []
            self._last_result = matched
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
    if config.ALLOW_IN_MEMORY_DB:
        if _in_memory_client is None:
            _in_memory_client = _InMemoryClient()
        return _in_memory_client
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
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
        # run_log is readable by every signed-in user (activity feed): redact secrets that exception
        # text can carry (e.g. a Telegram URL with the bot token), whatever code path produced it
        "errors": [sanitize_log_text(e) if isinstance(e, str) else e for e in (errors or [])]
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

        _replace_deadlines(client, inserted_id, opp.deadlines)

        # One scoring_log row per faculty profile scored this run
        insert_scores(inserted_id, opp.profile_scores)

    return new_count

def _replace_deadlines(client: Any, opportunity_id: str, deadlines: list[OpportunityDeadline]) -> None:
    """Store the deadlines the source publishes now, dropping ones it no longer lists (e.g. an extended
    date replaces the original). Deadlines without a parseable date are not stored as rows: the
    opportunity simply has no deadline, which the UI shows as "not published"."""
    dated = [dl for dl in deadlines if dl.deadline_date]
    if not dated:
        return  # source stopped showing a date this run; keep what we knew
    current = {(dl.deadline_type, dl.deadline_date.isoformat()) for dl in dated if dl.deadline_date}
    stored = client.table("opportunity_deadlines").select("id, deadline_type, deadline_date").eq("opportunity_id", opportunity_id).execute()
    stale_ids = [row["id"] for row in stored.data or [] if (row["deadline_type"], row["deadline_date"]) not in current]
    if stale_ids:
        client.table("opportunity_deadlines").delete().in_("id", stale_ids).execute()
    client.table("opportunity_deadlines").upsert([
        {
            "opportunity_id": opportunity_id,
            "deadline_type": dl.deadline_type,
            "deadline_date": dl.deadline_date.isoformat() if dl.deadline_date else None,
            "timezone": dl.timezone,
            "confidence": dl.confidence,
            "raw_text": dl.raw_text
        }
        for dl in dated
    ], on_conflict="opportunity_id, deadline_type, deadline_date").execute()


def insert_scores(opportunity_id: str, profile_scores: dict[str, ScoreResult]) -> None:
    """Append scoring_log rows. Eligibility lives in components (RLS-scoped per faculty), not in the
    shared opportunities.metadata, so one faculty member's eligibility verdict is never visible to others."""
    if profile_scores:
        insert_scores_bulk([(opportunity_id, profile_scores)])


def insert_scores_bulk(scored: list[tuple[str, dict[str, ScoreResult]]], chunk_size: int = 500) -> None:
    """insert_scores for many opportunities in a few round trips instead of one per opportunity."""
    client = get_client()
    rows: list[dict[str, Any]] = []
    for opportunity_id, profile_scores in scored:
        for faculty_id, score in profile_scores.items():
            components: dict[str, Any] = dict(score.components)
            if score.eligibility_report:
                components["eligibility_report"] = score.eligibility_report
            rows.append({
                "opportunity_id": opportunity_id,
                "faculty_id": faculty_id,
                "final_score": score.final_score,
                "band": score.band,
                "components": components,
                "matched_terms": score.matched_terms,
                "negative_matches": score.negative_matches,
                "model_version": score.model_version,
            })
    for i in range(0, len(rows), chunk_size):
        client.table("scoring_log").insert(rows[i:i + chunk_size]).execute()


def load_alertable_opportunity_ids(faculty_id: str, user_id: str | None) -> set[str]:
    """Opportunities a faculty member should get deadline alerts for: ones they saved or are
    pursuing/applied to, plus ones scored high/strong for them."""
    client = get_client()
    ids: set[str] = set()
    # scoring_log is append-only: judge each opportunity by its LATEST score for this faculty, so a
    # profile edit that rescored something down to "watch" stops its urgent alerts
    scored = (
        client.table("scoring_log").select("opportunity_id, band, scored_at")
        .eq("faculty_id", faculty_id).order("scored_at", desc=True).execute()
    )
    latest_band: dict[str, str] = {}
    for row in sorted(scored.data or [], key=lambda r: str(r.get("scored_at") or ""), reverse=True):
        latest_band.setdefault(row["opportunity_id"], row.get("band"))
    ids.update(opp_id for opp_id, band in latest_band.items() if band in ("high", "strong"))
    if user_id:
        tracked = client.table("user_opportunity_state").select("opportunity_id, saved, status").eq("user_id", user_id).execute()
        ids.update(
            r["opportunity_id"] for r in tracked.data or []
            if r.get("saved") or r.get("status") in ("pursuing", "applied")
        )
    return ids


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

def load_feedback_signals(rating: str = "not_relevant", faculty_id: str | None = None) -> list[dict[str, Any]]:
    """Load feedback records to adjust scoring. Pass faculty_id so one user's dismissals
    only penalise their own scores."""
    client = get_client()
    query = client.table("feedback").select("*").eq("rating", rating)
    if faculty_id:
        query = query.eq("faculty_id", faculty_id)
    res = query.execute()
    return res.data or []


ARCHIVED_STATUS = "closed"


def archive_stale_opportunities(older_than_days: int = 90) -> int:
    """
    Sets status = 'closed' for opportunities whose every deadline is older than older_than_days.
    Uses 'closed' because opportunities.status is CHECK-constrained to open/forecasted/upcoming/closed/unknown.
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
            client.table("opportunities").update({"status": ARCHIVED_STATUS}).eq("id", opp_id).neq("status", ARCHIVED_STATUS).execute()
            archived_count += 1

    return archived_count


_in_memory_lock_mutex = threading.Lock()


def acquire_pipeline_lock(
    lock_key: str = "radar_pipeline_global",
    locked_by: str = "orchestrator",
    ttl_seconds: int = 900
) -> bool:
    """
    Acquires a distributed lease in pipeline_locks. Returns True only if this caller now holds it.

    Atomic on Postgres: a plain INSERT wins when no row exists (PK conflict otherwise), and an
    UPDATE ... WHERE expires_at < now() takes over only an expired lease. Fails closed on errors.
    """
    client = get_client()
    now_dt = datetime.now(UTC)
    now_iso = now_dt.isoformat()
    row = {
        "lock_key": lock_key,
        "locked_by": locked_by,
        "locked_at": now_iso,
        "expires_at": (now_dt + timedelta(seconds=ttl_seconds)).isoformat(),
    }

    if isinstance(client, _InMemoryClient):
        with _in_memory_lock_mutex:
            table = client.table("pipeline_locks")
            existing = next((r for r in table._rows if r.get("lock_key") == lock_key), None)
            if existing and str(existing.get("expires_at", "")) > now_iso:
                return False
            if existing:
                existing.update(row)
            else:
                table._rows.append(dict(row))
            return True

    try:
        client.table("pipeline_locks").insert(row).execute()
        return True
    except APIError as e:
        if e.code != "23505":  # anything but "lease row already exists"
            logger.error(f"Pipeline lock acquisition failed: {e}", source_name="pipeline_lock", error_category="database_error")
            return False
    except Exception as e:  # network/timeout: refuse rather than crash before run_log is closed
        logger.error(f"Pipeline lock acquisition failed: {e}", source_name="pipeline_lock", error_category="database_error")
        return False

    try:
        takeover = (
            client.table("pipeline_locks")
            .update(row)
            .eq("lock_key", lock_key)
            .lt("expires_at", now_iso)
            .execute()
        )
        return bool(takeover.data)
    except Exception as e:
        logger.error(f"Pipeline lock takeover failed: {e}", source_name="pipeline_lock", error_category="database_error")
        return False


def renew_pipeline_lock(
    lock_key: str = "radar_pipeline_global",
    locked_by: str = "orchestrator",
    ttl_seconds: int = 300
) -> bool:
    """Extends a lease this caller still holds. False if it was lost (taken over or deleted) or the
    renewal failed, in which case the caller must stop doing lock-protected work."""
    client = get_client()
    try:
        res = (
            client.table("pipeline_locks")
            .update({"expires_at": (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat()})
            .eq("lock_key", lock_key)
            .eq("locked_by", locked_by)
            .execute()
        )
        return bool(res.data)
    except Exception as e:
        logger.error(f"Pipeline lock renewal failed: {e}", source_name="pipeline_lock", error_category="database_error")
        return False


class PipelineLease:
    """Keeps a pipeline lease alive from a background thread for as long as the run lasts.

    A fixed TTL either expires under a long multi-profile run (another run takes over and both send
    alerts) or, if set very long, leaves a crashed run's lock stuck. Renewing a short lease gives
    both: overlap protection for any run length and quick recovery after a crash.
    """

    def __init__(self, lock_key: str, locked_by: str, ttl_seconds: int = 300, renew_every: float = 60.0):
        self.lock_key = lock_key
        self.locked_by = locked_by
        self.ttl_seconds = ttl_seconds
        self.renew_every = renew_every
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def lost(self) -> bool:
        return self._lost.is_set()

    def acquire(self) -> bool:
        if not acquire_pipeline_lock(self.lock_key, locked_by=self.locked_by, ttl_seconds=self.ttl_seconds):
            return False
        self._thread = threading.Thread(target=self._heartbeat, name="pipeline-lease", daemon=True)
        self._thread.start()
        return True

    def _heartbeat(self) -> None:
        while not self._stop.wait(self.renew_every):
            if not renew_pipeline_lock(self.lock_key, self.locked_by, self.ttl_seconds):
                self._lost.set()
                logger.error("Pipeline lease lost; this run will skip alerting",
                             source_name="pipeline_lock", error_category="lock_lost")
                return

    def release(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        release_pipeline_lock(self.lock_key, locked_by=self.locked_by)


def release_pipeline_lock(
    lock_key: str = "radar_pipeline_global",
    locked_by: str | None = None
) -> bool:
    """
    Releases the distributed lock for the specified lock_key.
    """
    client = get_client()
    try:
        query = client.table("pipeline_locks").delete().eq("lock_key", lock_key)
        if locked_by:
            query = query.eq("locked_by", locked_by)
        query.execute()
        return True
    except Exception:
        return False


