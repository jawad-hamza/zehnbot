"""Outgoing email over plain SMTP, so any provider works (Gmail app password, Brevo, Resend, SES, Postmark...).
Nothing is sent, and nothing depends on email, until SMTP_HOST and SMTP_FROM are configured."""
import html
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from app.config import settings

logger = logging.getLogger("app.email")


def _deliver(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    mode = settings.SMTP_SECURITY.strip().lower()
    if mode == "ssl":
        smtp = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15, context=context)
    else:
        smtp = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15)
    with smtp:
        if mode == "starttls":
            smtp.starttls(context=context)
        elif mode not in ("ssl", "none"):
            raise ValueError(f"SMTP_SECURITY must be starttls, ssl or none (got {mode!r})")
        if settings.SMTP_USERNAME:
            if mode == "none":
                raise ValueError("Refusing to send a mail password over an unencrypted connection (SMTP_SECURITY=none).")
            smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(message)


def send_email(to: str, subject: str, text: str, html_body: str, reply_to: str = "") -> bool:
    """Runs as a background task: a slow or failing mail server must never fail the request."""
    if not settings.email_enabled:
        return False
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    if reply_to:
        message["Reply-To"] = reply_to
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid()
    message.set_content(text)
    message.add_alternative(html_body, subtype="html")
    try:
        _deliver(message)
        return True
    except Exception:
        logger.exception("Could not send email to %s", to)
        return False


def send_verification_email(to: str, link: str) -> bool:
    safe_link = html.escape(link, quote=True)
    text = (
        "Welcome to ZehnBot.\n\n"
        "Confirm your email address to finish creating your workspace:\n"
        f"{link}\n\n"
        "The link works for 24 hours. If you did not sign up, you can ignore this message."
    )
    body = f"""<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f2f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#13101f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #dde1e7">
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#021b8c">ZehnBot</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#13101f">Confirm your email address</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4f5164">One click and your workspace is ready. The link works for 24 hours.</p>
<p style="margin:0 0 24px"><a href="{safe_link}" style="display:inline-block;background:#021b8c;color:#f2f4f5;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px">Confirm my email</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5f6175">If the button does not work, paste this into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all"><a href="{safe_link}" style="color:#021b8c">{safe_link}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#5f6175">If you did not sign up for ZehnBot, you can ignore this message.</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#5f6175">ZehnBot by Zehnox</p>
</td></tr></table></body></html>"""
    return send_email(to, "Confirm your email for ZehnBot", text, body)


def send_password_reset_email(to: str, link: str, minutes: int) -> bool:
    safe_link = html.escape(link, quote=True)
    text = (
        "Someone asked to reset the password for your ZehnBot login.\n\n"
        f"Choose a new password here (the link works for {minutes} minutes, once):\n"
        f"{link}\n\n"
        "If that was not you, ignore this message: your password stays as it is."
    )
    body = f"""<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f2f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#13101f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #dde1e7">
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#021b8c">ZehnBot</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#13101f">Choose a new password</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4f5164">The link works for {minutes} minutes and can be used once.</p>
<p style="margin:0 0 24px"><a href="{safe_link}" style="display:inline-block;background:#021b8c;color:#f2f4f5;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px">Set a new password</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5f6175">If the button does not work, paste this into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all"><a href="{safe_link}" style="color:#021b8c">{safe_link}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#5f6175">If you did not ask for this, ignore this message: your password stays as it is.</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#5f6175">ZehnBot by Zehnox</p>
</td></tr></table></body></html>"""
    return send_email(to, "Reset your ZehnBot password", text, body)


def send_enquiry_reply(to: str, subject: str, message: str, reply_to: str = "") -> bool:
    """The operator answering someone who asked to be contacted. Their words, in the ZehnBot wrapper."""
    safe_message = html.escape(message)
    body = f"""<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f2f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#13101f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #dde1e7">
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#021b8c">ZehnBot</p>
<div style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#13101f;white-space:pre-wrap">{safe_message}</div>
<p style="margin:0;font-size:13px;line-height:1.6;color:#5f6175">Reply to this email and it reaches us directly.</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#5f6175">ZehnBot by Zehnox</p>
</td></tr></table></body></html>"""
    return send_email(to, subject, message, body, reply_to=reply_to)
