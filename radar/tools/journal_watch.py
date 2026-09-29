"""Literature search across OpenAlex, Crossref and Semantic Scholar.

These are *published papers*, useful for exploring a field (the MCP ``journal_watch`` tool), not
open opportunities: the pipeline does not store them as opportunities. Journal and conference calls
come from CFP sources (see DiscoveryAgent.search_wikicfp).
"""
import logging
import re
from typing import Any

from radar.dedup import fingerprint
from radar.models import Opportunity, OpportunitySource
from radar.sources import crossref_client, openalex_client, semantic_scholar_client

logger = logging.getLogger(__name__)

SUMMARY_CHARS = 600


def openalex_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    """Rebuild OpenAlex's abstract, which the API ships as {word: [positions]}."""
    if not inverted_index:
        return None
    positions = [(pos, word) for word, places in inverted_index.items() for pos in places]
    return " ".join(word for _, word in sorted(positions)) or None


def _strip_markup(text: str | None) -> str | None:
    """Crossref abstracts are JATS XML (<jats:p>…); keep the words."""
    if not text:
        return None
    return " ".join(re.sub(r"<[^>]+>", " ", text).split()) or None


def _summary(text: str | None) -> str | None:
    if not text:
        return None
    return text if len(text) <= SUMMARY_CHARS else text[:SUMMARY_CHARS].rsplit(" ", 1)[0] + "…"


def _metadata(origin: str, **fields: Any) -> dict[str, Any]:
    # A few useful fields rather than the whole API response (which bloated opportunities.metadata)
    return {"origin": origin, **{k: v for k, v in fields.items() if v not in (None, "", [])}}


def journal_watch(field: str) -> list[Opportunity]:
    """
    Search OpenAlex, Crossref, and Semantic Scholar for recent papers on `field`.
    Returns de-duplicated papers (as Opportunity records, kind="journal", status="unknown").
    """
    papers: list[Opportunity] = []

    try:
        for item in openalex_client.search_works(query=field, per_page=25):
            title = item.get("title") or item.get("display_name")
            if not title:
                continue
            doi = fingerprint.normalize_doi(item.get("doi"))
            url = f"https://doi.org/{doi}" if doi else item.get("id")
            source_info = (item.get("primary_location") or {}).get("source") or {}
            papers.append(Opportunity(
                kind="journal",
                title=title,
                summary=_summary(openalex_abstract(item.get("abstract_inverted_index"))),
                agency_or_publisher=source_info.get("publisher"),
                venue_name=source_info.get("display_name"),
                doi=doi,
                status="unknown",
                source_name="OpenAlex",
                source_url=url,
                external_id=item.get("id"),
                metadata=_metadata("openalex", publication_year=item.get("publication_year")),
                sources=[OpportunitySource(source_name="OpenAlex", source_url=url or "", external_id=item.get("id"))],
            ))
    except Exception as e:
        logger.error(f"OpenAlex fetch failed: {e.__class__.__name__}")

    try:
        for item in crossref_client.search_works(query=field, per_page=25):
            titles = item.get("title") or []
            if not titles:
                continue
            doi = fingerprint.normalize_doi(item.get("DOI"))
            url = item.get("URL") or (f"https://doi.org/{doi}" if doi else None)
            container = item.get("container-title") or []
            papers.append(Opportunity(
                kind="journal",
                title=titles[0],
                summary=_summary(_strip_markup(item.get("abstract"))),
                agency_or_publisher=item.get("publisher"),
                venue_name=container[0] if container else None,
                doi=doi,
                status="unknown",
                source_name="Crossref",
                source_url=url,
                external_id=doi,
                metadata=_metadata("crossref", type=item.get("type")),
                sources=[OpportunitySource(source_name="Crossref", source_url=url or "", external_id=doi)],
            ))
    except Exception as e:
        logger.error(f"Crossref fetch failed: {e.__class__.__name__}")

    try:
        for item in semantic_scholar_client.search_papers(query=field, limit=20):
            if not item.get("title"):
                continue
            doi = fingerprint.normalize_doi((item.get("externalIds") or {}).get("DOI"))
            paper_id = item.get("paperId", "")
            url = item.get("url") or (f"https://doi.org/{doi}" if doi else f"https://www.semanticscholar.org/paper/{paper_id}")
            papers.append(Opportunity(
                kind="journal",
                title=item["title"],
                summary=_summary(item.get("abstract")),
                agency_or_publisher=None,
                venue_name=item.get("venue") or None,
                doi=doi,
                status="unknown",
                source_name="Semantic Scholar",
                source_url=url,
                external_id=paper_id,
                metadata=_metadata("semantic_scholar", year=item.get("year")),
                sources=[OpportunitySource(source_name="Semantic Scholar", source_url=url, external_id=paper_id)],
            ))
    except Exception as e:
        logger.warning(f"Semantic Scholar fetch failed: {e.__class__.__name__}")

    deduped: list[Opportunity] = []
    for cand in papers:
        match = fingerprint.find_existing_match(cand, deduped)
        if not match:
            cand.fingerprint = fingerprint.compute_fingerprint(cand.kind, cand.title, cand.agency_or_publisher, cand.doi or cand.primary_source_url)
            deduped.append(cand)
        elif cand.primary_source_name and cand.primary_source_url:
            match.sources.append(OpportunitySource(
                source_name=cand.primary_source_name,
                source_url=cand.primary_source_url,
                external_id=cand.external_id
            ))
    return deduped
