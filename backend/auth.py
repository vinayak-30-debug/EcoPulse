from __future__ import annotations

import os
import re
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CODE_REGEX = re.compile(r"^\d{6}$")
VERIFICATION_CODE_TTL_SECONDS = 10 * 60
RESEND_COOLDOWN_SECONDS = 45
MAX_VERIFY_ATTEMPTS = 5

PENDING_SIGNUPS: Dict[str, Dict[str, object]] = {}
REGISTERED_USERS: Dict[str, Dict[str, str]] = {}


class SignupCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=320)


class SignupCodeVerifyRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=320)
    code: str = Field(..., min_length=6, max_length=6)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def _validate_email(email: str) -> None:
    if not EMAIL_REGEX.match(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address.")


def _generate_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _display_name_from_email(email: str) -> str:
    user_part = email.split("@")[0] or "ecopulse user"
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), re.sub(r"[._-]+", " ", user_part))


def _send_verification_email(recipient: str, code: str) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM")
    smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes"}

    message = EmailMessage()
    message["Subject"] = "EcoPulse verification code"
    message["From"] = smtp_from
    message["To"] = recipient
    message.set_content(
        (
            "Your EcoPulse signup verification code is "
            f"{code}. It expires in {VERIFICATION_CODE_TTL_SECONDS // 60} minutes."
        )
    )

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.ehlo()
            if smtp_use_tls:
                server.starttls()
                server.ehlo()
            if smtp_username and smtp_password:
                server.login(smtp_username, smtp_password)
            server.send_message(message)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not send verification email. Please try again shortly.",
        ) from exc


@router.post("/signup/request-code")
def request_signup_code(payload: SignupCodeRequest):
    email = _normalize_email(payload.email)
    _validate_email(email)

    if email in REGISTERED_USERS:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    now = _utc_now()
    pending = PENDING_SIGNUPS.get(email)
    if pending:
        resend_at = pending["last_sent_at"] + timedelta(seconds=RESEND_COOLDOWN_SECONDS)
        if now < resend_at:
            retry_after = int((resend_at - now).total_seconds())
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {retry_after} seconds before requesting another code.",
            )

    code = _generate_verification_code()
    expires_at = now + timedelta(seconds=VERIFICATION_CODE_TTL_SECONDS)

    smtp_host = os.getenv("SMTP_HOST")
    smtp_from = os.getenv("SMTP_FROM")
    email_service_ready = bool(smtp_host and smtp_from)
    dev_mode_enabled = (
        os.getenv("SIGNUP_DEV_MODE", "true").strip().lower() in {"1", "true", "yes"}
    )

    if email_service_ready:
        _send_verification_email(email, code)
    elif not dev_mode_enabled:
        raise HTTPException(
            status_code=503,
            detail=(
                "Email service is not configured. Set SMTP_HOST and SMTP_FROM "
                "to enable signup verification emails."
            ),
        )

    PENDING_SIGNUPS[email] = {
        "code": code,
        "expires_at": expires_at,
        "last_sent_at": now,
        "attempts": 0,
    }

    response = {
        "email": email,
        "expires_in_seconds": VERIFICATION_CODE_TTL_SECONDS,
    }

    if email_service_ready:
        response["message"] = "Verification code sent to your email."
    else:
        response["message"] = (
            "Email service is not configured. Local dev mode is enabled, "
            "so use the verification code below."
        )
        response["verification_code"] = code

    return response


@router.post("/signup/verify-code")
def verify_signup_code(payload: SignupCodeVerifyRequest):
    email = _normalize_email(payload.email)
    code = str(payload.code or "").strip()

    _validate_email(email)
    if not CODE_REGEX.match(code):
        raise HTTPException(status_code=422, detail="Please enter the 6-digit confirmation code.")

    pending = PENDING_SIGNUPS.get(email)
    if not pending:
        raise HTTPException(status_code=404, detail="No active signup request for this email.")

    now = _utc_now()
    expires_at = pending["expires_at"]
    if isinstance(expires_at, datetime) and now > expires_at:
        PENDING_SIGNUPS.pop(email, None)
        raise HTTPException(status_code=400, detail="Verification code has expired.")

    stored_code = str(pending["code"])
    attempts = int(pending["attempts"])
    if code != stored_code:
        attempts += 1
        pending["attempts"] = attempts
        if attempts >= MAX_VERIFY_ATTEMPTS:
            PENDING_SIGNUPS.pop(email, None)
            raise HTTPException(
                status_code=400,
                detail="Too many failed attempts. Request a new verification code.",
            )
        remaining = MAX_VERIFY_ATTEMPTS - attempts
        raise HTTPException(
            status_code=400,
            detail=f"Invalid confirmation code. {remaining} attempt(s) remaining.",
        )

    PENDING_SIGNUPS.pop(email, None)
    name = _display_name_from_email(email)
    REGISTERED_USERS[email] = {
        "email": email,
        "name": name,
        "verified_at": now.isoformat(),
    }

    return {
        "message": "Signup verified successfully.",
        "token": f"signup-{secrets.token_urlsafe(24)}",
        "email": email,
        "name": name,
    }
