"""Per-faculty alert routing.

Resolves where a faculty member's alerts go from their `user_preferences` row and auth email.
The legacy seed profile (no user_id) keeps the operator-wide TELEGRAM_CHAT_ID / BREVO_RECIPIENT_EMAIL.
"""
from dataclasses import dataclass

from radar import config
from radar.db import client as db
from radar.logging_config import get_logger
from radar.models import FacultyProfile
from radar.notify import email_brevo, telegram

logger = get_logger(__name__)

# Mirrors DEFAULT_SETTINGS in web/app/api/settings/route.ts
_DEFAULT_PREFS = {
    "min_score": 50,
    "email_alerts": True,
    "telegram_alerts": False,
    "telegram_chat_id": None,
    "digest_frequency": "weekly",
}


@dataclass
class AlertTarget:
    faculty_id: str
    user_id: str | None = None  # None for the legacy seed profile (operator-wide channels)
    telegram_chat_id: str | None = None
    email: str | None = None
    min_score: int = 0
    digest_enabled: bool = True

    @property
    def enabled_channels(self) -> int:
        """Delivery channels that will actually be attempted by dispatch()."""
        return int(bool(self.telegram_chat_id and config.TELEGRAM_BOT_TOKEN)) + int(bool(self.email and config.BREVO_API_KEY))

    @property
    def channel(self) -> str:
        if self.telegram_chat_id and config.TELEGRAM_BOT_TOKEN:
            return "telegram"
        if self.email and config.BREVO_API_KEY:
            return "email"
        return "dashboard"


def _load_preferences(user_id: str) -> dict:
    client = db.get_client()
    res = client.table("user_preferences").select("*").eq("user_id", user_id).execute()
    return {**_DEFAULT_PREFS, **(res.data[0] if res.data else {})}


def _load_user_email(user_id: str) -> str | None:
    client = db.get_client()
    auth = getattr(client, "auth", None)
    if auth is None:  # in-memory client
        return None
    res = auth.admin.get_user_by_id(user_id)
    return getattr(getattr(res, "user", None), "email", None)


def _as_score(value) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return _DEFAULT_PREFS["min_score"]


def resolve_target(profile: FacultyProfile) -> AlertTarget:
    if not profile.user_id:
        return AlertTarget(
            faculty_id=profile.id or "",
            telegram_chat_id=config.TELEGRAM_CHAT_ID or None,
            email=config.BREVO_RECIPIENT_EMAIL or None,
        )

    prefs = _load_preferences(profile.user_id)
    email = None
    if prefs["email_alerts"]:
        try:
            email = _load_user_email(profile.user_id)
        except Exception as e:
            logger.error(f"Could not resolve email for user {profile.user_id}: {e}", error_category="alert_error")

    return AlertTarget(
        faculty_id=profile.id or "",
        user_id=profile.user_id,
        telegram_chat_id=prefs["telegram_chat_id"] if prefs["telegram_alerts"] else None,
        email=email,
        min_score=_as_score(prefs.get("min_score")),
        digest_enabled=prefs["digest_frequency"] != "never",
    )


def dispatch(target: AlertTarget, subject: str, text: str) -> list[str]:
    """Send on every channel the target has enabled. Returns error strings; never raises."""
    errors: list[str] = []
    if target.telegram_chat_id and config.TELEGRAM_BOT_TOKEN:
        try:
            telegram.send(text, chat_id=target.telegram_chat_id)
        except telegram.TelegramBlocked as e:
            _disconnect_blocked_chat(target)
            logger.error(f"Telegram chat blocked, alerts disabled: {e}", source_name="telegram", error_category="alert_error")
            errors.append(f"Telegram alert error: {e}; Telegram alerts disabled for this user")
        except Exception as e:
            logger.error(f"Telegram alert failed: {e}", source_name="telegram", error_category="alert_error")
            errors.append(f"Telegram alert error: {e}")
    if target.email and config.BREVO_API_KEY:
        try:
            email_brevo.send(subject, text, recipient=target.email)
        except Exception as e:
            logger.error(f"Brevo email failed: {e}", source_name="brevo", error_category="alert_error")
            errors.append(f"Brevo email error: {e}")
    return errors


def _disconnect_blocked_chat(target: AlertTarget) -> None:
    """The user blocked the bot or deleted the chat: stop retrying it on every run. They can
    reconnect from Settings -> Connect Telegram."""
    target.telegram_chat_id = None
    if not target.user_id:
        logger.error("Operator TELEGRAM_CHAT_ID is unreachable (bot blocked or chat deleted)",
                     source_name="telegram", error_category="alert_error")
        return
    try:
        db.get_client().table("user_preferences").update(
            {"telegram_alerts": False, "telegram_chat_id": None}
        ).eq("user_id", target.user_id).execute()
    except Exception as e:
        logger.error(f"Could not disable Telegram for user {target.user_id}: {e}",
                     source_name="telegram", error_category="alert_error")
