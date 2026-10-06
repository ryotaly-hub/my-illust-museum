const path = require('path');
const express = require('express');
const indexRouter = require('./routes/index');
const { UPLOAD_DIR, ASSETS_DIR } = require('./config');

const app = express();
const port = 3001;

// 作品の登録で画像を base64 の JSON として受け取るので、上限を大きめにする。
// 登録情報の読込み（/api/import）は画像を全部まとめて送るので、そのルートで別の上限を使う。
const jsonParser = express.json({ limit: '25mb' });
app.use((req, res, next) => (req.path === '/api/import' ? next() : jsonParser(req, res, next)));

// 画面（public/）と作品画像（assets/）を配信する
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets/works', express.static(UPLOAD_DIR));
app.use('/assets', express.static(ASSETS_DIR));

app.use(indexRouter);

// エラーは JSON で返す（画面側でメッセージを表示するため）
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = status === 413 ? 'データが大きすぎます' : status >= 500 ? 'サーバーでエラーが起きました' : 'リクエストが正しくありません';
  res.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
