import os
import requests
import sys

def main():
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        print("Error: TAVILY_API_KEY environment variable not set.")
        sys.exit(1)

    print("Testing Tavily Search API...")
    url = "https://api.tavily.com/search"
    headers = {"Content-Type": "application/json"}
    payload = {
        "api_key": api_key,
        "query": "NVIDIA NemoClaw",
        "search_depth": "basic",
        "include_answer": False,
        "max_results": 2
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
        print("Success! Received results:")
        for result in data.get("results", []):
            print(f"- {result.get('title')}: {result.get('url')}")
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to Tavily API: {e}")
        print("\nNote: Are you running within OpenShell? Make sure you have approved 'api.tavily.com:443' in the TUI (openshell term) or configured a network policy.")

if __name__ == "__main__":
    main()
