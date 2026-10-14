"""Quick rescore: score the stored catalog for profiles that were just created or edited.

A full scan runs twice a week, so without this a new user would see an unscored feed for days. The
dashboard dispatches this job (GitHub Actions, rescore.yml) when a profile is saved. It reads no
external source and sends no alerts; it only writes scores for the profiles waiting for them.

    python -m radar.orchestrator.rescore              # every profile waiting for a rescore
    python -m radar.orchestrator.rescore --user <id>  # just this user's profile
"""
import argparse
import sys

from radar import config
from radar.agents.eligibility_agent import EligibilityAgent
from radar.db import client as db
from radar.logging_config import get_logger
from radar.memory import faculty_profile_store
from radar.orchestrator.pipeline import rescore_catalog

logger = get_logger("rescore")


def run_rescore(user_id: str | None = None) -> int:
    """Rescore profiles waiting for it (embedding cleared by a save). Returns how many were rescored."""
    config.validate_required_config()
    lease = db.PipelineLease("radar_rescore", locked_by="rescore")
    if not lease.acquire():
        logger.info("Another rescore is running; it will pick up this profile too.")
        return 0
    try:
        profiles = [
            p for p in faculty_profile_store.get_all_profiles()
            if p.embedding_refreshed and (user_id is None or p.user_id == user_id)
        ]
        if not profiles:
            logger.info("No profile is waiting for a rescore.")
            return 0
        terms = {p.id: faculty_profile_store.get_profile_terms(p.id) for p in profiles}
        errors: list[str] = []
        done = rescore_catalog(profiles, terms, EligibilityAgent(), set(), None, errors)
        for err in errors:
            logger.error(err)
        return done
    finally:
        lease.release()


def main() -> int:
    parser = argparse.ArgumentParser(description="Score the stored catalog for new or edited profiles.")
    parser.add_argument("--user", help="Only this user's profile (auth user id)")
    args = parser.parse_args()
    print(f"Rescored {run_rescore(args.user)} profile(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
