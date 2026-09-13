"""Unit tests for the Autonomous Discovery Agent."""
import responses

from radar.agents.discovery_agent import DiscoveryAgent
from radar.models import FacultyProfile, Opportunity

MOCK_NSF_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>National Science Foundation Funding Opportunities</title>
    <link>https://www.nsf.gov</link>
    <item>
      <title>Formal Methods in Computer Systems</title>
      <link>https://www.nsf.gov/funding/opportunities/fmc-formal-methods</link>
      <description>Solicitation for formal verification of cyber-physical systems. Full proposal deadline: 2026-11-15.</description>
      <pubDate>Mon, 10 Aug 2026 12:00:00 -0400</pubDate>
    </item>
  </channel>
</rss>"""

MOCK_WIKICFP_HTML = """<html><body>
  <div class="contsec">
    <a href="/cfp/servlet/event.showcfp?eventid=191252&amp;copyownerid=196290">Cyber-Physical Edge Systems 2026</a>
  </div>
</body></html>"""

def test_query_formulation():
    profile = FacultyProfile(
        full_name="Dr. Elena Vance",
        institution="MIT CSAIL",
        research_keywords=["cyber-physical systems", "sensor fusion", "edge AI"]
    )
    agent = DiscoveryAgent()
    queries = agent.formulate_queries(profile)

    assert len(queries) >= 6
    categories = {q["category"] for q in queries}
    assert "funding" in categories
    assert "journal" in categories
    assert "venue" in categories

@responses.activate
def test_search_nsf_solicitations():
    responses.add(
        responses.GET,
        "https://www.nsf.gov/rss/rss_www_funding.xml",
        body=MOCK_NSF_RSS,
        status=200,
        content_type="application/xml"
    )
    profile = FacultyProfile(
        full_name="Dr. Elena Vance",
        institution="MIT CSAIL",
        research_keywords=["cyber-physical systems"]
    )
    agent = DiscoveryAgent()
    items = agent.search_nsf_solicitations(profile)

    assert len(items) == 1
    item = items[0]
    assert "Formal Methods in Computer Systems" in item.title
    assert item.primary_source_url == "https://www.nsf.gov/funding/opportunities/fmc-formal-methods"
    assert item.agency_or_publisher == "National Science Foundation"
    assert item.kind == "funding"
    assert len(item.deadlines) == 1
    assert str(item.deadlines[0].deadline_date) == "2026-11-15"

@responses.activate
def test_search_wikicfp():
    responses.add(
        responses.GET,
        "http://www.wikicfp.com/cfp/servlet/tool.search?q=sensor+fusion&year=a",
        body=MOCK_WIKICFP_HTML,
        status=200,
        content_type="text/html"
    )
    agent = DiscoveryAgent()
    items = agent.search_wikicfp("sensor fusion")

    assert len(items) == 1
    item = items[0]
    assert "Cyber-Physical Edge Systems 2026" in item.title
    assert item.primary_source_url == "http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=191252&copyownerid=196290"
    assert item.external_id == "WIKICFP:191252"
    assert item.kind == "venue"

@responses.activate
def test_discover_unindexed_opportunities():
    responses.add(
        responses.GET,
        "https://www.nsf.gov/rss/rss_www_funding.xml",
        body=MOCK_NSF_RSS,
        status=200,
        content_type="application/xml"
    )
    responses.add(
        responses.GET,
        "http://www.wikicfp.com/cfp/servlet/tool.search?q=sensor+fusion&year=a",
        body=MOCK_WIKICFP_HTML,
        status=200,
        content_type="text/html"
    )
    profile = FacultyProfile(
        full_name="Dr. Elena Vance",
        institution="MIT CSAIL",
        research_keywords=["sensor fusion"]
    )
    agent = DiscoveryAgent()
    candidates = agent.discover_unindexed_opportunities(profile)

    assert len(candidates) >= 2
    for cand in candidates:
        assert isinstance(cand, Opportunity)
        assert cand.title
        assert cand.primary_source_url
        assert cand.primary_source_name
        assert cand.primary_source_url.startswith("http")

def test_discovery_telemetry_emission():
    emitted = []
    def callback(event):
        emitted.append(event)

    profile = FacultyProfile(
        full_name="Dr. Elena Vance",
        institution="MIT CSAIL",
        research_keywords=["edge AI"]
    )
    agent = DiscoveryAgent(telemetry_callback=callback)
    agent.run_discovery_cycle(profile)

    assert len(emitted) > 0
    agents = {e["agent"] for e in emitted}
    assert "DiscoveryAgent" in agents
    phases = {e["phase"] for e in emitted}
    assert "CYCLE_START" in phases
    assert "QUERY_FORMULATION" in phases
    assert "CYCLE_COMPLETE" in phases
