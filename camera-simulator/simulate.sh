#!/usr/bin/env bash
# Simulates the IoT camera: sends a license plate to the API (HTTP POST).
# Usage: ./simulate.sh [PLATE] [API_URL]
PLATE="${1:-$(printf '%03d-%02d-%03d' $((RANDOM%1000)) $((RANDOM%100)) $((RANDOM%1000)))}"
API="${2:-http://localhost:3000}"

echo "Camera detected plate: $PLATE"
curl -s -X POST "$API/api/plates" \
  -H "Content-Type: application/json" \
  -d "{\"plate\":\"$PLATE\"}"
echo
