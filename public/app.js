// 3D の美術館の廊下。
// CSS 3D transform で壁・床・天井・作品を #world に配置し、
// #world 全体を逆向きに動かすことで「カメラが廊下を進む」ように見せる。
// 座標系は CSS と同じ（x: 右、y: 下、z: 手前）。廊下の奥（過去の作品）ほど z がマイナス。

(() => {
  // ---- 廊下の寸法（ワールド座標の px） ----
  const CORRIDOR_W = 1000;   // 廊下の幅
  const SPACING = 520;       // 作品どうしの奥行き方向の間隔（左右交互に飾る）
  const START = 500;         // 入口から最初の作品までの距離
  const FLOOR_Y = 300;       // 床の高さ（目線が 0）
  const CEIL_Y = -420;       // 天井の高さ
  const ART_Y = -40;         // 作品の中心の高さ
  const OUTER_MAX_W = 470;   // 額を含めた作品の最大幅（壁の板 1 枚 = SPACING からはみ出さないこと）
  const OUTER_MAX_H = 480;   // 額を含めた作品の最大の高さ
  const FRAME_SCALE = 0.8;   // 額の太さ（元の額写真での「窓に対する太さ」の比率に掛ける）
  const FRAME_VARIANTS = 5;  // 縦長用・横長用それぞれの額の種類数（public/frames/）
  const WALK_BACK = 640;     // 廊下を歩くとき、注目中の作品よりどれだけ手前に立つか
  const FLOOR_SEGMENT = 520; // 床・天井を分割する長さ（カメラの背後に回る面の描画崩れを防ぐ）
  const WALL_H = FLOOR_Y - CEIL_Y;
  const WALL_Y = (FLOOR_Y + CEIL_Y) / 2;

  const DUR_WALK = 850;
  const DUR_TURN = 1250;
  const DUR_ZOOM = 700;
  const ZOOM_MARGIN = 12;      // 拡大表示で、絵の窓と画面の端との最小の余白（px）
  const ZOOM_TITLE_H = 56;     // 拡大表示で、画面下のタイトルのために空けておく高さ（px）

  const $ = (id) => document.getElementById(id);
  const scene = $('scene');
  const world = $('world');
  const btnPast = $('btn-past');
  const btnFuture = $('btn-future');

  const state = {
    works: [],
    index: 0,          // 注目中の作品（0 が最新）
    mode: 'focus',     // 'focus' = 正面表示 / 'walk' = 廊下を歩いている
    perspective: 800,
  };

  const walls = new Map(); // 作品の位置の番号 → 作品を飾る側の壁の板
  let frames = {};         // public/frames/frames.json（額画像の大きさと、窓までの太さ）
  let settleTimer = 0;

  // ---------- 配置 ----------

  function place(el, { x = 0, y = 0, z = 0, ry = 0, rx = 0, w, h }) {
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform =
      `translate3d(${x}px, ${y}px, ${z}px) rotateY(${ry}deg) rotateX(${rx}deg) translate(-50%, -50%)`;
  }

  function addObj(className, pos) {
    const el = document.createElement('div');
    el.className = `obj ${className}`;
    place(el, pos);
    world.appendChild(el);
    return el;
  }

  const slotZ = (j) => -(START + j * SPACING);
  const sideOf = (j) => (j % 2 === 0 ? 'left' : 'right');

  // 壁は作品 1 枠ぶん（SPACING）ずつの板に分け、作品はその位置の板の子要素として飾る。
  // 作品と壁を別々の 3D 要素にすると、ほぼ同じ平面に重なるため Chrome が前後を取り違え、
  // 壁が作品を隠してしまう。子要素にすれば必ず壁の上に描かれる。
  // また長い板はカメラの背後まではみ出すと描画が崩れるので、板は短く保つ。
  function buildCorridor(n) {
    for (let j = -3; j <= n; j++) {
      for (const side of ['left', 'right']) {
        const el = addObj(`wall wall-${side}`, {
          x: (side === 'left' ? -1 : 1) * (CORRIDOR_W / 2),
          y: WALL_Y,
          z: slotZ(j),
          ry: side === 'left' ? 90 : -90,
          w: SPACING + 2, // 継ぎ目に隙間が見えないよう 2px 重ねる
          h: WALL_H,
        });
        if (side === sideOf(j)) walls.set(j, el);
      }
    }

    const zFront = slotZ(-3) + SPACING / 2;
    const zEnd = slotZ(n) - SPACING / 2;
    const count = Math.ceil((zFront - zEnd) / FLOOR_SEGMENT);
    for (let k = 0; k < count; k++) {
      const z = zFront - FLOOR_SEGMENT * (k + 0.5);
      const len = FLOOR_SEGMENT + 2;
      addObj('floor', { y: FLOOR_Y, z, rx: 90, w: CORRIDOR_W + 2, h: len });
      addObj('ceiling', { y: CEIL_Y, z, rx: -90, w: CORRIDOR_W + 2, h: len });
    }
    const end = addObj('end-wall', { y: WALL_Y, z: zEnd, w: CORRIDOR_W + 2, h: WALL_H });
    end.textContent = 'ここから先は、これから描く作品のために';
  }

  // 額は登録画面で作品ごとにランダムに選ばれ、work.frame に保存されている。
  // 保存されていない（data/works.json を手で書いた）作品は、id から決まる乱数で選ぶ（再読み込みしても変わらない）。
  function frameIdFor(work, orientation) {
    if (String(work.frame || '').startsWith(`${orientation}-`) && frames[work.frame]) return work.frame;
    let h = 0;
    for (const ch of String(work.id || work.title)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return `${orientation}-${(h % FRAME_VARIANTS) + 1}`;
  }

  const frameImages = new Map(); // 額の id → 読み込み済みの Image（Promise）
  const FRAME_RES = 2;            // 合成する額画像の解像度（CSS px に対する倍率。正面表示で拡大しても粗くならないように）

  function loadFrameImage(id) {
    if (!frameImages.has(id)) {
      frameImages.set(id, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `/frames/${id}.webp`;
      }));
    }
    return frameImages.get(id);
  }

  // 額画像を 9 分割して（四隅はそのまま、辺だけ伸ばして）絵の大きさに合わせた 1 枚の画像に合成する。
  // CSS の border-image でも同じことができるが、3D 空間では 9 片の継ぎ目に細い線が出るため canvas で合成する。
  async function drawFrame(frame, id, meta, border, outerW, outerH) {
    const src = await loadFrameImage(id);
    const k = FRAME_RES;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(outerW * k);
    canvas.height = Math.round(outerH * k);
    const ctx = canvas.getContext('2d');
    const [st, sr, sb, sl] = meta.slice;
    const [dt, dr, db, dl] = border.map((v) => Math.round(v * k));
    const sx = [0, sl, meta.w - sr, meta.w];
    const sy = [0, st, meta.h - sb, meta.h];
    const dx = [0, dl, canvas.width - dr, canvas.width];
    const dy = [0, dt, canvas.height - db, canvas.height];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue; // 中央（窓）は描かない
        ctx.drawImage(src,
          sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
          dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (frame.dataset.frameUrl) URL.revokeObjectURL(frame.dataset.frameUrl);
    frame.dataset.frameUrl = URL.createObjectURL(blob);
    frame.style.backgroundImage = `url("${frame.dataset.frameUrl}")`;
  }

  // 額の窓は白銀比（1 : √2）に統一する。絵が横長（正方形を含む）なら √2 : 1、縦長なら 1 : √2。
  // 絵は窓の中に収まるよう縮めて置き、余白はマット（台紙）になる。
  // 額の太さは元の額写真と同じ比率（× FRAME_SCALE）にして、作品全体が OUTER_MAX に収まるよう縮める。
  function applyFrame(art, frame, work, naturalW, naturalH) {
    const landscape = naturalW >= naturalH;
    const [imgW, imgH] = landscape ? [Math.SQRT2, 1] : [1, Math.SQRT2];
    const id = frameIdFor(work, landscape ? 'landscape' : 'portrait');
    const meta = frames[id];
    let border = [0, 0, 0, 0];
    let scale = Math.min(OUTER_MAX_W / imgW, OUTER_MAX_H / imgH);
    if (meta) {
      const [t, r, b, l] = meta.slice;
      // 絵 1px あたりの額の太さ（元の額の窓の大きさとの比）
      const c = FRAME_SCALE * (imgW / (meta.w - l - r) + imgH / (meta.h - t - b)) / 2;
      scale = Math.min(OUTER_MAX_W / (imgW + (l + r) * c), OUTER_MAX_H / (imgH + (t + b) * c));
      border = meta.slice.map((v) => Math.round(v * c * scale));
    }
    frame.style.borderWidth = border.map((v) => `${v}px`).join(' ');
    work.border = border; // [上, 右, 下, 左]。拡大表示で絵の窓の位置を求めるのに使う
    work.w = Math.round(imgW * scale) + border[1] + border[3];
    work.h = Math.round(imgH * scale) + border[0] + border[2];
    art.style.width = `${work.w}px`;
    art.style.height = `${work.h}px`;
    if (meta) drawFrame(frame, id, meta, border, work.w, work.h).catch((err) => console.error(err));
  }

  function buildArtworks() {
    state.works.forEach((work, i) => {
      const side = sideOf(i);
      Object.assign(work, {
        side,
        z: slotZ(i),
        x: (side === 'left' ? -1 : 1) * (CORRIDOR_W / 2),
        yaw: side === 'left' ? 90 : -90, // 作品と同じ向きに回ると、ちょうど作品の正面を向く
      });

      const wall = walls.get(i);
      // 作品の中心の高さ（壁の上端からの距離）
      wall.style.setProperty('--art-top', `${ART_Y - CEIL_Y}px`);

      // 作品の後ろの壁を照らすスポットライト
      const glow = document.createElement('div');
      glow.className = 'glow';
      wall.appendChild(glow);

      const art = document.createElement('div');
      art.className = 'art';
      art.dataset.index = String(i);
      art.setAttribute('role', 'button');
      art.setAttribute('aria-label', `${work.title} を正面から見る`);

      const frame = document.createElement('div');
      frame.className = 'frame';
      // 画像が読み込めるまで（または見つからないとき）は横長の額として飾る
      applyFrame(art, frame, work, 1, 0);
      const missing = document.createElement('div');
      missing.className = 'frame-missing';
      missing.innerHTML = '<small>画像準備中</small><strong></strong>';
      missing.querySelector('strong').textContent = work.title;
      const img = new Image();
      img.alt = work.title;
      img.decoding = 'async';
      img.addEventListener('load', () => {
        work.naturalW = img.naturalWidth;
        work.naturalH = img.naturalHeight;
        applyFrame(art, frame, work, img.naturalWidth, img.naturalHeight);
        if (state.index === i && state.mode !== 'walk') applyCamera(0);
      });
      img.addEventListener('error', () => frame.classList.add('missing'));
      img.src = work.image;
      frame.append(img, missing);

      const plaque = document.createElement('div');
      plaque.className = 'plaque';
      plaque.textContent = work.title;
      const date = document.createElement('small');
      date.textContent = formatDate(work.date);
      plaque.appendChild(date);

      art.append(frame, plaque);
      wall.appendChild(art);
      art.addEventListener('click', (e) => {
        e.stopPropagation();
        // 正面表示の絵を押すと拡大、拡大中に押すと正面表示に戻る。それ以外の絵は正面表示へ
        if (state.mode === 'focus' && state.index === i) zoom();
        else focus(i);
      });
    });
  }

  // ---------- カメラ ----------

  function cameraFor(mode, i) {
    const work = state.works[i];
    if (mode === 'walk') {
      return { x: 0, y: 0, z: work.z + WALK_BACK, yaw: 0 };
    }
    if (mode === 'zoom') return zoomCamera(work);
    // 作品の正面に立ち、画面の縦 50%・横 84%（左右の矢印にかからない幅）に収まる距離まで近づく
    const P = state.perspective;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dist = clamp(
      Math.max((work.h * P) / (vh * 0.5), (work.w * P) / Math.min(vw * 0.84, vw - 150)),
      120,
      CORRIDOR_W * 0.92,
    );
    // 下に作品情報を出すぶん、作品を画面のやや上に寄せる
    const lift = (vh * 0.1 * dist) / P;
    const sign = work.side === 'left' ? 1 : -1;
    return {
      x: work.x + sign * dist,
      y: ART_Y + lift,
      z: work.z,
      yaw: work.yaw,
    };
  }

  // 拡大表示：絵そのものが、画面からタイトルの帯と余白を除いた範囲にちょうど収まる距離まで近づく。
  // 絵は必ず画面内に入り、マットや額は画面からはみ出してもよい。
  function zoomCamera(work) {
    const P = state.perspective;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const [t, r, b, l] = work.border || [0, 0, 0, 0];
    // 額の窓（白いマット＋絵）の大きさ
    const innerW = work.w - l - r;
    const innerH = work.h - t - b;
    // 窓の中で絵が占める大きさ（.frame img の padding: 4% は窓の幅に対する割合。絵は object-fit: contain で中央に置かれる）
    let picW = innerW;
    let picH = innerH;
    if (work.naturalW && work.naturalH) {
      const pad = innerW * 0.04;
      const boxW = innerW - pad * 2;
      const boxH = innerH - pad * 2;
      const aspect = work.naturalW / work.naturalH;
      picW = Math.min(boxW, boxH * aspect);
      picH = picW / aspect;
    }
    const availW = vw - ZOOM_MARGIN * 2;
    const availH = vh - ZOOM_MARGIN * 2 - ZOOM_TITLE_H;
    const dist = Math.max(40, (picW * P) / availW, (picH * P) / availH);
    // 額の太さは上下左右で少し違うので、窓の中心に合わせる（壁の横方向は、左の壁では -z、右の壁では +z）
    const dx = (l - r) / 2;
    const dy = (t - b) / 2;
    // タイトルの帯のぶん、絵を画面のやや上に寄せる
    const lift = ((ZOOM_TITLE_H / 2) * dist) / P;
    const sign = work.side === 'left' ? 1 : -1;
    return {
      x: work.x + sign * dist,
      y: ART_Y + dy + lift,
      z: work.z - sign * dx,
      yaw: work.yaw,
    };
  }

  function applyCamera(duration) {
    const cam = cameraFor(state.mode, state.index);
    document.documentElement.style.setProperty('--dur', `${duration}ms`);
    world.style.transform =
      `translateZ(${state.perspective}px) rotateY(${-cam.yaw}deg) ` +
      `translate3d(${-cam.x}px, ${-cam.y}px, ${-cam.z}px)`;
  }

  function updatePerspective() {
    // 画面サイズに関係なく、左右の壁が同じくらい見える画角にする
    state.perspective = Math.round(Math.min(window.innerWidth * 0.55, window.innerHeight * 0.9));
    scene.style.perspective = `${state.perspective}px`;
  }

  // ---------- 状態の切り替え ----------

  function render(duration) {
    const n = state.works.length;
    const work = state.works[state.index];
    applyCamera(duration);

    document.body.classList.toggle('mode-focus', state.mode === 'focus');
    document.body.classList.toggle('mode-walk', state.mode === 'walk');
    document.body.classList.toggle('mode-zoom', state.mode === 'zoom');
    $('zoom-title').textContent = work.title;
    document.body.classList.remove('settled');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => document.body.classList.add('settled'), Math.max(duration - 150, 0));

    btnFuture.hidden = state.index === 0;
    btnPast.hidden = state.index === n - 1;

    $('counter').textContent = `${state.index + 1} / ${n}`;
    // 正面表示から歩き出すときは、フェードアウト中の作品情報を書き換えない
    if (state.mode === 'focus') {
      $('cap-no').textContent = `No.${n - state.index}`;
      $('cap-date').textContent = formatDate(work.date);
      $('cap-title').textContent = work.title;
      $('cap-desc').textContent = work.description || '';
    }
    $('walk-title').textContent = `${work.title}　${formatDate(work.date)}`;
  }

  function focus(i) {
    const fromZoom = state.mode === 'zoom' && state.index === i;
    state.index = i;
    state.mode = 'focus';
    render(fromZoom ? DUR_ZOOM : DUR_TURN);
  }

  // 正面表示から、絵をできるだけ大きく見せる拡大表示へ
  function zoom() {
    state.mode = 'zoom';
    render(DUR_ZOOM);
  }

  function backToWalk() {
    if (state.mode === 'walk') return;
    state.mode = 'walk';
    render(DUR_TURN);
  }

  // delta: +1 で過去へ（廊下の奥へ）、-1 で未来へ（入口の方へ）
  function step(delta) {
    const next = clamp(state.index + delta, 0, state.works.length - 1);
    if (state.mode !== 'walk') {
      state.mode = 'walk';
      state.index = next;
      render(DUR_TURN);
    } else if (next !== state.index) {
      state.index = next;
      render(DUR_WALK);
    }
  }

  // ---------- 入力 ----------

  function bindInputs() {
    // 拡大中に絵の外（画面の端など）を押しても正面表示に戻る
    scene.addEventListener('click', () => {
      if (state.mode === 'zoom') focus(state.index);
    });

    btnPast.addEventListener('click', () => step(1));
    btnFuture.addEventListener('click', () => step(-1));
    $('btn-back').addEventListener('click', backToWalk);

    // 登録画面を開いている間は、廊下の操作をしない
    // （オープニングの間も同じ）
    const adminOpen = () => document.body.classList.contains('admin-open')
      || document.body.classList.contains('opening-active');

    window.addEventListener('keydown', (e) => {
      if (adminOpen() || e.defaultPrevented) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
      else if (e.key === 'Escape') {
        if (state.mode === 'zoom') focus(state.index);
        else backToWalk();
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        if (state.mode === 'walk') focus(state.index);
        else if (state.mode === 'focus') zoom();
        else focus(state.index);
      }
    });

    // ホイールで廊下を進む（連続で回しても 1 作品ずつ）
    let wheelLock = 0;
    window.addEventListener('wheel', (e) => {
      if (adminOpen() || e.target.closest('.caption')) return;
      const now = Date.now();
      if (Math.abs(e.deltaY) < 12 || now < wheelLock) return;
      wheelLock = now + 450;
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });

    // スワイプ：左か上にスワイプで過去へ
    let touch = null;
    window.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (!touch || adminOpen()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
      if (e.target.closest('.caption') && Math.abs(dy) > Math.abs(dx)) return;
      const forward = Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
      step(forward ? 1 : -1);
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        updatePerspective();
        applyCamera(0);
      }, 100);
    });
  }

  // ---------- ユーティリティ ----------

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function formatDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? `${m[1]}.${m[2]}.${m[3]}` : (s || '');
  }

  // ---------- 起動 ----------

  async function init() {
    let works = [];
    try {
      const [worksRes, framesRes] = await Promise.all([fetch('/api/works'), fetch('/frames/frames.json')]);
      works = (await worksRes.json()).works || [];
      frames = framesRes.ok ? await framesRes.json() : {};
    } catch (err) {
      console.error(err);
    }

    if (works.length === 0) {
      $('empty').hidden = false;
      btnPast.hidden = true;
      btnFuture.hidden = true;
      return;
    }

    state.works = works;
    updatePerspective();
    buildCorridor(works.length);
    buildArtworks();
    bindInputs();
    // 最初は最新の作品を正面から表示する
    render(0);
  }

  init();
})();
