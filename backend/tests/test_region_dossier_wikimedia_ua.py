"""Issues #218 / #219 (tg12): outbound Wikipedia + Wikidata calls must
identify ShadowBroker via the Wikimedia-recommended User-Agent /
Api-User-Agent headers.

Before this fix, ``backend/services/region_dossier.py`` called
``fetch_with_curl(url)`` with no explicit headers, falling back to the
generic project default UA. That sent a too-anonymous identifier to
Wikimedia. Per Wikimedia's policy
(https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)
the API caller should send a stable, contactable identifier so Wikimedia
operators can rate-limit or reach the project.

This test does NOT make network calls. It patches ``fetch_with_curl``
and asserts the headers that get passed through.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _fake_resp(payload: dict, status: int = 200) -> MagicMock:
    r = MagicMock()
    r.status_code = status
    r.json.return_value = payload
    return r


def test_wikidata_call_passes_wikimedia_request_headers():
    from services import region_dossier

    calls = []

    def fake_fetch(url, **kwargs):
        calls.append(kwargs.get("headers"))
        return _fake_resp({"results": {"bindings": []}})

    with patch.object(region_dossier, "fetch_with_curl", side_effect=fake_fetch):
        region_dossier._fetch_wikidata_leader("Testlandia")

    assert calls, "fetch_with_curl was not called"
    headers = calls[0] or {}
    assert "User-Agent" in headers
    assert "Api-User-Agent" in headers
    # Stable identifier should mention the project + a contact path.
    assert "Shadowbroker" in headers["Api-User-Agent"] or "ShadowBroker" in headers["Api-User-Agent"]
    assert "github.com" in headers["Api-User-Agent"].lower()


def test_wikipedia_summary_call_passes_wikimedia_request_headers():
    from services import region_dossier

    calls = []

    def fake_fetch(url, **kwargs):
        calls.append((url, kwargs.get("headers")))
        return _fake_resp(
            {
                "type": "standard",
                "description": "test desc",
                "extract": "test extract",
                "thumbnail": {"source": ""},
            }
        )

    with patch.object(region_dossier, "fetch_with_curl", side_effect=fake_fetch):
        region_dossier._fetch_local_wiki_summary("Paris", "France")

    # At least one Wikipedia REST call was issued.
    wikipedia_calls = [c for c in calls if "wikipedia.org" in c[0]]
    assert wikipedia_calls, "no Wikipedia call was issued"
    for url, headers in wikipedia_calls:
        headers = headers or {}
        assert "User-Agent" in headers, f"missing User-Agent on {url}"
        assert "Api-User-Agent" in headers, f"missing Api-User-Agent on {url}"
        assert "github.com" in headers["Api-User-Agent"].lower()


def test_wikimedia_headers_constant_is_stable():
    """Regression guard: if someone removes the contact path from the
    Api-User-Agent we want a loud test failure, not a silent ToS drift.
    """
    from services.region_dossier import _WIKIMEDIA_REQUEST_HEADERS

    aua = _WIKIMEDIA_REQUEST_HEADERS.get("Api-User-Agent", "")
    assert "Shadowbroker" in aua or "ShadowBroker" in aua
    assert "github.com" in aua.lower()
    # Must include a path Wikimedia operators can use to contact us
    # (we use /issues against the public repo).
    assert "issues" in aua.lower()
