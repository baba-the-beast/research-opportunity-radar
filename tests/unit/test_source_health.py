"""Source health: a source that quietly starts returning nothing is flagged."""
import pytest

from radar import config
from radar.db import client as db
from radar.monitoring.source_health import SourceStat, alert_text, find_issues


@pytest.fixture(autouse=True)
def in_memory_db(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


def test_sudden_zero_after_regular_results_is_flagged():
    issues = find_issues([SourceStat("DST", 0, 0)], {"DST": [6, 5, 7]})
    assert [(i.source_name, i.kind) for i in issues] == [("DST", "suddenly_empty")]
    assert "up to 7" in issues[0].message


def test_a_source_that_is_often_empty_is_not_flagged():
    assert find_issues([SourceStat("ICSSR", 0, 0)], {"ICSSR": [0, 1, 0]}) == []


def test_no_history_never_alarms():
    assert find_issues([SourceStat("MeitY", 0, 0)], {}) == []


def test_errors_are_reported():
    issues = find_issues([SourceStat("ICMR", 0, 0, error="HTTP 503")], {"ICMR": [10, 11, 12]})
    assert [(i.source_name, i.kind) for i in issues] == [("ICMR", "error")]
    assert "HTTP 503" in alert_text(issues)


def test_history_round_trip_ignores_failed_runs():
    db.record_source_health(None, [SourceStat("DBT", 14, 2)])
    db.record_source_health(None, [SourceStat("DBT", 0, 0, error="timeout")])
    db.record_source_health(None, [SourceStat("DBT", 12, 1)])
    assert sorted(db.load_source_history(["DBT"])["DBT"]) == [12, 14]
