import pytest

from radar import config
from radar.db import client as db


def test_validate_required_config_missing_raises(monkeypatch):
    monkeypatch.delenv('ALLOW_IN_MEMORY_DB', raising=False)
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.delenv('SUPABASE_SERVICE_ROLE_KEY', raising=False)
    monkeypatch.delenv('OPENALEX_API_KEY', raising=False)

    with pytest.raises(config.ConfigurationError) as exc_info:
        config.validate_required_config()

    err = str(exc_info.value)
    assert 'SUPABASE_URL' in err
    assert 'SUPABASE_SERVICE_ROLE_KEY' in err
    assert 'OPENALEX_API_KEY' in err
    assert 'CRITICAL CONFIGURATION ERROR' in err

def test_validate_required_config_with_allow_in_memory(monkeypatch):
    monkeypatch.setenv('ALLOW_IN_MEMORY_DB', '1')
    monkeypatch.setenv('OPENALEX_API_KEY', 'valid_test_key')
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.delenv('SUPABASE_SERVICE_ROLE_KEY', raising=False)

    # Should not raise because ALLOW_IN_MEMORY_DB relaxes Supabase requirement
    config.validate_required_config()

def test_db_client_fails_loudly_without_credentials_or_in_memory_flag(monkeypatch):
    monkeypatch.delenv('ALLOW_IN_MEMORY_DB', raising=False)
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.delenv('SUPABASE_SERVICE_ROLE_KEY', raising=False)
    config.ALLOW_IN_MEMORY_DB = False
    config.SUPABASE_URL = ''
    config.SUPABASE_SERVICE_ROLE_KEY = ''

    with pytest.raises(config.ConfigurationError) as exc_info:
        db.get_client()

    assert 'Supabase credentials missing' in str(exc_info.value)
