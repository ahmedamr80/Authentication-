#!/bin/bash
# Usage: ./scripts/test-api.sh <API_KEY>

API_KEY=$1

if [ -z "$API_KEY" ]; then
  echo "Usage: ./scripts/test-api.sh <API_KEY>"
  exit 1
fi

echo "Testing /api/list-users with API Key: $API_KEY"
curl -s -H "Authorization: Bearer $API_KEY" "http://localhost:3000/api/list-users?limit=5" | python3 -m json.tool
