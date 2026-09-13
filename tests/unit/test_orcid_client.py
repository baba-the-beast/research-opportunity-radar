
import json
from pathlib import Path

from radar.sources.orcid_client import normalize_orcid, parse_orcid_record_data

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "orcid_2026_sample.json"

with open(FIXTURE_PATH, encoding="utf-8") as f:
    ORCID_RECORD_FIXTURE = json.load(f)


def test_normalize_orcid():
    assert normalize_orcid("0000-0002-1825-0097") == "0000-0002-1825-0097"
    assert normalize_orcid("https://orcid.org/0000-0002-1825-0097") == "0000-0002-1825-0097"
    assert normalize_orcid("http://orcid.org/0000-0002-1825-0097/") == "0000-0002-1825-0097"


def test_orcid_client_parses_profile_data():
    profile = parse_orcid_record_data(ORCID_RECORD_FIXTURE)

    # 1. Identity & Affiliation
    assert profile["full_name"] == "Vibha Patil"
    assert profile["institution"] == "College of Engineering Pune"
    assert profile["department"] == "Department of Computer Engineering"
    assert "graph neural networks" in profile["keywords"]

    # 2. Career stage inference (first pub 2018 -> ~8 years active -> mid_career)
    assert profile["career_stage"] == "mid_career"
    assert profile["phd_year"] == 2018

    # 3. Candidate terms extraction
    terms = profile["candidate_terms"]
    term_names = [t["term"] for t in terms]
    assert "graph neural networks" in term_names
    assert "fraud detection" in term_names
    assert "IEEE Transactions on Neural Networks" in term_names
    assert any(t["term_type"] == "venue" for t in terms)
    assert any(t["term_type"] == "topic" for t in terms)
