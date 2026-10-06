// サイトの設定。手元のサーバー（npm start）ではこのまま使う。
// GitHub Pages に公開するとき（npm run pages）は、scripts/publish-pages.js が MUSEUM_STATIC = true の内容に置き換える。
//   MUSEUM_STATIC = false … 作品一覧を API（api/works）から読む。右下の歯車から作品を登録できる
//   MUSEUM_STATIC = true  … 作品一覧をファイル（data/works.json）から読む。登録画面は出さない
window.MUSEUM_STATIC = false;
