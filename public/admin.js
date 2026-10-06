// 作品の登録画面（自分専用）。
// 右下の歯車 → パスワード → 画像・タイトル・説明・作成日時を入力して登録。
// 登録した作品は新しい順の一覧に並び、ドラッグで並べ替えられる。閉じると美術館に反映する。

(() => {
  const MAX_SIDE = 2400; // これより大きい画像は登録前に縮める（表示には十分で、読み込みが軽くなる）
  const TOKEN_KEY = 'museum-admin-token';

  const $ = (id) => document.getElementById(id);
  const admin = $('admin');
  const loginForm = $('admin-login');
  const panel = $('admin-panel');
  const rows = $('work-rows');

  let token = storage('get');
  let works = [];
  let picked = null;    // 選んだ画像 { dataUrl, width, height }
  let changed = false;  // 閉じるときに美術館を読み込み直すか
  let editing = null;   // 編集中の作品（null なら新規登録）

  // ---------- 開く・閉じる ----------

  function open() {
    admin.hidden = false;
    document.body.classList.add('admin-open');
    if (token) showPanel();
    else showLogin();
  }

  function close() {
    admin.hidden = true;
    document.body.classList.remove('admin-open');
    if (changed) location.reload();
  }

  function showLogin(message = '') {
    panel.hidden = true;
    loginForm.hidden = false;
    $('login-error').textContent = message;
    $('login-password').value = '';
    $('login-password').focus();
  }

  async function showPanel() {
    loginForm.hidden = true;
    panel.hidden = false;
    resetForm();
    await loadWorks();
  }

  // ---------- API ----------

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/login') handleUnauthorized();
    if (!res.ok) throw new Error(data.error || `エラーが起きました（${res.status}）`);
    return data;
  }

  // ---------- ログイン・パスワード変更 ----------

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      token = (await api('POST', '/api/login', { password: $('login-password').value })).token;
      storage('set', token);
      showPanel();
    } catch (err) {
      showLogin(err.message);
    }
  });

  $('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('pw-error');
    if ($('pw-next').value !== $('pw-confirm').value) {
      error.textContent = '確認用のパスワードが一致しません';
      return;
    }
    try {
      await api('POST', '/api/password', { current: $('pw-current').value, next: $('pw-next').value });
      e.target.reset();
      error.textContent = 'パスワードを変更しました';
    } catch (err) {
      error.textContent = err.message;
    }
  });

  // ---------- 画像の選択 ----------

  const drop = $('drop');
  $('work-file').addEventListener('change', (e) => pickFile(e.target.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    pickFile(e.dataTransfer.files[0]);
  });

  async function pickFile(file) {
    $('work-error').textContent = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      $('work-error').textContent = '画像は PNG / JPEG / WebP / GIF を選んでください';
      return;
    }
    try {
      picked = await readImage(file);
    } catch (err) {
      $('work-error').textContent = '画像を読み込めませんでした';
      return;
    }
    $('drop-preview').src = picked.dataUrl;
    $('drop-preview').hidden = false;
    $('drop-hint').hidden = true;
    const shape = picked.width === picked.height ? '正方形' : picked.width > picked.height ? '横長' : '縦長';
    const frame = picked.width >= picked.height ? '横長' : '縦長';
    $('work-info').textContent = `${picked.width} × ${picked.height}（${shape}）→ ${frame}の額に飾ります`;
    // タイトルが空なら、ファイル名を仮のタイトルにする
    if (!$('work-title').value) $('work-title').value = file.name.replace(/\.[^.]+$/, '');
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const { naturalWidth: w, naturalHeight: h } = img;
          const scale = MAX_SIDE / Math.max(w, h);
          // GIF はアニメーションが消えないよう、縮めずにそのまま登録する
          if (scale >= 1 || file.type === 'image/gif') {
            resolve({ dataUrl: reader.result, width: w, height: h });
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ dataUrl: canvas.toDataURL('image/webp', 0.92), width: canvas.width, height: canvas.height });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- 登録 ----------

  $('work-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('work-error');
    if (!picked && !editing) {
      error.textContent = '画像を選んでください';
      return;
    }
    const submit = $('work-submit');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = editing ? '更新中…' : '登録中…';
    const body = {
      title: $('work-title').value,
      description: $('work-desc').value,
      date: $('work-date').value,
      // 編集では、新しい画像を選んだときだけ画像を送る（送らなければ今の画像のまま）
      ...(picked ? { image: picked.dataUrl, width: picked.width, height: picked.height } : {}),
    };
    try {
      const { work } = editing
        ? await api('PATCH', `/api/works/${encodeURIComponent(editing.id)}`, body)
        : await api('POST', '/api/works', body);
      changed = true;
      resetForm();
      await loadWorks(work.id);
    } catch (err) {
      error.textContent = err.message;
      submit.textContent = label;
    } finally {
      submit.disabled = false;
    }
  });

  // 編集：作品の内容を入力欄に読み込む
  function startEdit(work) {
    resetForm();
    editing = work;
    $('work-title').value = work.title || '';
    $('work-desc').value = work.description || '';
    // 日付だけの作品（手で書いたデータ）は 0 時として読み込む
    $('work-date').value = /T\d{2}:\d{2}$/.test(work.date) ? work.date : `${work.date}T00:00`;
    $('drop-preview').src = work.image;
    $('drop-preview').hidden = false;
    $('drop-hint').hidden = true;
    $('drop-preview').onerror = () => {
      $('drop-preview').hidden = true;
      $('drop-hint').hidden = false;
    };
    $('work-info').textContent = '画像を変えるときだけ、新しい画像をドロップしてください';
    $('edit-banner').textContent = `「${work.title}」を編集中`;
    $('edit-banner').hidden = false;
    $('edit-cancel').hidden = false;
    $('work-submit').textContent = '更新する';
    rows.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-editing', tr.dataset.id === work.id));
    panel.scrollTo({ top: 0, behavior: 'smooth' });
    $('work-title').focus({ preventScroll: true });
  }

  $('edit-cancel').addEventListener('click', () => {
    resetForm();
    rows.querySelectorAll('.is-editing').forEach((tr) => tr.classList.remove('is-editing'));
  });

  function resetForm() {
    $('work-form').reset();
    picked = null;
    editing = null;
    $('edit-banner').hidden = true;
    $('edit-cancel').hidden = true;
    $('work-submit').textContent = '登録する';
    $('drop-preview').onerror = null;
    $('drop-preview').hidden = true;
    $('drop-preview').removeAttribute('src');
    $('drop-hint').hidden = false;
    $('work-info').textContent = '額は画像の縦横比に合わせて付きます（正方形は横長）';
    $('work-error').textContent = '';
    $('work-date').value = localNow();
  }

  // ---------- 一覧 ----------

  async function loadWorks(highlightId) {
    try {
      works = (await api('GET', '/api/works')).works;
      $('list-error').textContent = '';
    } catch (err) {
      $('list-error').textContent = err.message;
    }
    renderRows(highlightId);
  }

  function renderRows(highlightId) {
    rows.replaceChildren(...works.map((work) => {
      const tr = document.createElement('tr');
      tr.dataset.id = work.id;
      if (work.id === highlightId) tr.classList.add('is-new');
      if (editing && work.id === editing.id) tr.classList.add('is-editing');

      const handle = cell('drag-handle', '⋮⋮');
      handle.title = 'ドラッグで並べ替え';

      const thumb = cell('thumb');
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.src = work.image;
      img.onerror = () => thumb.classList.add('missing');
      thumb.appendChild(img);

      const actions = cell('actions');
      for (const [text, onClick] of [['編集', () => startEdit(work)], ['削除', () => removeWork(work)]]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-ghost btn-small';
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        actions.appendChild(btn);
      }

      tr.append(
        handle,
        thumb,
        cell('title', work.title),
        cell('date', String(work.date || '').replace('T', ' ')),
        cell('col-frame', frameLabel(work)),
        actions,
      );
      return tr;
    }));
    $('work-count').textContent = `（${works.length}件）`;
    const fresh = rows.querySelector('.is-new');
    if (fresh) fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function cell(className, text) {
    const td = document.createElement('td');
    td.className = className;
    if (text !== undefined) td.textContent = text;
    return td;
  }

  function frameLabel(work) {
    const m = /^(landscape|portrait)-(\d)$/.exec(work.frame || '');
    return m ? `${m[1] === 'landscape' ? '横長' : '縦長'} ${m[2]}` : '自動';
  }

  async function removeWork(work) {
    if (!confirm(`「${work.title}」を削除しますか？（元に戻せません）`)) return;
    try {
      await api('DELETE', `/api/works/${encodeURIComponent(work.id)}`);
      changed = true;
      if (editing && editing.id === work.id) resetForm();
      await loadWorks();
    } catch (err) {
      $('list-error').textContent = err.message;
    }
  }

  // ---------- ドラッグで並べ替え ----------
  // マウスは行のどこでも、タッチは ⋮⋮ をつかんで動かす（タッチで行全体をつかむとスクロールできなくなるため）

  let drag = null;

  rows.addEventListener('pointerdown', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || e.button !== 0 || e.target.closest('button')) return;
    if (e.pointerType !== 'mouse' && !e.target.closest('.drag-handle')) return;
    e.preventDefault();
    drag = { tr, before: order() };
    tr.classList.add('dragging');
    rows.setPointerCapture(e.pointerId);
  });

  rows.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // ポインターより下にある最初の行の前に入れる
    const others = [...rows.children].filter((r) => r !== drag.tr);
    const next = others.find((r) => {
      const box = r.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (next !== drag.tr.nextElementSibling) rows.insertBefore(drag.tr, next || null);
  });

  const endDrag = async () => {
    if (!drag) return;
    const { tr, before } = drag;
    drag = null;
    tr.classList.remove('dragging');
    const ids = order();
    if (ids.join() === before.join()) return;
    try {
      works = (await api('PUT', '/api/works/order', { ids })).works;
      changed = true;
      $('list-error').textContent = '';
    } catch (err) {
      $('list-error').textContent = err.message;
      await loadWorks();
    }
  };
  rows.addEventListener('pointerup', endDrag);
  rows.addEventListener('pointercancel', endDrag);

  function order() {
    return [...rows.children].map((r) => r.dataset.id);
  }

  // ---------- 登録情報の書出し・読込み ----------

  const backupMsg = $('backup-msg');
  let importFile = null;

  $('btn-export').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    backupMsg.textContent = '書き出しています…';
    try {
      const res = await fetch('/api/export', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) return handleUnauthorized();
      if (!res.ok) throw new Error(`書き出せませんでした（${res.status}）`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name ? name[1] : 'my-illust-museum.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      backupMsg.textContent = `${works.length}件を書き出しました（${a.download}・${formatSize(blob.size)}）`;
    } catch (err) {
      backupMsg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    importFile = e.target.files[0] || null;
    e.target.value = ''; // 同じファイルをもう一度選べるように
    if (!importFile) return;
    backupMsg.textContent = '';
    $('import-summary').textContent = `「${importFile.name}」（${formatSize(importFile.size)}）をどう読み込みますか？`;
    $('import-choice').hidden = false;
  });
  $('import-cancel').addEventListener('click', endImport);
  $('import-replace').addEventListener('click', () => {
    if (confirm(`今の登録作品（${works.length}件）をすべて消して、ファイルの内容に置き換えます。よろしいですか？`)) runImport('replace');
  });
  $('import-merge').addEventListener('click', () => runImport('merge'));

  // ファイルはそのまま送る（大きなファイルをブラウザで読み込まずに済む）。中身の確認はサーバーが行う
  async function runImport(mode) {
    if (!importFile) return;
    const buttons = $('import-choice').querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = true));
    backupMsg.textContent = '読み込んでいます…';
    try {
      const res = await fetch(`/api/import?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: importFile,
      });
      if (res.status === 401) return handleUnauthorized();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `読み込めませんでした（${res.status}）`);
      changed = true;
      endImport();
      const notes = [];
      if (data.skipped) notes.push(`すでにある作品 ${data.skipped}件は飛ばしました`);
      if (data.missingImages) notes.push(`画像のない作品が ${data.missingImages}件あります`);
      backupMsg.textContent = `${data.imported}件を読み込みました${notes.length ? `（${notes.join('、')}）` : ''}`;
      resetForm();
      await loadWorks();
    } catch (err) {
      backupMsg.textContent = err.message;
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  function endImport() {
    importFile = null;
    $('import-choice').hidden = true;
  }

  function handleUnauthorized() {
    token = null;
    storage('remove');
    showLogin('もう一度ログインしてください');
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }

  // ---------- その他 ----------

  $('btn-admin').addEventListener('click', open);
  admin.addEventListener('click', (e) => {
    if (e.target === admin || e.target.closest('[data-close]')) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !admin.hidden) {
      e.preventDefault(); // 美術館側の Esc（廊下に戻る）を動かさない
      close();
    }
  });

  function localNow() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  // ログイン状態はタブを閉じるまで覚えておく（使えない環境では毎回ログイン）
  function storage(action, value) {
    try {
      if (action === 'get') return sessionStorage.getItem(TOKEN_KEY);
      if (action === 'set') sessionStorage.setItem(TOKEN_KEY, value);
      if (action === 'remove') sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // 何もしない
    }
    return null;
  }
})();
