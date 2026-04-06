#!/usr/bin/env python3
"""Small Tavily smoke test intended to run inside the NemoClaw sandbox."""

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        print("TAVILY_API_KEY is not set in this sandbox.", file=sys.stderr)
        print("Export it first or recreate the sandbox after setting it on the host.", file=sys.stderr)
        return 1

    query = "What is NemoClaw?"
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:]).strip() or query

    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "max_results": 3,
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "https://api.tavily.com/search",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}: {detail}", file=sys.stderr)
        return 2
    except Exception as exc:  # pragma: no cover - smoke test helper
        print(f"Request failed: {exc}", file=sys.stderr)
        return 3

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        print(raw)
        return 0

    print(json.dumps(parsed, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
