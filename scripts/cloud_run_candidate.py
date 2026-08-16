#!/usr/bin/env python3
"""Select the candidate URL for the latest ready Cloud Run revision."""

import json
import sys
from typing import Any
from urllib.parse import urlsplit


def select_candidate_url(service: dict[str, Any]) -> str:
    """Return the verified candidate URL from a Cloud Run service resource."""
    status = service.get("status")
    if not isinstance(status, dict):
        raise ValueError("service status is missing")

    latest_revision = status.get("latestReadyRevisionName")
    if not isinstance(latest_revision, str) or not latest_revision:
        raise ValueError("latest ready revision is missing")

    traffic = status.get("traffic")
    if not isinstance(traffic, list):
        raise ValueError("service traffic is missing")

    candidates = [
        entry
        for entry in traffic
        if isinstance(entry, dict) and entry.get("tag") == "candidate"
    ]
    if len(candidates) != 1:
        raise ValueError(
            f"expected one candidate traffic target, found {len(candidates)}"
        )

    candidate = candidates[0]
    candidate_revision = candidate.get("revisionName")
    if candidate_revision != latest_revision:
        raise ValueError(
            "candidate points to "
            f"{candidate_revision or 'no revision'}, not latest ready revision "
            f"{latest_revision}"
        )

    url = candidate.get("url")
    if not isinstance(url, str):
        raise ValueError("candidate URL is missing")

    parsed_url = urlsplit(url)
    if (
        parsed_url.scheme != "https"
        or not parsed_url.hostname
        or not parsed_url.hostname.startswith("candidate---")
        or parsed_url.path not in ("", "/")
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise ValueError(f"candidate URL has an unexpected format: {url}")

    return url


def main() -> int:
    try:
        service = json.load(sys.stdin)
        if not isinstance(service, dict):
            raise ValueError("service resource must be a JSON object")
        print(select_candidate_url(service))
    except (json.JSONDecodeError, ValueError) as error:
        print(f"Unable to select Cloud Run candidate: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
