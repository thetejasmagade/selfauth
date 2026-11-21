"""Email delivery is an application concern: implement a mailer with your provider
(SMTP, Amazon SES, Resend, ...). See app/mailer.py in your project."""

from __future__ import annotations

import sys
import threading
from dataclasses import dataclass
from typing import Protocol

VERIFICATION = "verification"
PASSWORD_RESET = "passwordReset"
ACCOUNT_EXISTS = "accountExists"
PASSWORD_CHANGED = "passwordChanged"
PASSWORD_RESET_COMPLETED = "passwordResetCompleted"


@dataclass
class EmailMessage:
    kind: str
    to: str
    subject: str
    text: str
    link: str = ""  # set for messages that carry a link
    token: str = ""  # the raw one-time token, for test mailers only. Never log it.


class Mailer(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class MemoryMailer:
    """Keeps messages in memory, for tests and the conformance harness."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.sent: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        with self._lock:
            self.sent.append(message)

    def last_to(self, address: str) -> EmailMessage | None:
        """The latest message to `address` (case-insensitive), if any."""
        target = address.strip().lower()
        with self._lock:
            for message in reversed(self.sent):
                if message.to.strip().lower() == target:
                    return message
        return None


class DevConsoleMailer:
    """Prints messages (with their one-time links) so links can be clicked locally. It refuses to
    run in production because one-time links must never reach production logs (SEC-LOG-001)."""

    def __init__(self, production: bool = False) -> None:
        if production:
            raise RuntimeError("DevConsoleMailer must not be used in production; configure a real Mailer")

    def send(self, message: EmailMessage) -> None:
        sys.stdout.write(f"\n[dev mail] to={message.to} kind={message.kind}\n{message.subject}\n{message.text}\n")
        sys.stdout.flush()
