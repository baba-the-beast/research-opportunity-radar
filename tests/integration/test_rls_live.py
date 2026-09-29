"""Row Level Security checked against real Postgres, not a re-implementation of the policies.

Runs only against a disposable Supabase stack:

    supabase start            # applies supabase/migrations/
    export RLS_TEST_SUPABASE_URL=http://127.0.0.1:54321
    export RLS_TEST_ANON_KEY=...          # from `supabase status`
    export RLS_TEST_SERVICE_ROLE_KEY=...
    pytest tests/integration/test_rls_live.py

It creates and deletes real auth users, so it refuses non-local URLs unless
RLS_TEST_ALLOW_REMOTE=1 is also set.
"""
import os
import uuid

import pytest

URL = os.getenv("RLS_TEST_SUPABASE_URL", "")
ANON = os.getenv("RLS_TEST_ANON_KEY", "")
SERVICE = os.getenv("RLS_TEST_SERVICE_ROLE_KEY", "")

pytestmark = pytest.mark.skipif(
    not (URL and ANON and SERVICE),
    reason="set RLS_TEST_SUPABASE_URL / RLS_TEST_ANON_KEY / RLS_TEST_SERVICE_ROLE_KEY (local stack)",
)

PASSWORD = "rls-test-" + uuid.uuid4().hex


@pytest.fixture(scope="module")
def stack():
    from supabase import create_client

    if not any(h in URL for h in ("127.0.0.1", "localhost")) and os.getenv("RLS_TEST_ALLOW_REMOTE") != "1":
        pytest.skip("refusing to create/delete auth users on a non-local Supabase")

    admin = create_client(URL, SERVICE)
    users, clients = {}, {}
    for name in ("a", "b"):
        email = f"rls-{name}-{uuid.uuid4().hex[:8]}@example.test"
        created = admin.auth.admin.create_user({"email": email, "password": PASSWORD, "email_confirm": True})
        users[name] = created.user.id
        client = create_client(URL, ANON)
        client.auth.sign_in_with_password({"email": email, "password": PASSWORD})
        clients[name] = client

    profiles = {}
    for name, uid in users.items():
        row = admin.table("faculty_profile").insert({
            "full_name": f"Dr. {name.upper()}", "institution": "Test U",
            "profile_text": "t", "user_id": uid,
        }).execute().data[0]
        profiles[name] = row["id"]
    legacy = admin.table("faculty_profile").insert({
        "full_name": "Seed", "institution": "Test U", "profile_text": "t", "user_id": None,
    }).execute().data[0]["id"]

    yield {"admin": admin, "users": users, "clients": clients, "profiles": profiles, "legacy": legacy}

    admin.table("faculty_profile").delete().eq("id", legacy).execute()
    for uid in users.values():
        admin.auth.admin.delete_user(uid)  # cascades to profiles, prefs, chat, state


def _profile_ids(client) -> set[str]:
    return {r["id"] for r in client.table("faculty_profile").select("id").execute().data}


def test_faculty_profile_owner_only(stack):
    seen_by_a = _profile_ids(stack["clients"]["a"])
    assert stack["profiles"]["a"] in seen_by_a
    assert stack["profiles"]["b"] not in seen_by_a
    assert stack["legacy"] not in seen_by_a  # the unassigned seed profile is not shared


def test_scoring_log_owner_only(stack):
    admin = stack["admin"]
    opp = admin.table("opportunities").insert({
        "kind": "journal", "title": "RLS probe", "fingerprint": "rls-" + uuid.uuid4().hex,
    }).execute().data[0]["id"]
    try:
        for name in ("a", "b"):
            admin.table("scoring_log").insert({
                "opportunity_id": opp, "faculty_id": stack["profiles"][name],
                "final_score": 50, "band": "watch", "components": {},
            }).execute()
        rows = stack["clients"]["a"].table("scoring_log").select("faculty_id").eq("opportunity_id", opp).execute().data
        assert {r["faculty_id"] for r in rows} == {stack["profiles"]["a"]}
    finally:
        admin.table("opportunities").delete().eq("id", opp).execute()


def test_cannot_write_into_another_users_chat_session(stack):
    from postgrest.exceptions import APIError

    a, b = stack["clients"]["a"], stack["clients"]["b"]
    session = a.table("chat_sessions").insert({"user_id": stack["users"]["a"]}).execute().data[0]["id"]
    with pytest.raises(APIError):
        b.table("chat_messages").insert({
            "session_id": session, "user_id": stack["users"]["b"], "role": "user", "content": "injected",
        }).execute()


def test_user_state_isolated(stack):
    a, b = stack["clients"]["a"], stack["clients"]["b"]
    a.table("user_preferences").upsert({"user_id": stack["users"]["a"], "min_score": 77}).execute()
    assert b.table("user_preferences").select("*").eq("user_id", stack["users"]["a"]).execute().data == []


def test_alerts_sent_not_exposed_to_clients(stack):
    from supabase import create_client

    anon = create_client(URL, ANON)
    assert anon.table("alerts_sent").select("id").execute().data == []
    assert stack["clients"]["a"].table("alerts_sent").select("id").execute().data == []
