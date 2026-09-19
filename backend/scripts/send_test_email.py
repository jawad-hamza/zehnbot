"""
Check the mail settings (SMTP_* in .env) by sending one real message. Shows the actual error if it fails.

  docker compose exec backend python scripts/send_test_email.py you@example.com
"""
import sys
from email.message import EmailMessage

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services.email_service import _deliver  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        sys.exit("Usage: python scripts/send_test_email.py you@example.com")
    if not settings.email_enabled:
        sys.exit("Email is not configured: set SMTP_HOST and SMTP_FROM (and usually SMTP_USERNAME / SMTP_PASSWORD) in .env, "
                 "then run: docker compose up -d backend")
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = settings.SMTP_FROM, sys.argv[1], "ZehnBot mail settings work"
    message.set_content("If you are reading this, ZehnBot can send email. New sign-ups will now have to confirm their address.")
    print(f"Sending through {settings.SMTP_HOST}:{settings.SMTP_PORT} ({settings.SMTP_SECURITY}) as {settings.SMTP_USERNAME or 'no login'} ...")
    try:
        _deliver(message)
    except Exception as exc:
        sys.exit(f"FAILED: {type(exc).__name__}: {exc}")
    print(f"Sent. Check the inbox (and the spam folder) of {sys.argv[1]}.")


if __name__ == "__main__":
    main()
