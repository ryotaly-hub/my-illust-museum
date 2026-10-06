#!/bin/bash
# APIの自動テスト。サーバーを起動し、curlでエンドポイントを叩いて期待値と比較する。
# 新しいエンドポイントを追加したら、この下に assert_eq を増やしていく。
set -u

BASE_URL="http://localhost:3001"
PASS=0
FAIL=0

lsof -ti:3001 | xargs -r kill -9 2>/dev/null
sleep 0.5

# 本物の data/ と assets/works/ を書き換えないよう、一時フォルダのコピーでサーバーを動かす
TMP_DIR=$(mktemp -d)
mkdir -p "$TMP_DIR/data" "$TMP_DIR/uploads"
# テスト用のサンプル作品（data/works.json は個人のデータなので git 管理外。CI でも動くようにサンプルを使う）
SAMPLE=data/works.sample.json
cp "$SAMPLE" "$TMP_DIR/data/works.json"

MUSEUM_DATA_DIR="$TMP_DIR/data" MUSEUM_UPLOAD_DIR="$TMP_DIR/uploads" \
  node index.js > /tmp/${PWD##*/}_test_server.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  rm -rf "$TMP_DIR"
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

# --- GET / （美術館の画面） ---
res=$(curl -s -w "\n%{http_code}" "$BASE_URL/")
status=$(echo "$res" | tail -n 1)
body=$(echo "$res" | sed '$d')
assert_eq "GET / status" "200" "$status"
assert_eq "GET / title" "1" "$(echo "$body" | grep -c "<title>Michan's Museum</title>")"

# --- 画面のスクリプトとスタイル ---
assert_eq "GET /app.js status" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/app.js")"
assert_eq "GET /opening.js status" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/opening.js")"
assert_eq "GET /admin.js status" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/admin.js")"
assert_eq "GET /style.css status" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/style.css")"

# --- GET /api/works （作品一覧・新しい順） ---
res=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/works")
status=$(echo "$res" | tail -n 1)
body=$(echo "$res" | sed '$d')
assert_eq "GET /api/works status" "200" "$status"
assert_eq "GET /api/works count" "$(jq 'length' $SAMPLE)" "$(echo "$body" | jq '.works | length')"
assert_eq "GET /api/works file order" "$(jq -c 'map(.id)' $SAMPLE)" "$(echo "$body" | jq -c '.works | map(.id)')"

# --- POST /api/login （初期パスワードは 0000） ---
post() { curl -s -w "\n%{http_code}" -X "$1" -H "Content-Type: application/json" ${3:+-H "Authorization: Bearer $3"} -d "${4:-}" "$BASE_URL$2"; }
code() { echo "$1" | tail -n 1; }
json() { echo "$1" | sed '$d'; }

res=$(post POST /api/login "" '{"password":"1234"}')
assert_eq "POST /api/login wrong password" "401" "$(code "$res")"
res=$(post POST /api/login "" '{"password":"0000"}')
assert_eq "POST /api/login status" "200" "$(code "$res")"
TOKEN=$(json "$res" | jq -r '.token')

# --- POST /api/works （作品の登録） ---
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
NEW_WORK='{"title":"テスト作品","description":"説明","date":"2099-01-01T12:00","image":"data:image/png;base64,'"$PNG"'","width":100,"height":100}'
res=$(post POST /api/works "" "$NEW_WORK")
assert_eq "POST /api/works without login" "401" "$(code "$res")"
res=$(post POST /api/works "$TOKEN" '{"title":"","date":"2099-01-01"}')
assert_eq "POST /api/works invalid" "400" "$(code "$res")"
res=$(post POST /api/works "$TOKEN" "$NEW_WORK")
assert_eq "POST /api/works status" "201" "$(code "$res")"
NEW_ID=$(json "$res" | jq -r '.work.id')
assert_eq "POST /api/works square -> landscape frame" "landscape" "$(json "$res" | jq -r '.work.frame | split("-")[0]')"
IMAGE_URL=$(json "$res" | jq -r '.work.image')
assert_eq "GET uploaded image status" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$IMAGE_URL")"
res=$(curl -s "$BASE_URL/api/works")
assert_eq "GET /api/works newest first" "$NEW_ID" "$(echo "$res" | jq -r '.works[0].id')"

# --- PATCH /api/works/:id （編集） ---
EDIT='{"title":"編集後","description":"新しい説明","date":"2099-01-02T08:00"}'
res=$(post PATCH "/api/works/$NEW_ID" "" "$EDIT")
assert_eq "PATCH /api/works/:id without login" "401" "$(code "$res")"
res=$(post PATCH "/api/works/nope" "$TOKEN" "$EDIT")
assert_eq "PATCH /api/works/:id not found" "404" "$(code "$res")"
res=$(post PATCH "/api/works/$NEW_ID" "$TOKEN" "$EDIT")
assert_eq "PATCH /api/works/:id status" "200" "$(code "$res")"
assert_eq "PATCH /api/works/:id title" "編集後" "$(json "$res" | jq -r '.work.title')"
assert_eq "PATCH keeps image" "$IMAGE_URL" "$(json "$res" | jq -r '.work.image')"
# 縦長の画像に差し替えると、額も縦長になり、古い画像は消える
res=$(post PATCH "/api/works/$NEW_ID" "$TOKEN" '{"title":"編集後","date":"2099-01-02T08:00","image":"data:image/png;base64,'"$PNG"'","width":50,"height":100}')
assert_eq "PATCH replace image status" "200" "$(code "$res")"
assert_eq "PATCH replace image -> portrait frame" "portrait" "$(json "$res" | jq -r '.work.frame | split("-")[0]')"
assert_eq "PATCH removes old image" "404" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$IMAGE_URL")"
IMAGE_URL=$(json "$res" | jq -r '.work.image')
assert_eq "PATCH new image status" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$IMAGE_URL")"
assert_eq "PATCH keeps order" "$NEW_ID" "$(curl -s "$BASE_URL/api/works" | jq -r '.works[0].id')"

# --- PUT /api/works/order （並べ替え） ---
REVERSED=$(curl -s "$BASE_URL/api/works" | jq -c '{ids: (.works | map(.id) | reverse)}')
res=$(post PUT /api/works/order "$TOKEN" "$REVERSED")
assert_eq "PUT /api/works/order status" "200" "$(code "$res")"
assert_eq "PUT /api/works/order applied" "$NEW_ID" "$(curl -s "$BASE_URL/api/works" | jq -r '.works[-1].id')"
res=$(post PUT /api/works/order "$TOKEN" '{"ids":["nope"]}')
assert_eq "PUT /api/works/order invalid" "400" "$(code "$res")"

# --- 登録情報の書出し・読込み ---
assert_eq "GET /api/export without login" "401" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/export")"
BACKUP="$TMP_DIR/backup.json"
status=$(curl -s -o "$BACKUP" -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/export")
assert_eq "GET /api/export status" "200" "$status"
assert_eq "export format" "my-illust-museum-backup" "$(jq -r '.format' "$BACKUP")"
assert_eq "export count" "$(curl -s "$BASE_URL/api/works" | jq '.works | length')" "$(jq '.works | length' "$BACKUP")"
assert_eq "export embeds image" "data:image/png;base64" "$(jq -r --arg id "$NEW_ID" '.works[] | select(.id == $id) | .imageData | split(",")[0]' "$BACKUP")"

import() { curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" --data-binary "@$2" "$BASE_URL/api/import?mode=$1"; }
echo '{"format":"other","works":[]}' > "$TMP_DIR/bad.json"
assert_eq "POST /api/import invalid file" "400" "$(code "$(import replace "$TMP_DIR/bad.json")")"
res=$(import merge "$BACKUP")
assert_eq "POST /api/import merge status" "200" "$(code "$res")"
assert_eq "import merge skips existing" "0 $(jq '.works | length' "$BACKUP")" "$(json "$res" | jq -r '"\(.imported) \(.skipped)"')"
res=$(import replace "$BACKUP")
assert_eq "POST /api/import replace status" "200" "$(code "$res")"
assert_eq "import replace count" "$(jq '.works | length' "$BACKUP")" "$(json "$res" | jq '.imported')"
NEW_IMAGE_URL=$(curl -s "$BASE_URL/api/works" | jq -r --arg id "$NEW_ID" '.works[] | select(.id == $id) | .image')
assert_eq "import replace saves image" "200" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$NEW_IMAGE_URL")"
assert_eq "import replace removes old image" "404" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$IMAGE_URL")"
assert_eq "import keeps order" "$(jq -c '.works | map(.id)' "$BACKUP")" "$(curl -s "$BASE_URL/api/works" | jq -c '.works | map(.id)')"
IMAGE_URL=$NEW_IMAGE_URL

# --- DELETE /api/works/:id ---
res=$(post DELETE "/api/works/$NEW_ID" "$TOKEN")
assert_eq "DELETE /api/works/:id status" "200" "$(code "$res")"
assert_eq "DELETE removes image" "404" "$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$IMAGE_URL")"
assert_eq "DELETE /api/works/:id count" "$(jq 'length' $SAMPLE)" "$(curl -s "$BASE_URL/api/works" | jq '.works | length')"

# --- POST /api/password （パスワード変更） ---
res=$(post POST /api/password "$TOKEN" '{"current":"0000","next":"abcd"}')
assert_eq "POST /api/password status" "200" "$(code "$res")"
assert_eq "login with old password" "401" "$(code "$(post POST /api/login "" '{"password":"0000"}')")"
assert_eq "login with new password" "200" "$(code "$(post POST /api/login "" '{"password":"abcd"}')")"

# --- 存在しないルート ---
res=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/not-found")
assert_eq "GET /not-found status" "404" "$res"

echo ""
echo "結果: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
