import responses

from radar.sources import openalex_client


@responses.activate
def test_openalex_search_works_mocked():
    responses.add(
        responses.GET,
        "https://api.openalex.org/works",
        json={"results": [{"id": "W123", "title": "Graph Neural Networks"}]},
        status=200
    )

    res = openalex_client.search_works("graph neural networks")
    assert len(res) == 1
    assert res[0]["title"] == "Graph Neural Networks"
