"""Funders read with the configurable ListingAdapter: one entry per funder, no per-funder code.

To add a funder, find the page that lists its announcements, add an entry, and run
``python -m radar.sources.agencies.listings <name>`` to see which calls it would keep.
"""
import sys

from radar.sources.agencies.listing_adapter import ListingAdapter, ListingSource

LISTING_SOURCES = [
    ListingSource("UGC", "https://www.ugc.gov.in/"),
    ListingSource("AICTE", "https://www.aicte.gov.in/"),
    ListingSource("INSA", "https://insaindia.res.in/"),
    ListingSource("DRDO", "https://www.drdo.gov.in/drdo/"),
    ListingSource("CEFIPRA", "https://www.cefipra.org/"),
]
LISTING_SOURCES_BY_NAME = {s.name: s for s in LISTING_SOURCES}


if __name__ == "__main__":
    for name in sys.argv[1:] or list(LISTING_SOURCES_BY_NAME):
        adapter = ListingAdapter(LISTING_SOURCES_BY_NAME[name])
        calls = adapter.fetch_open_calls()
        print(f"{name}: {len(calls)} calls" + (f" (error: {adapter.last_error})" if adapter.last_error else ""))
        for call in calls:
            print(f"  {call.get('deadline') or 'date in PDF':12} {call['title'][:90]}")
