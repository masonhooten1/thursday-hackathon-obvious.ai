"""CORS behavior for the hosted demo: browser clients from another origin.

The demo serves web + API from separate hosted origins; these cases pin the
allow-list (opt-in via configure_cors) and its absence by default.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app, configure_cors


def _client_with_cors(origins: list[str]) -> TestClient:
    application = FastAPI()

    @application.post("/api/identify")
    def identify() -> dict:
        return {}

    configure_cors(application, origins)
    return TestClient(application)


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/api/identify",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )


def test_preflight_from_listed_origin_is_allowed():
    response = _preflight(_client_with_cors(["https://demo.example"]), "https://demo.example")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://demo.example"


def test_preflight_from_unlisted_origin_has_no_allow_header():
    response = _preflight(_client_with_cors(["https://demo.example"]), "https://other.example")
    assert response.headers.get("access-control-allow-origin") is None


def test_default_app_has_no_cors_middleware():
    response = _preflight(TestClient(app), "https://demo.example")
    assert response.headers.get("access-control-allow-origin") is None
