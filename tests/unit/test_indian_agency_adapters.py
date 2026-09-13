"""Unit tests for ICMR and DBT Indian funding agency adapters."""
import json

import responses

from radar.sources.agencies.dbt_adapter import DBTAdapter
from radar.sources.agencies.icmr_adapter import ICMRAdapter
from radar.tools.funding_deadline_scan import AGENCY_REGISTRY, funding_deadline_scan

ICMR_MOCK_HTML = """
<html>
<body>
  <table>
    <thead>
      <tr><th>S.No</th><th>Title / Subject</th><th>Date</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>
          <a href="/content/call-proposals-ad-hoc-research-biomedical-2026">
            Call for Ad-hoc Research Proposals in Biomedical Engineering and AI in Healthcare
          </a>
        </td>
        <td>Last Date: 30/11/2026</td>
      </tr>
      <tr>
        <td>2</td>
        <td>
          <a href="https://www.icmr.gov.in/content/fellowship-call-rare-diseases">
            Extramural Research Grants for Translational Rare Diseases
          </a>
        </td>
        <td>15-12-2026</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
"""

DBT_MOCK_JSON = json.dumps([
    {
        "id": 1,
        "title": "Call for Proposals under DBT-Wellcome Trust India Alliance Clinical Research",
        "start_date": "01-09-2026",
        "end_date": "25-10-2026",
        "file_url": "https://dbt.gov.in/whats-new/dbt-wellcome-india-alliance-fellowship-2026"
    },
    {
        "id": 2,
        "title": "National Initiative on Synthetic Biology and Microbial Engineering",
        "start_date": "01-09-2026",
        "end_date": "10-12-2026",
        "file_url": "https://dbt.gov.in/whats-new/synthetic-biology-call"
    }
])


@responses.activate
def test_icmr_adapter_fetch_success():
    responses.add(
        responses.GET,
        "https://www.icmr.gov.in/call-for-proposals",
        body=ICMR_MOCK_HTML,
        status=200
    )
    adapter = ICMRAdapter()
    calls = adapter.fetch_open_calls()

    assert len(calls) == 2
    assert "Biomedical Engineering" in calls[0]["title"]
    assert calls[0]["url"] == "https://www.icmr.gov.in/content/call-proposals-ad-hoc-research-biomedical-2026"
    assert calls[0]["deadline"] is not None
    assert "30/11/2026" in calls[0]["deadline"]

    assert "Translational Rare Diseases" in calls[1]["title"]
    assert calls[1]["url"] == "https://www.icmr.gov.in/content/fellowship-call-rare-diseases"


@responses.activate
def test_icmr_adapter_http_error():
    responses.add(
        responses.GET,
        "https://www.icmr.gov.in/call-for-proposals",
        status=503
    )
    adapter = ICMRAdapter()
    calls = adapter.fetch_open_calls()
    assert calls == []


@responses.activate
def test_dbt_adapter_fetch_success():
    responses.add(
        responses.GET,
        "https://dbt.gov.in/data-view?name=call-for-proposals",
        body=DBT_MOCK_JSON,
        content_type="application/json",
        status=200
    )
    adapter = DBTAdapter()
    calls = adapter.fetch_open_calls()

    assert len(calls) == 2
    assert "India Alliance" in calls[0]["title"]
    assert calls[0]["url"] == "https://dbt.gov.in/whats-new/dbt-wellcome-india-alliance-fellowship-2026"
    assert calls[0]["deadline"] is not None

    assert "Synthetic Biology" in calls[1]["title"]
    assert calls[1]["url"] == "https://dbt.gov.in/whats-new/synthetic-biology-call"


@responses.activate
def test_dbt_adapter_http_error():
    responses.add(
        responses.GET,
        "https://dbt.gov.in/data-view?name=call-for-proposals",
        status=500
    )
    adapter = DBTAdapter()
    calls = adapter.fetch_open_calls()
    assert calls == []


def test_agency_registry_contains_icmr_and_dbt():
    assert "ICMR" in AGENCY_REGISTRY
    assert "DBT" in AGENCY_REGISTRY
    assert AGENCY_REGISTRY["ICMR"] is ICMRAdapter
    assert AGENCY_REGISTRY["DBT"] is DBTAdapter


@responses.activate
def test_funding_deadline_scan_integration():
    responses.add(
        responses.GET,
        "https://www.icmr.gov.in/call-for-proposals",
        body=ICMR_MOCK_HTML,
        status=200
    )
    responses.add(
        responses.GET,
        "https://dbt.gov.in/data-view?name=call-for-proposals",
        body=DBT_MOCK_JSON,
        content_type="application/json",
        status=200
    )

    opps = funding_deadline_scan(["ICMR", "DBT"])
    assert len(opps) == 4

    icmr_opps = [o for o in opps if o.agency_or_publisher == "ICMR"]
    dbt_opps = [o for o in opps if o.agency_or_publisher == "DBT"]

    assert len(icmr_opps) == 2
    assert len(dbt_opps) == 2
    assert all(o.primary_source_name in ("ICMR", "DBT") for o in opps)

