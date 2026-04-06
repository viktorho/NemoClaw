#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

node ../../node_modules/tsx/dist/cli.mjs backend/src/server.ts &
PID=$!
trap 'kill $PID' EXIT

python3 -m webbrowser "http://127.0.0.1:${AI_ASSISTANT_PORT:-4317}"
wait $PID
