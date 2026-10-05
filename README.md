# my-illust-museum

イラストが発表したくてウズウズしてる人の「自己満専用美術館」です。

## 構成

- 種類: Express（Node.js）の Web アプリ／API
- デプロイ先: なし

## 使い方

- **起動**: `npm start` → http://localhost:3001/
- **テスト**: `npm test`（= `bash test.sh`）。サーバーを自動で起動し、curl でエンドポイントを叩いて期待値と比較する。`curl` と `jq` が必要。
  - **注意**: `test.sh` は最初にポート 3001 のプロセスを `kill -9` する。
  - 新しいエンドポイントを追加したら、`test.sh` に `assert_eq` を追加する。

## 資料の保存場所

- `docs/` — 仕様・メモ・参考資料（中身は .gitignore 済み。リポジトリには上がらない）
- `assets/` — 画像などの素材（中身は .gitignore 済み。リポジトリには上がらない）

## 秘密情報

- 値は `.env`（`.gitignore` 済み）に置く。コードへのハードコードやコミットはしない。

| 名前 | 用途 | GitHub Actions |
|---|---|---|
| `API_KEY` | GeminiのAPI呼び出し | Secrets に登録して使う |

## 初期設定のチェックリスト

- [ ] `cp .env.example .env` を実行し、`.env` に秘密情報の値を設定する
- [ ] `gh secret set API_KEY` で GitHub Secrets に API_KEY を登録する
