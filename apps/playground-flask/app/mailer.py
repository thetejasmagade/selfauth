"""The application's mailer."""

from __future__ import annotations

from .auth.mailer import DevConsoleMailer, Mailer
from .config import Env


def create_mailer(env: Env) -> Mailer:
    """Returns the mailer for `env`. Replace the production branch with your provider (SMTP, SES,
    Resend, Postmark, ...) by returning an object with a `send(message)` method. Until you do, the
    server refuses to start in production rather than silently dropping verification and
    password-reset emails."""
    if env.production:
        raise RuntimeError(
            "no email provider configured: implement create_mailer in app/mailer.py before running in production"
        )
    # Development: prints messages (including one-time links) to the console.
    return DevConsoleMailer(production=False)
