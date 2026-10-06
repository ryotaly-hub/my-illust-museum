const path = require('path');

// データと画像の置き場所。テストでは環境変数で一時フォルダに切り替える（本物のデータを書き換えないため）。
const DATA_DIR = process.env.MUSEUM_DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.MUSEUM_UPLOAD_DIR || path.join(__dirname, 'assets', 'works');
const ASSETS_DIR = path.join(__dirname, 'assets');

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  ASSETS_DIR,
  WORKS_FILE: path.join(DATA_DIR, 'works.json'),
  ADMIN_FILE: path.join(DATA_DIR, 'admin.json'),
  DEFAULT_PASSWORD: '0000',
};
