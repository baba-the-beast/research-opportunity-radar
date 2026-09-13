"""journal_watch tool for discovering journals/venues."""
import logging

from radar.dedup import fingerprint
from radar.models import Opportunity, OpportunitySource
from radar.sources import crossref_client, openalex_client, semantic_scholar_client

logger = logging.getLogger(__name__)

def journal_watch(field: str) -> list[Opportunity]:
    """
    Queries OpenAlex, Crossref, and Semantic Scholar for journals/venues active in `field`.
    Returns a de-duplicated list of Opportunity items.
    """
    opportunities: list[Opportunity] = []

    # OpenAlex
    try:
        oa_results = openalex_client.search_works(query=field, per_page=25)
        for item in oa_results:
            title = item.get("title") or item.get("display_name")
            if not title:
                continue
            doi = item.get("doi")
            url = doi or item.get("id") or f"https://openalex.org/{item.get('id', '')}"
            primary_location = item.get("primary_location") or {}
            source_info = primary_location.get("source") or {}
            venue_name = source_info.get("display_name") or "OpenAlex Venue"
            publisher = source_info.get("publisher") or "OpenAlex"

            opp = Opportunity(
                kind="journal",
                title=title,
                summary=item.get("abstract_inverted_index") and f"Active research in {field}",
                agency_or_publisher=publisher,
                venue_name=venue_name,
                doi=doi,
                status="open",
                source_name="OpenAlex",
                source_url=url,
                external_id=item.get("id"),
                metadata=item
            )
            opp.sources.append(OpportunitySource(
                source_name="OpenAlex",
                source_url=url,
                external_id=item.get("id")
            ))
            opportunities.append(opp)
    except Exception as e:
        logger.error(f"OpenAlex fetch failed for field '{field}': {e}")

    # Crossref
    try:
        cr_results = crossref_client.search_works(query=field, per_page=25)
        for item in cr_results:
            titles = item.get("title") or []
            title = titles[0] if titles else None
            if not title:
                continue
            doi = item.get("DOI")
            url = item.get("URL") or (f"https://doi.org/{doi}" if doi else "https://crossref.org")
            publisher = item.get("publisher") or "Crossref"
            container = item.get("container-title") or []
            venue_name = container[0] if container else "Crossref Journal"

            opp = Opportunity(
                kind="journal",
                title=title,
                summary=f"Crossref publication record in {field}",
                agency_or_publisher=publisher,
                venue_name=venue_name,
                doi=doi,
                status="open",
                source_name="Crossref",
                source_url=url,
                external_id=doi,
                metadata=item
            )
            opp.sources.append(OpportunitySource(
                source_name="Crossref",
                source_url=url,
                external_id=doi
            ))
            opportunities.append(opp)
    except Exception as e:
        logger.error(f"Crossref fetch failed for field '{field}': {e}")

    # Semantic Scholar
    try:
        s2_results = semantic_scholar_client.search_papers(query=field, limit=20)
        for item in s2_results:
            title = item.get("title")
            if not title:
                continue
            ext_ids = item.get("externalIds") or {}
            doi = ext_ids.get("DOI")
            paper_id = item.get("paperId", "")
            url = item.get("url") or (f"https://doi.org/{doi}" if doi else f"https://www.semanticscholar.org/paper/{paper_id}")
            venue_name = item.get("venue") or "Semantic Scholar Index"
            abstract = item.get("abstract") or f"Semantic Scholar research indexing in {field}"

            opp = Opportunity(
                kind="journal",
                title=title,
                summary=abstract[:400],
                agency_or_publisher="Semantic Scholar",
                venue_name=venue_name,
                doi=doi,
                status="open",
                source_name="Semantic Scholar",
                source_url=url,
                external_id=paper_id,
                metadata=item
            )
            opp.sources.append(OpportunitySource(
                source_name="Semantic Scholar",
                source_url=url,
                external_id=paper_id
            ))
            opportunities.append(opp)
    except Exception as e:
        logger.warning(f"Semantic Scholar fetch failed for field '{field}': {e}")

    # Deduplicate candidate opportunities against each other
    deduped: list[Opportunity] = []
    for cand in opportunities:
        match = fingerprint.find_existing_match(cand, deduped)
        if not match:
            cand.fingerprint = fingerprint.compute_fingerprint(cand.kind, cand.title, cand.agency_or_publisher, cand.doi or cand.primary_source_url)
            deduped.append(cand)
        else:
            if cand.primary_source_name and cand.primary_source_url:
                match.sources.append(OpportunitySource(
                    source_name=cand.primary_source_name,
                    source_url=cand.primary_source_url,
                    external_id=cand.external_id
                ))

    return deduped
