from radar.dedup import fingerprint
from radar.models import Opportunity


def test_compute_fingerprint_normalization():
    fp1 = fingerprint.compute_fingerprint("journal", "Graph Neural Networks", "IEEE", "http://doi.org/10.1234")
    fp2 = fingerprint.compute_fingerprint("journal", "graph neural networks ", "ieee", "HTTP://DOI.ORG/10.1234")
    assert fp1 == fp2

def test_find_existing_match_doi():
    existing = [
        Opportunity(kind="journal", title="Other", doi="10.1000/182", agency_or_publisher="IEEE", fingerprint="123")
    ]
    cand = Opportunity(kind="journal", title="Match DOI", doi="10.1000/182", agency_or_publisher="IEEE")
    matched = fingerprint.find_existing_match(cand, existing)
    assert matched is not None
    assert matched.doi == "10.1000/182"

def test_find_existing_match_fuzzy_without_signal():
    existing = [
        Opportunity(kind="journal", title="Graph Neural Networks in Financial Fraud Detection", agency_or_publisher="IEEE", fingerprint="123")
    ]
    cand = Opportunity(kind="journal", title="Graph Neural Networks for Financial Fraud Detection", agency_or_publisher="ACM")
    matched = fingerprint.find_existing_match(cand, existing)
    # Stage 5 requires overlapping org/venue or deadline month signal
    assert matched is None


def test_award_record_never_collapses_with_open_grant_solicitation():
    """
    Asserts that an NSF Awards API record (historical awarded intelligence)
    is never deduped/merged with a Grants.gov open solicitation for the same program.
    """
    grants_gov_open_call = Opportunity(
        kind="funding",
        title="Cyber-Physical Systems (CPS)",
        agency_or_publisher="National Science Foundation",
        source_name="Grants.gov",
        source_url="https://www.grants.gov/search-results-detail/12345",
        fingerprint="fp_open_call"
    )

    nsf_award_intelligence = Opportunity(
        kind="award",
        title="Cyber-Physical Systems (CPS)",
        agency_or_publisher="National Science Foundation",
        source_name="NSF Awards API",
        source_url="https://www.nsf.gov/awardsearch/showAward?AWD_ID=2149876",
        metadata={"origin": "nsf_awards_api", "award_id": "2149876"}
    )


    # 1. Matching check
    matched = fingerprint.find_existing_match(nsf_award_intelligence, [grants_gov_open_call])
    assert matched is None, "Award intelligence record must not collapse with open grant solicitation"

    # 2. Fingerprint check
    fp_call = fingerprint.compute_fingerprint(
        grants_gov_open_call.kind, grants_gov_open_call.title,
        grants_gov_open_call.agency_or_publisher, grants_gov_open_call.primary_source_url
    )
    fp_award = fingerprint.compute_fingerprint(
        nsf_award_intelligence.kind, nsf_award_intelligence.title,
        nsf_award_intelligence.agency_or_publisher, nsf_award_intelligence.primary_source_url
    )
    assert fp_call != fp_award, "Fingerprints must be completely distinct"

