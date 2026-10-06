const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { UPLOAD_DIR, ASSETS_DIR, WORKS_FILE, ADMIN_FILE, DEFAULT_PASSWORD } = require('../config');

const router = express.Router();

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // ログインの有効期間
const FRAME_VARIANTS = 5;                 // 縦長用・横長用それぞれの額の種類数（public/frames/）
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

const tokens = new Map(); // ログイン中のトークン → 有効期限（サーバーを再起動すると全員ログアウト）

// ---------- データの読み書き ----------

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// 書き込みは一時ファイルに書いてから置き換える（途中で落ちても壊れたファイルを残さない）
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmp, file);
}

// 作品データの更新は 1 件ずつ順番に行う（同時に来ても上書きし合わないように）
let queue = Promise.resolve();
function updateWorks(fn) {
  const run = queue.then(async () => {
    const works = await readJson(WORKS_FILE, []);
    const result = await fn(works);
    await writeJson(WORKS_FILE, works);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

// ---------- パスワードとログイン ----------

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

async function checkPassword(password) {
  const admin = await readJson(ADMIN_FILE, null);
  const salt = admin ? admin.salt : 'default';
  const expected = admin ? admin.hash : hashPassword(DEFAULT_PASSWORD, salt);
  const actual = hashPassword(String(password), salt);
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function requireAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const expires = tokens.get(token);
  if (!expires || expires < Date.now()) {
    tokens.delete(token);
    return res.status(401).json({ error: 'ログインしてください' });
  }
  next();
}

const badRequest = (res, message) => res.status(400).json({ error: message });

// ---------- ルート ----------

// 作品一覧（並び順はファイルの順 = 表示順。先頭が最新）
router.get('/api/works', async (req, res) => {
  res.json({ works: await readJson(WORKS_FILE, []) });
});

router.post('/api/login', async (req, res) => {
  if (!(await checkPassword((req.body || {}).password || ''))) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  res.json({ token });
});

router.post('/api/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await checkPassword(current || ''))) return badRequest(res, '今のパスワードが違います');
  if (typeof next !== 'string' || next.length < 4 || next.length > 64) {
    return badRequest(res, '新しいパスワードは 4〜64 文字にしてください');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  await writeJson(ADMIN_FILE, { salt, hash: hashPassword(next, salt) });
  res.json({ ok: true });
});

// 入力のチェック。問題があればエラーメッセージを返す
function validateFields({ title, description = '', date }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 100) return 'タイトルは 1〜100 文字で入力してください';
  if (typeof description !== 'string' || description.length > 2000) return '説明は 2000 文字までにしてください';
  if (typeof date !== 'string' || !DATE_RE.test(date)) return '作成日時が正しくありません';
  return null;
}

// data URL の画像を読み取る。{ ext, bytes, orientation } か、エラーメッセージを返す
function parseImage({ image, width, height }) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(typeof image === 'string' ? image : '');
  const ext = m && IMAGE_TYPES[m[1]];
  if (!ext) return { error: '画像は PNG / JPEG / WebP / GIF にしてください' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { error: '画像は 15MB までにしてください' };
  if (!(width > 0 && height > 0)) return { error: '画像の大きさがわかりません' };
  // 額の向き。正方形は横長
  return { ext, bytes, orientation: width >= height ? 'landscape' : 'portrait' };
}

// 画像を保存して、作品データに入れる画像の情報を返す。
// ファイル名は作品の id で始める（削除や差し替えのとき、登録画面から上げた画像だとわかるように）
async function saveImage(id, parsed, width, height) {
  const file = `${id}-${Date.now().toString(36)}.${parsed.ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, file), parsed.bytes);
  return { image: `/assets/works/${file}`, width: Math.round(width), height: Math.round(height) };
}

const randomFrame = (orientation) => `${orientation}-${crypto.randomInt(1, FRAME_VARIANTS + 1)}`;

// 登録画面から上げた画像だけ消す（サンプルなど手で置いた画像には触らない）
async function removeUploadedImage(work) {
  const file = path.basename(String(work.image || ''));
  if (file.startsWith(`${work.id}.`) || file.startsWith(`${work.id}-`)) {
    await fs.unlink(path.join(UPLOAD_DIR, file)).catch(() => {});
  }
}

// 作品の登録。画像は data URL（base64）で受け取り、UPLOAD_DIR に保存する。
router.post('/api/works', requireAuth, async (req, res) => {
  const body = req.body || {};
  const fieldError = validateFields(body);
  if (fieldError) return badRequest(res, fieldError);
  const parsed = parseImage(body);
  if (parsed.error) return badRequest(res, parsed.error);

  const id = `w${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const work = {
    id,
    title: body.title.trim(),
    description: (body.description || '').trim(),
    date: body.date,
    ...(await saveImage(id, parsed, body.width, body.height)),
    // 額は画像の向きに合う 5 種類からランダムに選んで作品に保存する
    frame: randomFrame(parsed.orientation),
  };
  // 新しい順の一覧の中で、作成日時に合う位置に入れる
  await updateWorks((works) => {
    const at = works.findIndex((w) => String(w.date) <= work.date);
    works.splice(at === -1 ? works.length : at, 0, work);
  });
  res.status(201).json({ work });
});

// 作品の編集。image を送ったときだけ画像を差し替える。並び順は変えない。
router.patch('/api/works/:id', requireAuth, async (req, res) => {
  const body = req.body || {};
  const fieldError = validateFields(body);
  if (fieldError) return badRequest(res, fieldError);
  const parsed = body.image === undefined ? null : parseImage(body);
  if (parsed && parsed.error) return badRequest(res, parsed.error);

  const newImage = parsed ? await saveImage(req.params.id, parsed, body.width, body.height) : null;
  const result = await updateWorks((works) => {
    const work = works.find((w) => w.id === req.params.id);
    if (!work) return null;
    const old = { ...work };
    Object.assign(work, { title: body.title.trim(), description: (body.description || '').trim(), date: body.date });
    if (newImage) {
      Object.assign(work, newImage);
      // 向きが変わったときだけ、その向きの額を選び直す
      if (!String(work.frame || '').startsWith(`${parsed.orientation}-`)) work.frame = randomFrame(parsed.orientation);
    }
    return { work, old };
  });
  if (!result) {
    if (newImage) await removeUploadedImage({ id: req.params.id, image: newImage.image });
    return res.status(404).json({ error: '作品が見つかりません' });
  }
  if (newImage) await removeUploadedImage(result.old);
  res.json({ work: result.work });
});

// 並べ替え。ids は今ある作品の id をすべて、新しい並び順で渡す。
router.put('/api/works/order', requireAuth, async (req, res) => {
  const ids = (req.body || {}).ids;
  const result = await updateWorks((works) => {
    const byId = new Map(works.map((w) => [w.id, w]));
    if (!Array.isArray(ids) || ids.length !== works.length || new Set(ids).size !== ids.length
      || !ids.every((id) => byId.has(id))) {
      return null;
    }
    works.splice(0, works.length, ...ids.map((id) => byId.get(id)));
    return works;
  });
  if (!result) return badRequest(res, '並び順が正しくありません（一覧を読み込み直してください）');
  res.json({ works: result });
});

router.delete('/api/works/:id', requireAuth, async (req, res) => {
  const removed = await updateWorks((works) => {
    const at = works.findIndex((w) => w.id === req.params.id);
    return at === -1 ? null : works.splice(at, 1)[0];
  });
  if (!removed) return res.status(404).json({ error: '作品が見つかりません' });
  await removeUploadedImage(removed);
  res.json({ ok: true });
});

// ---------- 登録情報の書出し・読込み（別の環境へ引き継ぐため） ----------
// 書き出すファイルは 1 つの JSON。作品データに、画像を data URL（base64）で埋め込んだ imageData を足したもの。
// パスワードは環境ごとの設定なので含めない。

const BACKUP_FORMAT = 'my-illust-museum-backup';
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const FRAME_RE = /^(landscape|portrait)-[1-9]$/;

// 作品の image（URL）から、サーバー上のファイルの場所を求める（assets/ の外は扱わない）
function localImagePath(image) {
  const url = String(image || '');
  if (url.startsWith('/assets/works/')) return path.join(UPLOAD_DIR, path.basename(url));
  if (url.startsWith('/assets/')) {
    const file = path.join(ASSETS_DIR, decodeURIComponent(url.slice('/assets/'.length)));
    if (file.startsWith(ASSETS_DIR + path.sep)) return file;
  }
  return null;
}

// 画像が多いと大きなファイルになるので、1 作品ずつ書き出す
router.get('/api/export', requireAuth, async (req, res) => {
  const works = await readJson(WORKS_FILE, []);
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="my-illust-museum-${stamp}.json"`);
  res.write(`{"format":"${BACKUP_FORMAT}","version":1,"exportedAt":${JSON.stringify(now.toISOString())},"works":[`);
  for (const [i, work] of works.entries()) {
    let imageData = null;
    const file = localImagePath(work.image);
    const mime = file && MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()];
    if (mime) {
      // 画像が見つからない作品は imageData: null で書き出す（情報だけ引き継ぐ）
      imageData = await fs.readFile(file).then((b) => `data:${mime};base64,${b.toString('base64')}`, () => null);
    }
    if (!res.write(`${i ? ',' : ''}${JSON.stringify({ ...work, imageData })}`)) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
  }
  res.end(']}\n');
});

// 書き出したファイルを読み込む。?mode=replace（すべて置き換える）か ?mode=merge（今の作品に追加。同じ id は飛ばす）。
// ログインを確かめてから大きな本文を読む（ログインしていない人に大きなデータを読ませない）
router.post('/api/import', requireAuth, express.json({ limit: '500mb' }), async (req, res) => {
  const mode = req.query.mode === 'merge' ? 'merge' : 'replace';
  const data = req.body || {};
  if (data.format !== BACKUP_FORMAT || !Array.isArray(data.works)) {
    return badRequest(res, 'このアプリで書き出したファイルではありません');
  }
  const ids = new Set();
  for (const w of data.works) {
    const title = (w && typeof w.title === 'string' && w.title) || '（タイトル不明）';
    if (!w || typeof w.id !== 'string' || !/^[\w-]{1,64}$/.test(w.id) || ids.has(w.id) || validateFields(w)) {
      return badRequest(res, `読み込めない作品があります：${title}`);
    }
    ids.add(w.id);
  }

  const current = await readJson(WORKS_FILE, []);
  const existing = new Set(current.map((w) => w.id));
  const targets = mode === 'merge' ? data.works.filter((w) => !existing.has(w.id)) : data.works;

  // 先に画像をすべて保存する（途中で失敗したら保存した分を消して、何も変えない）
  const savedFiles = [];
  const prepared = [];
  let missingImages = 0;
  try {
    for (const w of targets) {
      const work = {
        id: w.id,
        title: w.title.trim(),
        description: typeof w.description === 'string' ? w.description.trim() : '',
        date: w.date,
        image: typeof w.image === 'string' ? w.image : '',
      };
      if (w.width > 0 && w.height > 0) Object.assign(work, { width: Math.round(w.width), height: Math.round(w.height) });
      if (FRAME_RE.test(String(w.frame || ''))) work.frame = w.frame;
      if (w.imageData) {
        const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(w.imageData));
        const ext = m && IMAGE_TYPES[m[1]];
        if (!ext) throw new Error(`画像を読み込めない作品があります：${work.title}`);
        const file = `${work.id}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}.${ext}`;
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        await fs.writeFile(path.join(UPLOAD_DIR, file), Buffer.from(m[2], 'base64'));
        savedFiles.push(file);
        work.image = `/assets/works/${file}`;
      } else {
        missingImages += 1;
      }
      prepared.push(work);
    }
  } catch (err) {
    await Promise.all(savedFiles.map((f) => fs.unlink(path.join(UPLOAD_DIR, f)).catch(() => {})));
    return badRequest(res, err.message);
  }

  const replaced = await updateWorks((works) => {
    if (mode === 'replace') return works.splice(0, works.length, ...prepared);
    // 追加：新しい順の一覧の中で、作成日時に合う位置に 1 件ずつ入れる
    for (const work of prepared) {
      const at = works.findIndex((w) => String(w.date) <= work.date);
      works.splice(at === -1 ? works.length : at, 0, work);
    }
    return [];
  });
  // 置き換えたときは、前の作品の画像（登録画面から上げたもの）を消す。新しい作品が使っている画像は残す
  const inUse = new Set(prepared.map((w) => w.image));
  await Promise.all(replaced.filter((w) => !inUse.has(w.image)).map(removeUploadedImage));

  res.json({ mode, imported: prepared.length, skipped: data.works.length - targets.length, missingImages });
});

module.exports = router;
