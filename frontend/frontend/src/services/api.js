const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:8000/predict";
const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || API_URL.replace(/\/predict$/i, "");

function formatFastApiDetail(detail) {
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : "field";
        const message = item?.msg || "Invalid value";
        return `${field}: ${message}`;
      })
      .join(" | ");
  }

  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string") {
      return detail.message;
    }
    return JSON.stringify(detail);
  }

  return String(detail);
}

export async function predictSustainability(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let reason = `Request failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data?.detail !== undefined) {
        reason = formatFastApiDetail(data.detail);
      }
    } catch (err) {
      // Leave default message when response body is not JSON.
    }
    throw new Error(reason);
  }
  return response.json();
}

export async function extractBillValue(file, billType) {
  const response = await fetch(
    `${API_BASE_URL}/extract-bill?bill_type=${encodeURIComponent(billType)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": file.name || `${billType}_bill`,
      },
      body: file,
    }
  );

  if (!response.ok) {
    let reason = `Bill extraction failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data?.detail !== undefined) {
        reason = formatFastApiDetail(data.detail);
      }
    } catch (err) {
      // Keep default reason when body parsing fails.
    }
    throw new Error(reason);
  }

  return response.json();
}
