// GitHub Pages への公開。
//   npm run pages                 … 公開用のファイルを組み立てて gh-pages ブランチに push する
//   node scripts/publish-pages.js --build-only [出力先]  … 組み立てだけ（push しない。テストや確認用）
//
// 公開されるもの：public/ の画面一式、作品データ（data/works.json）、作品が使っている画像。
// 公開版は登録画面を出さない（GitHub Pages にはサーバーがないため）。作品の登録・並べ替えは手元（npm start）で行い、
// 終わったらこのコマンドで公開し直す。
// gh-pages ブランチは毎回作り直す（履歴を残さない）ので、画像を入れ替えてもリポジトリが大きくならない。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { WORKS_FILE, UPLOAD_DIR, ASSETS_DIR } = require('../config');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const buildOnly = args.includes('--build-only');
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, '.pages-build'));

function git(cwd, ...gitArgs) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

// 作品の image（/assets/... の URL）から、手元のファイルの場所を求める
function localImagePath(image) {
  const url = String(image || '');
  if (url.startsWith('/assets/works/')) return path.join(UPLOAD_DIR, path.basename(url));
  if (url.startsWith('/assets/')) {
    const file = path.join(ASSETS_DIR, decodeURIComponent(url.slice('/assets/'.length)));
    if (file.startsWith(ASSETS_DIR + path.sep)) return file;
  }
  return null;
}

function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  // 画面一式（登録画面のスクリプトは公開版では使わないので入れない）
  fs.cpSync(PUBLIC_DIR, outDir, { recursive: true, filter: (src) => path.basename(src) !== 'admin.js' });

  const works = fs.existsSync(WORKS_FILE) ? JSON.parse(fs.readFileSync(WORKS_FILE, 'utf8')) : [];
  let copied = 0;
  const missing = [];
  const published = works.map((work) => {
    const file = localImagePath(work.image);
    if (file && fs.existsSync(file)) {
      const rel = path.posix.join('assets', 'works', path.basename(file));
      fs.mkdirSync(path.join(outDir, 'assets', 'works'), { recursive: true });
      fs.copyFileSync(file, path.join(outDir, rel));
      copied += 1;
      // サイトは /my-illust-museum/ の下に置かれるので、画像は相対パスで参照する
      return { ...work, image: rel };
    }
    missing.push(work.title);
    return { ...work, image: String(work.image || '').replace(/^\//, '') };
  });

  fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data', 'works.json'), `${JSON.stringify({ works: published }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'site-config.js'),
    '// GitHub Pages の公開版（scripts/publish-pages.js が作成）。作品一覧はファイルから読み、登録画面は出さない\nwindow.MUSEUM_STATIC = true;\n');
  // 登録画面のスクリプトは入れていないので、読み込みの行も消す（404 にならないように）
  const indexFile = path.join(outDir, 'index.html');
  fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace(/^\s*<script src="admin\.js"><\/script>\n/m, ''));
  // GitHub Pages の Jekyll 処理を止める（ファイルをそのまま配信させる）
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

  console.log(`組み立て完了: ${outDir}`);
  console.log(`  作品 ${works.length}件（画像 ${copied}枚）`);
  if (missing.length) console.log(`  画像が見つからない作品（画像準備中の額で表示）: ${missing.join('、')}`);
}

function deploy() {
  const remote = git(ROOT, 'remote', 'get-url', 'origin');
  // コミットの作者は、このリポジトリの設定（GitHub の noreply アドレス）をそのまま使う
  const name = git(ROOT, 'config', 'user.name');
  const email = git(ROOT, 'config', 'user.email');
  const source = git(ROOT, 'rev-parse', '--short', 'HEAD');
  git(outDir, 'init', '--quiet', '--initial-branch', 'gh-pages');
  git(outDir, 'add', '--all');
  git(outDir, '-c', `user.name=${name}`, '-c', `user.email=${email}`,
    'commit', '--quiet', '-m', `GitHub Pages を更新（${source} の画面、${new Date().toISOString()}）`);
  git(outDir, 'push', '--force', '--quiet', remote, 'gh-pages');
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remote);
  console.log('gh-pages ブランチに公開しました');
  if (m) console.log(`  https://${m[1].toLowerCase()}.github.io/${m[2]}/ （反映まで 1〜2 分かかることがあります）`);
}

build();
if (!buildOnly) deploy();
