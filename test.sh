#!/bin/bash
# APIの自動テスト。サーバーを起動し、curlでエンドポイントを叩いて期待値と比較する。
# 新しいエンドポイントを追加したら、この下に assert_eq を増やしていく。
set -u

BASE_URL="http://localhost:3001"
PASS=0
FAIL=0

lsof -ti:3001 | xargs -r kill -9 2>/dev/null
sleep 0.5

node index.js > /tmp/${PWD##*/}_test_server.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT

sleep 1

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" == "$actual" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected: $expected, actual: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# --- GET / ---
res=$(curl -s -w "\n%{http_code}" "$BASE_URL/")
status=$(echo "$res" | tail -n 1)
body=$(echo "$res" | sed '$d')
assert_eq "GET / status" "200" "$status"
assert_eq "GET / body" '{"message":"Hello from Express!"}' "$(echo "$body" | jq -c .)"

# --- 存在しないルート ---
res=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/not-found")
assert_eq "GET /not-found status" "404" "$res"

echo ""
echo "結果: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
