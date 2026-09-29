"""Faculty profile store module."""

from radar import config
from radar.db import client as db_client
from radar.models import FacultyProfile, ProfileTerm
from radar.scoring import component_scorer

_DEFAULT_PROFILE = {
    "full_name": "Dr. Vibha",
    "institution": "COEP Technological University",
    "department": "Computer Engineering",
    "research_keywords": ["graph neural networks", "fraud detection", "edge AI", "sensor fusion"],
    "profile_text": "Research focused on graph neural networks, financial fraud detection models, and edge AI sensor fusion.",
    "min_relevance_band": "watch",
    "deadline_alert_window_days": 30,
    "alert_frequency": "weekly"
}


def _row_to_profile(row: dict) -> FacultyProfile:
    profile = FacultyProfile(
        id=row["id"],
        full_name=row["full_name"],
        institution=row["institution"],
        department=row.get("department"),
        research_keywords=row.get("research_keywords") or [],
        profile_text=row.get("profile_text", ""),
        profile_embedding=row.get("profile_embedding"),
        min_relevance_band=row.get("min_relevance_band", "watch"),
        deadline_alert_window_days=row.get("deadline_alert_window_days", 30),
        alert_frequency=row.get("alert_frequency", "weekly"),
        openalex_author_id=row.get("openalex_author_id"),
        orcid=row.get("orcid"),
        career_stage=row.get("career_stage", "Assistant Professor"),
        phd_year=row.get("phd_year", 2021),
        institution_type=row.get("institution_type", "R1 Doctoral University (IHE)"),
        citizenship_status=row.get("citizenship_status", "US Citizen or Permanent Resident"),
        user_id=row.get("user_id"),
        loaded_updated_at=row.get("updated_at")
    )

    if isinstance(profile.profile_embedding, str):
        import json
        try:
            profile.profile_embedding = json.loads(profile.profile_embedding)
        except Exception:
            profile.profile_embedding = None

    # The web profile editor clears profile_embedding on every save, so a missing embedding
    # means "new or edited profile": recompute it and flag the profile for catalog rescoring.
    if not profile.profile_embedding and profile.profile_text:
        model = component_scorer.get_sentence_transformer()
        profile.profile_embedding = model.encode(profile.profile_text).tolist()
        profile.embedding_refreshed = True

    return profile


def save_profile_embedding(profile: FacultyProfile) -> None:
    """Persist a recomputed embedding. The pipeline calls this only after rescoring the catalog for
    the profile, so a dry run or a crash mid-run leaves the profile flagged for the next run."""
    client = db_client.get_client()
    # Conditional on the row being unchanged since the run loaded it. The web route bumps updated_at
    # and clears the embedding on every save (text, keywords, terms, citizenship...), so a save made
    # mid-run leaves the embedding cleared and the next run rescores against the new profile.
    query = client.table("faculty_profile").update({"profile_embedding": profile.profile_embedding}).eq("id", profile.id)
    if profile.loaded_updated_at:
        query = query.eq("updated_at", profile.loaded_updated_at)
    else:
        query = query.eq("profile_text", profile.profile_text)
    query.execute()
    profile.embedding_refreshed = False


def get_all_profiles() -> list[FacultyProfile]:
    """Every faculty profile, oldest first. The demo profile is seeded only into the in-memory dev
    database; a real database with no profiles yet simply has nobody to scan for."""
    client = db_client.get_client()
    res = client.table("faculty_profile").select("*").order("created_at").execute()
    rows = res.data or []
    if not rows and config.ALLOW_IN_MEMORY_DB:
        rows = client.table("faculty_profile").insert(dict(_DEFAULT_PROFILE)).execute().data
    return [_row_to_profile(row) for row in rows]


def get_profile(profile_id: str) -> FacultyProfile:
    client = db_client.get_client()
    res = client.table("faculty_profile").select("*").eq("id", profile_id).execute()
    if not res.data:
        raise ValueError(f"Faculty profile {profile_id} not found.")
    return _row_to_profile(res.data[0])


def get_active_profile() -> FacultyProfile:
    """Oldest profile. Kept for single-profile callers (MCP server); the pipeline uses get_all_profiles()."""
    client = db_client.get_client()
    res = client.table("faculty_profile").select("*").order("created_at").limit(1).execute()
    if not res.data:
        return get_all_profiles()[0]
    return _row_to_profile(res.data[0])

def get_profile_terms(profile_id: str) -> list[ProfileTerm]:
    client = db_client.get_client()
    res = client.table("profile_terms").select("*").eq("profile_id", profile_id).execute()
    result = []
    for r in res.data or []:
        result.append(ProfileTerm(
            id=r["id"],
            profile_id=r["profile_id"],
            term=r["term"],
            term_type=r["term_type"],
            weight=float(r.get("weight", 1.0)),
            polarity=r.get("polarity", "positive"),
            source=r.get("source", "manual")
        ))
    if not result and config.ALLOW_IN_MEMORY_DB:
        # Demo terms for the in-memory dev database only. A real user without terms is scored on
        # their profile text and keywords; writing someone else's topics into it would be wrong.
        defaults = [
            ("graph neural networks", "topic", 1.0, "positive"),
            ("fraud detection", "topic", 1.0, "positive"),
            ("edge AI", "topic", 0.9, "positive"),
            ("sensor fusion", "topic", 0.8, "positive"),
            ("deep learning", "method", 0.8, "positive"),
            ("financial graphs", "application", 0.9, "positive"),
            ("bioinformatics", "topic", 0.5, "negative")
        ]
        for term, term_type, weight, polarity in defaults:
            t_res = client.table("profile_terms").insert({
                "profile_id": profile_id,
                "term": term,
                "term_type": term_type,
                "weight": weight,
                "polarity": polarity,
                "source": "manual"
            }).execute()
            r = t_res.data[0] if t_res.data else {"id": "term-1", "profile_id": profile_id, "term": term, "term_type": term_type, "weight": weight, "polarity": polarity, "source": "manual"}
            result.append(ProfileTerm(
                id=r.get("id", "term-1"),
                profile_id=r.get("profile_id", profile_id),
                term=r.get("term", term),
                term_type=r.get("term_type", term_type),
                weight=float(r.get("weight", weight)),
                polarity=r.get("polarity", polarity),
                source=r.get("source", "manual")
            ))
    return result

def update_profile(
    profile_id: str,
    keywords: list[str],
    profile_text: str,
    terms: list[dict],
    full_name: str | None = None,
    institution: str | None = None,
    department: str | None = None,
    career_stage: str | None = None,
    phd_year: int | None = None,
    institution_type: str | None = None,
    citizenship_status: str | None = None,
    min_relevance_band: str | None = None
) -> FacultyProfile:
    client = db_client.get_client()
    model = component_scorer.get_sentence_transformer()
    embedding = model.encode(profile_text).tolist()

    payload: dict = {
        "research_keywords": keywords,
        "profile_text": profile_text,
        "profile_embedding": embedding
    }
    if full_name:
        payload["full_name"] = full_name
    if institution:
        payload["institution"] = institution
    if department:
        payload["department"] = department
    if career_stage:
        payload["career_stage"] = career_stage
    if phd_year is not None:
        payload["phd_year"] = phd_year
    if institution_type:
        payload["institution_type"] = institution_type
    if citizenship_status:
        payload["citizenship_status"] = citizenship_status
    if min_relevance_band:
        payload["min_relevance_band"] = min_relevance_band

    client.table("faculty_profile").update(payload).eq("id", profile_id).execute()

    client.table("profile_terms").delete().eq("profile_id", profile_id).execute()
    for t in terms:
        client.table("profile_terms").insert({
            "profile_id": profile_id,
            "term": t["term"],
            "term_type": t["term_type"],
            "weight": t.get("weight", 1.0),
            "polarity": t.get("polarity", "positive"),
            "source": t.get("source", "manual")
        }).execute()

    return get_profile(profile_id)
