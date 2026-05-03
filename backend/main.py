from flask import Flask
app = Flask(__name__)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import router as auth_router
from bill_ocr import router as bill_ocr_router
from predict import router as predict_router

app = FastAPI(
    title="Sustainability Scoring API",
    version="1.0.0",
    description="Predicts sustainability score from household usage signals.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(predict_router)
app.include_router(bill_ocr_router)
app.include_router(auth_router)


@app.get("/")
def root():
    return {
        "message": "Sustainability Scoring API is running.",
        "health": "/health",
        "docs": "/docs",
        "predict": "POST /predict",
        "extract_bill": "POST /extract-bill?bill_type=electricity|water",
        "signup_request_code": "POST /auth/signup/request-code",
        "signup_verify_code": "POST /auth/signup/verify-code",
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
