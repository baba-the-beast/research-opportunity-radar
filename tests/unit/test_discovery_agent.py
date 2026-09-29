"""Unit tests for the discovery agent (WikiCFP calls for papers, NSF when US sources are on)."""
from datetime import date

import pytest
import responses

from radar import config
from radar.agents.discovery_agent import DiscoveryAgent, parse_wikicfp_results, us_sources_enabled
from radar.models import FacultyProfile

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
    <item>
      <title>Marine Biology Research</title>
      <link>https://www.nsf.gov/funding/opportunities/marine</link>
      <description>Ocean ecosystems. Deadline: 2026-12-01.</description>
    </item>
  </channel>
</rss>"""

# WikiCFP search results layout: two rows per event
MOCK_WIKICFP_HTML = """<html><body><table>
<tr bgcolor="#bbbbbb"><td rowspan="2">Event</td><td>When</td><td>Where</td><td>Deadline</td></tr>
<tr bgcolor="#f6f6f6">
  <td rowspan="2" align="left"><a href="/cfp/servlet/event.showcfp?eventid=191252&amp;copyownerid=196290">CPES 2026</a></td>
  <td align="left" colspan="3">International Conference on Cyber-Physical Edge Systems</td>
</tr>
<tr bgcolor="#f6f6f6"><td align="left">Feb 10, 2027 - Feb 12, 2027</td><td align="left">Pune, India</td><td align="left">Nov 15, 2026 (Nov 1, 2026)</td></tr>
<tr bgcolor="#e6e6e6">
  <td rowspan="2" align="left"><a href="/cfp/servlet/event.showcfp?eventid=180001&amp;copyownerid=1">SF 2025</a></td>
  <td align="left" colspan="3">Workshop on Sensor Fusion</td>
</tr>
<tr bgcolor="#e6e6e6"><td align="left">Jun 1, 2025 - Jun 2, 2025</td><td align="left">Online</td><td align="left">Mar 1, 2025</td></tr>
<tr bgcolor="#f6f6f6">
  <td rowspan="2" align="left"><a href="/cfp/servlet/event.showcfp?eventid=191300&amp;copyownerid=2">SI-SENSORS 2026</a></td>
  <td align="left" colspan="3">Special Issue on Sensor Fusion for Edge AI, IEEE Sensors Journal</td>
</tr>
<tr bgcolor="#f6f6f6"><td align="left">N/A</td><td align="left">N/A</td><td align="left">Dec 31, 2026</td></tr>
</table></body></html>"""

WIKICFP_URL = "http://www.wikicfp.com/cfp/servlet/tool.search?q=sensor+fusion&year=a"


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr("radar.deadlines.deadline_engine.today_ist", lambda: date(2026, 9, 29))


def test_parse_wikicfp_results():
    events = parse_wikicfp_results(MOCK_WIKICFP_HTML)
    assert [e["acronym"] for e in events] == ["CPES 2026", "SF 2025", "SI-SENSORS 2026"]
    first = events[0]
    assert first["name"] == "International Conference on Cyber-Physical Edge Systems"
    assert first["where"] == "Pune, India"
    assert first["deadline"] == "Nov 15, 2026"
    assert first["abstract_deadline"] == "Nov 1, 2026"
    assert first["url"] == "http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=191252&copyownerid=196290"


@responses.activate
def test_search_wikicfp_keeps_only_open_calls_with_deadlines():
    responses.add(responses.GET, WIKICFP_URL, body=MOCK_WIKICFP_HTML, status=200, content_type="text/html")
    items = DiscoveryAgent().search_wikicfp("sensor fusion")

    assert [i.external_id for i in items] == ["WIKICFP:191252", "WIKICFP:191300"]  # the 2025 workshop is closed
    conf, special_issue = items
    assert conf.kind == "venue"
    assert conf.title == "CFP: CPES 2026 — International Conference on Cyber-Physical Edge Systems"
    assert conf.deadlines[0].deadline_date == date(2026, 11, 15)
    assert conf.deadlines[0].deadline_type == "submission"
    assert "Where: Pune, India" in conf.summary
    assert special_issue.kind == "journal"
    assert special_issue.deadlines[0].deadline_type == "special_issue"


@responses.activate
def test_search_wikicfp_failure_is_recorded():
    responses.add(responses.GET, WIKICFP_URL, status=503)
    agent = DiscoveryAgent()
    assert agent.search_wikicfp("sensor fusion") == []
    assert agent.errors[0]["source"] == "WikiCFP"


@responses.activate
def test_search_nsf_filters_by_keyword():
    responses.add(responses.GET, "https://www.nsf.gov/rss/rss_www_funding.xml", body=MOCK_NSF_RSS, status=200,
                  content_type="application/xml")
    profile = FacultyProfile(full_name="Dr. A", institution="IIT", research_keywords=["cyber-physical systems"])
    items = DiscoveryAgent().search_nsf_solicitations(profile)

    assert len(items) == 1
    assert "Formal Methods in Computer Systems" in items[0].title
    assert items[0].deadlines[0].deadline_date == date(2026, 11, 15)


def test_us_sources_are_opt_in(monkeypatch):
    assert us_sources_enabled(["ANRF", "DST", "DBT", "ICMR"]) is False
    assert us_sources_enabled(["ANRF", "Grants.gov"]) is True
    monkeypatch.setattr(config, "AGENCY_LIST", ["ANRF"])
    assert us_sources_enabled() is False


@responses.activate
def test_discovery_cycle_skips_nsf_for_indian_defaults(monkeypatch):
    monkeypatch.setattr(config, "AGENCY_LIST", ["ANRF", "DST", "DBT", "ICMR"])
    responses.add(responses.GET, WIKICFP_URL, body=MOCK_WIKICFP_HTML, status=200, content_type="text/html")
    emitted = []
    profile = FacultyProfile(full_name="Dr. A", institution="IIT", research_keywords=["sensor fusion"])

    found = DiscoveryAgent(telemetry_callback=emitted.append).run_discovery_cycle(profile)

    assert {o.source_name for o in found} == {"WikiCFP"}
    assert {e["phase"] for e in emitted} == {"CYCLE_START", "CYCLE_COMPLETE"}
    assert not any("nsf.gov" in c.request.url for c in responses.calls)
