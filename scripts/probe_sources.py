"""Live health check of every opportunity source.

    python scripts/probe_sources.py            # Indian agencies + WikiCFP
    python scripts/probe_sources.py --pdfs     # also read call PDFs (slower)

For each source: how many open calls it returned, how many have a deadline, and any error. Exits 1
if a source failed or returned calls without deadlines for most items, so it can run in CI as a
non-blocking early warning that a site changed its layout.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from radar.agents.discovery_agent import DiscoveryAgent  # noqa: E402
from radar.sources.pdf_details import enrich_with_pdf_details  # noqa: E402
from radar.tools.funding_deadline_scan import AGENCY_REGISTRY, funding_deadline_scan  # noqa: E402

MIN_DEADLINE_COVERAGE = 0.6


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdfs", action="store_true", help="read call PDFs for missing details")
    parser.add_argument("--keyword", default="machine learning", help="keyword for the WikiCFP check")
    args = parser.parse_args()

    problems = 0
    print(f"{'source':10} {'calls':>5} {'dated':>5}  status")
    for agency in AGENCY_REGISTRY:
        errors: list[dict[str, str]] = []
        opps = funding_deadline_scan([agency], errors=errors)
        if args.pdfs:
            enrich_with_pdf_details(opps)
        dated = sum(1 for o in opps if any(d.deadline_date for d in o.deadlines) or o.metadata.get("rolling"))
        coverage = dated / len(opps) if opps else 1.0
        status = errors[0]["error"] if errors else ("ok" if coverage >= MIN_DEADLINE_COVERAGE else "few deadlines")
        problems += status != "ok"
        print(f"{agency:10} {len(opps):5} {dated:5}  {status}")

    agent = DiscoveryAgent()
    cfps = agent.search_wikicfp(args.keyword)
    status = agent.errors[0]["error"] if agent.errors else ("ok" if cfps else "no open CFPs found")
    problems += status != "ok"
    print(f"{'WikiCFP':10} {len(cfps):5} {len(cfps):5}  {status}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
