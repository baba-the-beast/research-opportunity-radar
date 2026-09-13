"""MCP server exposing research opportunity tools over Model Context Protocol."""
from mcp.server.fastmcp import FastMCP

from radar.db.client import get_opportunity
from radar.memory.faculty_profile_store import get_active_profile
from radar.tools.funding_deadline_scan import funding_deadline_scan
from radar.tools.journal_watch import journal_watch
from radar.tools.relevance_score import relevance_score

mcp = FastMCP("research-opportunity-radar")

@mcp.tool()
def watch_journals(field: str) -> list[dict]:
    """Find journals/venues currently active in a given research field."""
    return [o.to_dict() for o in journal_watch(field)]

@mcp.tool()
def scan_funding(agency_list: list[str]) -> list[dict]:
    """Scan the given funding agencies for open calls with deadlines."""
    return [o.to_dict() for o in funding_deadline_scan(agency_list)]

@mcp.tool()
def score_relevance(opportunity_id: str) -> dict:
    """Score a previously discovered opportunity against the active faculty profile."""
    opp = get_opportunity(opportunity_id)
    profile = get_active_profile()
    return relevance_score(opp, profile).to_dict()

if __name__ == "__main__":
    mcp.run()
