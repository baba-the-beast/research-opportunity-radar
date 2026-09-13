import responses

from radar.sources import grants_gov_client


@responses.activate
def test_grants_gov_search_mocked():
    responses.add(
        responses.POST,
        "https://api.grants.gov/v1/api/search2",
        json={"data": {"oppHits": [{"id": "349812", "title": "Edge AI Systems"}]}},
        status=200
    )

    res = grants_gov_client.search_opportunities("edge AI")
    assert len(res) == 1
    assert res[0]["title"] == "Edge AI Systems"
