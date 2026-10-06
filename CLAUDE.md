# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) への指針を提供する。

## プロジェクト概要

イラストが発表したくてウズウズしてる人の「自己満専用美術館」です。

- 種類: Express（Node.js）の Web アプリ／API
- デプロイ先: なし

## コマンド

- **起動**: `npm start` → http://localhost:3001/
- **テスト**: `npm test`（= `bash test.sh`）。サーバーを自動で起動し、curl でエンドポイントを叩いて期待値と比較する。`curl` と `jq` が必要。
  - **注意**: `test.sh` は最初にポート 3001 のプロセスを `kill -9` する。
  - 新しいエンドポイントを追加したら、`test.sh` に `assert_eq` を追加する。

## ディレクトリ構造

```
index.js              Express 本体（public/ と assets/ も配信）
config.js             データと画像の置き場所・初期パスワード（環境変数 MUSEUM_DATA_DIR / MUSEUM_UPLOAD_DIR で切り替え可）
routes/index.js       API（下記）
data/works.json       作品データ（git 管理外。無ければ 0 件）。配列の順 = 表示順（先頭が最新）
data/works.sample.json テスト用のサンプル作品（test.sh が一時フォルダにコピーして使う）
data/admin.json       変更後のパスワードのハッシュ（git 管理外。無ければ初期パスワード 0000）
public/               画面（index.html / style.css / app.js）。ビルドなし
public/wallpaper.webp 廊下の壁紙（参考画像から模様の 1 周期 486×529 を切り出した継ぎ目なしタイル）
public/opening.js     オープニング（最新 5 枚が奥から手前へ → タイトル → 入館ボタン）。タブごとに 1 回（sessionStorage）。表示済みの判定は index.html の <head> で行い、ちらつきを防ぐ
public/admin.js       作品の登録画面（歯車 → パスワード → 登録・編集・並べ替え・削除）
public/icons/gear.webp 歯車アイコン（generate-illustration で生成）
public/frames/        額の画像（portrait-1〜5 / landscape-1〜5 の .webp）と frames.json（画像サイズと窓までの太さ = slice [上,右,下,左]）
test.sh               curl ベースの API テスト
docs/                 仕様・メモ・参考資料（中身は git 管理外）
assets/               画像などの素材（中身は git 管理外）
.env.example          秘密情報の項目の見本
```

## このプロジェクトで使うスキル

- `scaffold-express-server` — Scaffold a minimal Express.js web server with a routes/ folder structure and a curl-based automated test script (test.sh).
- `graphify` — Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, wher…
- `generate-illustration` — Generate new images from a text prompt, or edit/transform existing images with a text instruction, using Nano Banana 2 (Gemini 3.1 Flash Ima…
  - 画像・アイコン・イラストはこのスキルで作る。手描き・SVG での代替はしない。

## API（routes/index.js）

- `GET /api/works` — 作品一覧（ファイルの順）
- `POST /api/login` — `{password}` → `{token}`（トークンはメモリ上。サーバー再起動でログアウト）
- 以下は `Authorization: Bearer <token>` が必要
  - `POST /api/works` — `{title, description, date, image(data URL), width, height}`。画像を `assets/works/<id>.<拡張子>` に保存し、作成日時に合う位置に入れる。額（`frame`）は向きに合わせてランダムに決めて保存
  - `PATCH /api/works/:id` — `{title, description, date}`（＋差し替えるときだけ `image, width, height`）。並び順は変えない。画像の向きが変わったら額を選び直し、古い画像ファイルを消す
  - `PUT /api/works/order` — `{ids}`（全作品の id を新しい並び順で）
  - `DELETE /api/works/:id` — 登録画面から上げた画像ファイルも消す
  - `POST /api/password` — `{current, next}`
  - `GET /api/export` — 登録情報の書出し。`{format: "my-illust-museum-backup", version: 1, exportedAt, works: [...作品 + imageData(data URL か null)]}` を 1 作品ずつストリームで返す
  - `POST /api/import?mode=replace|merge` — 書き出したファイルをそのまま本文で受け取る（このルートだけ上限 500MB。index.js の共通の JSON 上限 25MB は適用しない）。画像を先にすべて保存してから作品データを置き換え／追加し、置き換えのときは前の画像を消す
- `test.sh` はサーバーを一時フォルダのデータ（`MUSEUM_DATA_DIR` / `MUSEUM_UPLOAD_DIR`）で起動するので、本物の `data/` は書き換えない。

## 画面の仕組み（public/app.js）

- 3D の廊下は CSS 3D transform だけで描いている（ライブラリなし）。`#world` に壁・床・天井を並べ、`#world` 全体を逆向きに動かしてカメラ移動を表現する。
- 作品は壁の板の**子要素**として飾る。別々の 3D 要素にすると、ほぼ同じ平面に重なるため Chrome が前後を取り違えて壁が絵を隠す。
- 壁・床の板は短く分割している。長い板がカメラの背後まではみ出すと描画が崩れるため。
- `.obj` は `transform-origin: 0 0` が必須（中心合わせを transform の `translate(-50%, -50%)` で行っているため。デフォルトの 50% 50% だと回転した面がずれる）。
- 額の窓は白銀比（1 : √2）に固定（`applyFrame`）。絵は `object-fit: contain` で収め、余白はマット。
- 額は作品に保存された `frame`（登録時にランダムに決定）を使う。無い作品（手で書いたデータ）は向きに合う 5 種類から `id` のハッシュで選ぶ。額画像を 9 分割して canvas で絵のサイズに合成し、`.frame` の背景にしている（CSS の border-image は 3D 空間で継ぎ目に線が出るので使わない）。
- 額画像は、参考画像から切り抜いた額を `generate-illustration` スキルで「絵を外した正面向きの額（窓と背景は #00FF00）」として描き直し、緑を透過して作った。額を追加・差し替えるときも同じ手順で作り、`frames.json` の slice（透過した窓までの距離）を測り直すこと。
- 表示は 3 つ：`walk`（廊下）→ `focus`（正面）→ `zoom`（拡大）。拡大のカメラ距離は `zoomCamera` で、マットと `object-fit: contain` を考慮した絵そのものの大きさが画面（余白 12px・下のタイトル帯 56px を除く）に収まるように決める。
- 見た目を変えたら、ブラウザで正面表示・廊下・その途中のアニメーションを実際に確認すること。

## 資料の保存場所

- `docs/` — 仕様・メモ・参考資料（中身は .gitignore 済み。リポジトリには上がらない）
- `assets/` — 画像などの素材（中身は .gitignore 済み。リポジトリには上がらない）

## 秘密情報

- 値は `.env`（`.gitignore` 済み）に置く。コードへのハードコードやコミットはしない。

| 名前 | 用途 | GitHub Actions |
|---|---|---|
| `API_KEY` | GeminiのAPI呼び出し | Secrets に登録して使う |

## 注意事項

- 新しい依存関係の追加や、依頼範囲外のリファクタリングは避ける。
- テストが実行できなかった場合は、その理由を明記する。
