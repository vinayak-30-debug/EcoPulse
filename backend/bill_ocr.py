from __future__ import annotations

import io
import re
from pathlib import Path
from typing import List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, Request

try:
    from PIL import Image, UnidentifiedImageError
except ImportError:  # pragma: no cover
    Image = None
    UnidentifiedImageError = Exception

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None

router = APIRouter(tags=["ocr"])


def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    if PdfReader is None:
        raise HTTPException(
            status_code=500,
            detail="PDF parsing is unavailable. Install pypdf to enable PDF bill extraction.",
        )

    reader = PdfReader(io.BytesIO(pdf_bytes))
    page_text: List[str] = []
    for page in reader.pages:
        page_text.append(page.extract_text() or "")
    return "\n".join(page_text).strip()


def _extract_text_from_image(image_bytes: bytes) -> str:
    if Image is None or pytesseract is None:
        raise HTTPException(
            status_code=500,
            detail="OCR dependencies missing. Install pillow and pytesseract.",
        )

    try:
        image = Image.open(io.BytesIO(image_bytes))
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.") from exc

    try:
        return pytesseract.image_to_string(image).strip()
    except pytesseract.TesseractNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="Tesseract OCR engine not found. Install Tesseract and add it to PATH.",
        ) from exc


def _normalize_ocr_text(text: str) -> str:
    normalized = text.replace("\u00b3", "3").replace("m³", "m3")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\r\n?", "\n", normalized)
    return normalized


def _detect_billing_days(text: str) -> int:
    day_matches = re.findall(r"\b(\d{1,3})\s*(?:days|day)\b", text, flags=re.IGNORECASE)
    candidates = [int(days) for days in day_matches if 10 <= int(days) <= 120]
    if candidates:
        return candidates[0]
    return 30


def _to_float(raw: str) -> float:
    return float(raw.replace(",", "").strip())


def _is_year_like(value: float) -> bool:
    return 1900 <= value <= 2100 and int(value) == value


def _looks_like_currency_context(context: str) -> bool:
    lowered = context.lower()
    return any(
        token in lowered
        for token in ["amount", "charge", "inr", "rs", "rupees", "subtotal", "tax", "gst"]
    )


def _score_context(context: str, bill_type: str) -> int:
    score = 0
    lowered = context.lower()
    keywords = ["consumption", "usage", "used", "total", "current", "bill"]
    if bill_type == "water":
        keywords.extend(["water", "meter", "supply"])
    else:
        keywords.extend(["electricity", "energy", "units"])

    for keyword in keywords:
        if keyword in lowered:
            score += 1
    if _looks_like_currency_context(context):
        score -= 2
    return score


def _electricity_candidates(text: str) -> List[Tuple[float, str, str, int]]:
    candidates: List[Tuple[float, str, str, int]] = []

    unit_pattern = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kwh|units?)", re.IGNORECASE)
    for match in unit_pattern.finditer(text):
        value = _to_float(match.group(1))
        if value <= 0 or _is_year_like(value):
            continue
        snippet = text[max(0, match.start() - 45) : match.end() + 45]
        score = _score_context(snippet, "electricity")
        candidates.append((value, "kWh", snippet, score))

    if not candidates:
        keyword_pattern = re.compile(
            r"(?:consumption|units consumed|energy used|electricity used)\D{0,80}(\d+(?:[.,]\d+)?)",
            re.IGNORECASE,
        )
        for match in keyword_pattern.finditer(text):
            value = _to_float(match.group(1))
            if value <= 0 or _is_year_like(value):
                continue
            snippet = text[max(0, match.start() - 45) : match.end() + 45]
            score = _score_context(snippet, "electricity") + 1
            candidates.append((value, "kWh", snippet, score))

    return candidates


def _normalize_water_unit(value: float, unit: str) -> Tuple[float, str]:
    lowered = unit.lower().replace(" ", "")
    if lowered in {"kl", "kld", "kiloliter", "kiloliters", "kilolitre", "kilolitres"}:
        return value * 1000.0, "liters"
    if lowered in {"m3", "cum", "cubicmeter", "cubicmeters"}:
        return value * 1000.0, "liters"
    return value, "liters"


def _water_plausibility_score(liters_value: float, billing_days: int) -> int:
    daily = liters_value / max(billing_days, 1)
    if 40 <= daily <= 2500:
        return 3
    if 15 <= daily <= 5000:
        return 1
    return -2


def _water_meter_reading_candidates(text: str) -> List[Tuple[float, str, str, int]]:
    candidates: List[Tuple[float, str, str, int]] = []

    previous_matches = re.findall(
        r"(?:previous(?:\s*reading)?|prev(?:ious)?(?:\s*read(?:ing)?)?)\D{0,30}(\d+(?:[.,]\d+)?)",
        text,
        flags=re.IGNORECASE,
    )
    current_matches = re.findall(
        r"(?:current(?:\s*reading)?|present(?:\s*reading)?|latest(?:\s*reading)?)\D{0,30}(\d+(?:[.,]\d+)?)",
        text,
        flags=re.IGNORECASE,
    )

    for prev_raw in previous_matches[:3]:
        for current_raw in current_matches[:3]:
            prev_val = _to_float(prev_raw)
            current_val = _to_float(current_raw)
            if _is_year_like(prev_val) or _is_year_like(current_val):
                continue
            diff = current_val - prev_val
            if diff <= 0 or diff > 600:
                continue

            liters_value = diff * 1000.0
            snippet = f"Previous reading {prev_val} and current reading {current_val}"
            score = 3
            candidates.append((liters_value, "liters", snippet, score))

    return candidates


def _water_candidates(text: str) -> List[Tuple[float, str, str, int]]:
    billing_days = _detect_billing_days(text)
    candidates: List[Tuple[float, str, str, int]] = []

    # Explicit unit matches (kL, m3, liters, etc.).
    unit_pattern = re.compile(
        r"(\d+(?:[.,]\d+)?)\s*(kiloliters?|kilolitres?|kld|kl|m3|cum|cubic\s*meters?|liters?|litres?|l\b)",
        re.IGNORECASE,
    )
    for match in unit_pattern.finditer(text):
        value = _to_float(match.group(1))
        if value <= 0 or _is_year_like(value):
            continue

        normalized_value, normalized_unit = _normalize_water_unit(value, match.group(2))
        snippet = text[max(0, match.start() - 50) : match.end() + 50]
        score = _score_context(snippet, "water")
        score += _water_plausibility_score(normalized_value, billing_days)
        candidates.append((normalized_value, normalized_unit, snippet, score))

    # Consumption keyword with value where OCR loses units.
    keyword_pattern = re.compile(
        r"(?:water\s*(?:consumption|used|usage)?|consumption|units?\s*consumed)\D{0,90}(\d+(?:[.,]\d+)?)",
        re.IGNORECASE,
    )
    for match in keyword_pattern.finditer(text):
        value = _to_float(match.group(1))
        if value <= 0 or _is_year_like(value):
            continue

        snippet = text[max(0, match.start() - 50) : match.end() + 50]
        probable_unit = "liters"
        if re.search(r"\b(kld?|kilolit(?:er|re)s?|m3|cum|cubic)\b", snippet, re.IGNORECASE):
            probable_unit = "kl"

        normalized_value, normalized_unit = _normalize_water_unit(value, probable_unit)
        score = _score_context(snippet, "water") + 1
        score += _water_plausibility_score(normalized_value, billing_days)
        candidates.append((normalized_value, normalized_unit, snippet, score))

    # Meter-reading difference fallback.
    candidates.extend(_water_meter_reading_candidates(text))

    # Line-based fallback for tabular OCR.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if not re.search(r"\b(water|consumption|usage|units|meter)\b", line, re.IGNORECASE):
            continue
        if re.search(r"\b(previous|current|present)\s*reading\b", line, re.IGNORECASE):
            continue

        number_matches = re.findall(r"\d+(?:[.,]\d+)?", line)
        for num_raw in number_matches:
            value = _to_float(num_raw)
            if value <= 0 or _is_year_like(value):
                continue

            probable_unit = "liters"
            if re.search(r"\b(kld?|kilolit(?:er|re)s?|m3|cum|cubic)\b", line, re.IGNORECASE):
                probable_unit = "kl"

            normalized_value, normalized_unit = _normalize_water_unit(value, probable_unit)
            score = _score_context(line, "water")
            score += _water_plausibility_score(normalized_value, billing_days)
            candidates.append((normalized_value, normalized_unit, line, score))

    return candidates


def _pick_best_candidate(
    candidates: List[Tuple[float, str, str, int]],
) -> Optional[Tuple[float, str, str]]:
    if not candidates:
        return None

    # Prefer stronger context score, then plausible medium values over extreme outliers.
    best = sorted(candidates, key=lambda entry: (entry[3], -abs(entry[0] - 18000), entry[0]), reverse=True)[0]
    return best[0], best[1], best[2]


def _extract_value(text: str, bill_type: str) -> Tuple[float, str, str]:
    if bill_type == "electricity":
        candidate = _pick_best_candidate(_electricity_candidates(text))
    else:
        candidate = _pick_best_candidate(_water_candidates(text))

    if not candidate:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Could not detect {bill_type} consumption value from the uploaded bill. "
                "Please upload a clearer bill where consumption and units are visible."
            ),
        )
    return candidate


def _extract_text(file_bytes: bytes, filename: str, content_type: str) -> str:
    suffix = Path(filename.lower()).suffix
    is_pdf = "pdf" in (content_type or "").lower() or suffix == ".pdf"

    if is_pdf:
        text = _extract_text_from_pdf(file_bytes)
    else:
        text = _extract_text_from_image(file_bytes)

    text = _normalize_ocr_text(text)
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="No readable text found in the uploaded bill. Try a clearer image/PDF.",
        )
    return text


@router.post("/extract-bill")
async def extract_bill_values(
    request: Request,
    bill_type: str = Query(..., pattern="^(electricity|water)$"),
):
    filename = request.headers.get("x-filename", "uploaded_bill")
    content_type = request.headers.get("content-type", "application/octet-stream")
    file_bytes = await request.body()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    text = _extract_text(file_bytes, filename, content_type)
    raw_value, raw_unit, snippet = _extract_value(text, bill_type)
    billing_days = _detect_billing_days(text)

    is_already_daily = bool(re.search(r"\b(per day|daily|/day)\b", snippet, re.IGNORECASE))
    daily_value = raw_value if is_already_daily else raw_value / billing_days
    daily_unit = "kWh/day" if bill_type == "electricity" else "liters/day"

    return {
        "bill_type": bill_type,
        "raw_value": round(raw_value, 2),
        "raw_unit": raw_unit,
        "billing_days": billing_days,
        "daily_value": round(daily_value, 2),
        "daily_unit": daily_unit,
        "matched_excerpt": snippet.strip(),
    }
