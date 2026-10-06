// オープニング。アクセス直後に、最新の作品（最大 5 枚）が画面の奥からフェードインして手前を通り過ぎ、
// タイトル → 「入館する」ボタンの順に現れる。タブを開いている間は 1 回だけ表示する。
// 画面のクリック / Esc / Enter / Space でスキップ（ボタンが出た状態まで飛ばす）。

(() => {
  const SEEN_KEY = 'museum-opening-seen';
  const MAX_IMAGES = 5;
  const FLY_MS = 2600;      // 1 枚が奥から手前を通り過ぎるまで
  const STAGGER_MS = 600;   // 次の 1 枚が出てくるまでの間隔
  const PRELOAD_TIMEOUT_MS = 4000;
  // 各画像の通り道（画面中央からのずれ）。最後の 1 枚は正面からまっすぐ通り抜ける
  const PATHS = [[-14, -6], [16, 5], [-8, 10], [12, -10], [0, 0]];

  const opening = document.getElementById('opening');
  const stage = document.getElementById('opening-stage');
  const enterBtn = document.getElementById('opening-enter');

  if (document.documentElement.classList.contains('opening-seen')) {
    opening.remove();
    return;
  }

  document.body.classList.add('opening-active');
  const timers = [];
  let finished = false;

  start();

  async function start() {
    let works = [];
    try {
      works = (await (await fetch('/api/works')).json()).works || [];
    } catch (err) {
      console.error(err);
    }
    // 読み込めた画像だけを使う（読み込み前に始めると真っ白な時間ができるので、先に読み込んでおく）
    const images = (await Promise.all(works.slice(0, MAX_IMAGES).map((w) => preload(w.image)))).filter(Boolean);
    if (finished) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (images.length === 0 || reduceMotion) {
      // 作品がないとき（や動きを減らす設定のとき）は、タイトルとボタンだけをフェードインする
      showTitle(200);
      showButton(1400);
      return;
    }
    // 古い方から出して、最後に最新の作品が正面を通り抜けるようにする
    const ordered = images.reverse();
    const offset = PATHS.length - ordered.length;
    ordered.forEach((img, i) => {
      const [x, y] = PATHS[offset + i];
      img.className = 'opening-card';
      img.style.setProperty('--x', `${x}vw`);
      img.style.setProperty('--y', `${y}vh`);
      img.style.animationDuration = `${FLY_MS}ms`;
      img.style.animationDelay = `${i * STAGGER_MS}ms`;
      stage.appendChild(img);
    });
    const lastStart = (ordered.length - 1) * STAGGER_MS;
    // 最後の 1 枚が通り過ぎる頃にタイトル、続いてボタン（ボタンまで約 5 秒）
    showTitle(lastStart + 1800);
    showButton(lastStart + 2800);
  }

  function preload(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      const timer = setTimeout(() => resolve(null), PRELOAD_TIMEOUT_MS);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    });
  }

  function showTitle(delay) {
    timers.push(setTimeout(() => opening.classList.add('show-title'), delay));
  }

  function showButton(delay) {
    timers.push(setTimeout(finish, delay));
  }

  // ボタンが出た状態（最後の場面）
  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    opening.classList.add('show-title', 'show-button');
  }

  function skip() {
    if (finished) return;
    opening.classList.add('skipped'); // 飛んでいる画像を消す
    finish();
  }

  function enter() {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // 保存できなくても入館はできる
    }
    opening.classList.add('leaving');
    document.body.classList.remove('opening-active');
    setTimeout(() => opening.remove(), 900);
  }

  enterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    enter();
  });
  opening.addEventListener('click', skip);
  window.addEventListener('keydown', function onKey(e) {
    if (!opening.isConnected || opening.classList.contains('leaving')) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (['Escape', 'Enter', ' '].includes(e.key)) {
      e.preventDefault(); // 美術館側のキー操作を動かさない
      if (finished && e.key !== 'Escape') enter();
      else skip();
    }
  });
})();
