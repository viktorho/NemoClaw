import os
import requests
import sys

def main():
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        print("Error: NVIDIA_API_KEY environment variable not set.")
        sys.exit(1)

    print("Testing NVIDIA Chat API...")
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = {
        "model": "meta/llama-3.1-8b-instruct",
        "messages": [{"role": "user", "content": "Hello, briefly explain NemoClaw architecture"}],
        "max_tokens": 100
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
        print("Success! Received response:")
        print(data['choices'][0]['message']['content'])
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to NVIDIA API: {e}")
        print("\nNote: Make sure 'integrate.api.nvidia.com:443' is approved in the OpenShell TUI (openshell term) or listed in your network policy preset.")

if __name__ == "__main__":
    main()
