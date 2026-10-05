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
index.js              Express 本体
routes/index.js       ルート定義
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
