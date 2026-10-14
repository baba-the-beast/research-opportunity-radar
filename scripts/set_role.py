"""Give a user a role, e.g. make someone their institution's research office.

    python scripts/set_role.py dean.rnd@university.ac.in research_office --institution "COEP Technological University"
    python scripts/set_role.py dean.rnd@university.ac.in faculty      # back to a normal account

Roles: faculty (default), research_office (can set internal deadlines, notes and recommendations
for the institution given with --institution, which they cannot change themselves), operator, admin. The role lives in the user's
app_metadata, which only the service role can change. The user must sign out and in again for a new
role to take effect. Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env.
"""
import argparse
import os
import sys

from dotenv import load_dotenv

from supabase import create_client

ROLES = ("faculty", "research_office", "operator", "admin")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("email")
    parser.add_argument("role", choices=ROLES)
    parser.add_argument("--institution", help="research_office only: the institution it manages, as faculty write it in their profiles")
    args = parser.parse_args()
    if args.role == "research_office" and not (args.institution or "").strip():
        parser.error("research_office needs --institution")

    load_dotenv()
    url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.", file=sys.stderr)
        return 1
    admin = create_client(url, key).auth.admin

    page = 1
    while True:
        users = admin.list_users(page=page, per_page=200)
        if not users:
            print(f"No account with email {args.email}.", file=sys.stderr)
            return 1
        match = next((u for u in users if (u.email or "").lower() == args.email.lower()), None)
        if match:
            break
        page += 1

    metadata = dict(match.app_metadata or {})
    if args.role == "faculty":
        metadata.pop("role", None)
    else:
        metadata["role"] = args.role
    if args.role == "research_office":
        metadata["institution"] = " ".join(args.institution.split())
    else:
        metadata.pop("institution", None)
    admin.update_user_by_id(match.id, {"app_metadata": metadata})
    print(f"{args.email} is now '{args.role}'. They need to sign out and sign in again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
