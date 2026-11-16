
const train = document.getElementById("train");
const sceneryTrack = document.getElementById("sceneryTrack");
const sleepers = document.getElementById("sleepers");
const platform = document.getElementById("platform");
const sky = document.getElementById("sky");
const sceneryImageLayer = document.getElementById("sceneryImageLayer");
const sceneButtons = [...document.querySelectorAll("[data-scene-choice]")];
const railway = document.getElementById("railway");
const smokeLayer = document.getElementById("smokeLayer");
const sparkCanvas = document.getElementById("sparkCanvas");
const sparkCtx = sparkCanvas.getContext("2d");

// 1. 列車・背景・線路パーツの基本設定
let trainX = 0;
let worldX = 0;
let moveLeft = false;
let moveRight = false;
const trainRange = 15;
let currentSpeed = 0;
const initialSpeed = 1;
const acceleration = 0.08;
const maxSpeed = 6;
const deceleration = 0.12;
// ===== 背景の速度設定（線路の移動量＝1を基準にした倍率） =====
// 【通常走行】空・近景・線路＝1、遠景＝0.6。
// 季節切り替えは3層共通の進行度で制御し、つなぎ画像の開始・終了を同期。
const skySpeed = 0.1;      // 空（通常時）
const scenerySpeed = 0.30;  // 遠景（通常時）
const platformSpeed = 1.00; // 近景。線路はworldXをそのまま使うので常に同速。

//列車画像読み込み
const TRAIN_PARTS = [
  { file: "images/train_04.gif", width: 624, height: 330, bounceOrder: 4 },
  { file: "images/train_03.gif", width: 624, height: 330, bounceOrder: 3 },
  { file: "images/train_02.gif", width: 624, height: 330, bounceOrder: 2 },
  { file: "images/train_01.gif", width: 624, height: 330, bounceOrder: 1 },
  { file: "images/train0.png",   width: 651, height: 330, bounceOrder: 0 }
];

// 列車が進んでいる間だけ、先頭から後方へ順番に小さな上下の揺れが伝わる
const trainBouncePeriod = 1450;    // 1回の揺れの周期（ミリ秒）
const trainBounceDelay = 150;      // 隣の車両へ伝わるまでの時間（ミリ秒）
const trainBounceHeight = 2.5;     // 最大の持ち上がり（CSSピクセル）
const trainBounceActiveRatio = 0.2; // 周期のうち車体が揺れている割合
const trainCars = [];
let trainBounceTime = 0;
let trainBounceStrength = 0;

function createTrainCars() {
  const fragment = document.createDocumentFragment();

  for (const part of TRAIN_PARTS) {
    const image = document.createElement("img");
    image.className = "train-car";
    image.src = part.file;
    image.width = part.width;
    image.height = part.height;
    image.alt = "";
    image.draggable = false;
    image.dataset.bounceOrder = String(part.bounceOrder);
    image.addEventListener("load", () => { layoutDirty = true; });
    image.addEventListener("error", () => {
      console.error(`列車画像を読み込めませんでした: ${part.file}`);
    });
    fragment.appendChild(image);
    trainCars.push(image);
  }

  train.replaceChildren(fragment);
}

function updateTrainBounce(dt) {
  // 速度0なら止まり、加減速にあわせて揺れ幅も滑らかに変化させる
  const speedRatio = Math.min(Math.abs(currentSpeed) / maxSpeed, 1);
  const targetStrength = speedRatio > 0.01
    ? 0.4 + 0.6 * speedRatio
    : 0;

  trainBounceStrength +=
    (targetStrength - trainBounceStrength) * Math.min(1, 0.12 * dt);

  if (speedRatio > 0.01) {
    trainBounceTime += dt * (1000 / 60);
  }

  for (const image of trainCars) {
    const order = Number(image.dataset.bounceOrder);
    // 負の剰余を補正して、後ろの車両が動き始める前は静止させる
    const elapsed = trainBounceTime - order * trainBounceDelay;
    const phase = ((elapsed % trainBouncePeriod) + trainBouncePeriod)
      % trainBouncePeriod / trainBouncePeriod;

    const pulse = phase < trainBounceActiveRatio
      ? Math.sin(Math.PI * phase / trainBounceActiveRatio)
      : 0;

    const offsetY = -pulse * trainBounceHeight * trainBounceStrength;
    image.bounceY = offsetY;
    image.style.transform = `translate3d(0, ${offsetY.toFixed(2)}px, 0)`;
  }
}

// ========================================
// 煙の描画設定（調整する場合はここを変更）
// ========================================
const SMOKE_IMAGES = [
  { file: "images/smoke_01.png", ratio: 133 / 198 },
  { file: "images/smoke_02.png", ratio: 156 / 239 },
  { file: "images/smoke_03.png", ratio: 148 / 211 },
  { file: "images/smoke_04.png", ratio: 180 / 256 }
];

const SMOKE_CONFIG = {
  // 先頭車両（train0.png）の画像内での煙突の位置。左上が(0, 0)、右下が(1, 1)。
  chimneyX: 0.81,             // 左右位置：大きいほど右へ
  chimneyY: 0.08,             // 上下位置：大きいほど下へ
  offsetX: 0,                 // 最後の微調整（px）
  offsetY: -7,

  minCount: 4,                // 常に表示しておく煙パーツの最少個数
  maxCount: 8,                // 最大個数
  emissionIntervalMin: 300,  // 煙の発生間隔：短いほど密度が上がる（ms）
  emissionIntervalMax: 540,
  lifeMin: 2000,              // 煙の寿命（ms）
  lifeMax: 3200,
  widthMin: 49,               // パーツの元サイズ（CSS px）
  widthMax: 69,
  upwardSpeedMin: 18,        // 上昇速度（px/秒）
  upwardSpeedMax: 32,
  trainDrift: 0.28,           // 煙が流れる強さ
  horizontalJitter: 6        // 停車中もゆっくり左右へ揺れる幅（px/秒）
};

const smokePuffs = [];
let nextSmokeTime = 0;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// train0.pngの表示位置から、煙突の先端のスクリーン座標を計算する。
// 列車全体の左右移動や、先頭車両の上下の揺れにも追従する。
function getChimneyPosition() {
  const engine = trainCars[trainCars.length - 1];
  return {
    x: layout.engineX + trainX + layout.engineWidth * SMOKE_CONFIG.chimneyX + SMOKE_CONFIG.offsetX,
    y: layout.engineY + (engine.bounceY || 0) + layout.engineHeight * SMOKE_CONFIG.chimneyY + SMOKE_CONFIG.offsetY
  };
}

function createSmokePuff(initialAge = 0) {
  if (smokePuffs.length >= SMOKE_CONFIG.maxCount) return;

  const source = SMOKE_IMAGES[Math.floor(Math.random() * SMOKE_IMAGES.length)];
  const start = getChimneyPosition();
  const width = randomBetween(SMOKE_CONFIG.widthMin, SMOKE_CONFIG.widthMax);
  const life = randomBetween(SMOKE_CONFIG.lifeMin, SMOKE_CONFIG.lifeMax);
  const age = Math.min(initialAge, life * 0.8);
  const rise = randomBetween(
    SMOKE_CONFIG.upwardSpeedMin, SMOKE_CONFIG.upwardSpeedMax
  );
  const drift = randomBetween(
    -SMOKE_CONFIG.horizontalJitter, SMOKE_CONFIG.horizontalJitter
  );

  const image = document.createElement("img");
  image.className = "smoke-puff";
  image.src = source.file;
  image.alt = "";
  image.draggable = false;
  image.style.width = `${width}px`;
  image.addEventListener("error", () => {
    console.error(`煙画像を読み込めませんでした: ${source.file}`);
  });
  smokeLayer.appendChild(image);

  smokePuffs.push({
    image,
    x: start.x + randomBetween(-5, 5) + drift * (age / 1000),
    y: start.y - rise * (age / 1000),
    width,
    height: width * source.ratio,
    age,
    life,
    rise,
    drift,
    rotation: randomBetween(-7, 7),
    swayPhase: randomBetween(0, Math.PI * 2)
  });
}

function initializeSmoke() {
  // 初回から煙が4～6個見えるよう、異なる経過時間のパーツを配置する。
  for (let i = 0; i < 5; i++) {
    createSmokePuff(i * 440);
  }
  nextSmokeTime = performance.now() + randomBetween(
    SMOKE_CONFIG.emissionIntervalMin, SMOKE_CONFIG.emissionIntervalMax
  );
}

function updateSmoke(now, dt) {
  const seconds = dt / 60;

  for (let i = smokePuffs.length - 1; i >= 0; i--) {
    const puff = smokePuffs[i];
    puff.age += seconds * 1000;

    if (puff.age >= puff.life) {
      puff.image.remove();
      smokePuffs.splice(i, 1);
      continue;
    }

    // 停車中も上昇。右走行中は左、左走行中は右へ流れる。
    // currentSpeedは60fps時の1フレーム当たりの移動量。
    puff.x += puff.drift * seconds
      - currentSpeed * SMOKE_CONFIG.trainDrift * dt;
    puff.y -= puff.rise * seconds;

    const progress = puff.age / puff.life;
    const scale = 0.70 + 0.65 * progress;
    const fadeIn = Math.min(1, puff.age / 260);
    const fadeOut = Math.min(1, (puff.life - puff.age) / 520);
    const opacity = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.94;
    const sway = Math.sin(puff.age / 400 + puff.swayPhase) * 2.5;

    // 元画像のサイズ比を維持して拡大。中心座標から配置する。
    puff.image.style.transform =
      `translate3d(${(puff.x - puff.width / 2 + sway).toFixed(2)}px, ` +
      `${(puff.y - puff.height / 2).toFixed(2)}px, 0) ` +
      `rotate(${puff.rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    puff.image.style.opacity = opacity.toFixed(3);
  }

  // 寿命で消えた分は補充し、停車中でも生成し続ける。
  while (smokePuffs.length < SMOKE_CONFIG.minCount) {
    createSmokePuff();
  }

  if (now >= nextSmokeTime) {
    if (smokePuffs.length < SMOKE_CONFIG.maxCount) {
      createSmokePuff();
    }
    nextSmokeTime = now + randomBetween(
      SMOKE_CONFIG.emissionIntervalMin, SMOKE_CONFIG.emissionIntervalMax
    );
  }
}

// 線路のサイズ・位置・重なり幅は index.css の #railway で一括調整する。
// 幅110px・重なり4pxの場合、次のタイルを106px先に配置する。
const railStyles = getComputedStyle(railway);
function getRailSetting(name, fallback) {
  const value = parseFloat(railStyles.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

const sleeperImageWidth = Math.max(1, getRailSetting("--rail-tile-width", 110));
const sleeperImageHeight = Math.max(1, getRailSetting("--rail-tile-height", 73.333));
const sleeperTop = getRailSetting("--rail-tile-y", 25);
const sleeperOverlap = Math.max(0, getRailSetting("--rail-overlap", 4));
const sleeperSpacing = Math.max(1, sleeperImageWidth - sleeperOverlap);

// 新しい線路は、下から上昇・拡大・フェードインして定位置に収まる
const sleeperRiseDistance = 48; // 生成位置から上昇する距離 (px)
const sleeperStartScale = 0.88; // 出現時の縮小率
const sleeperAppearDuration = 650;
const sleeperAhead = 210;
const particleCount = 8;

const sleeperMap = new Map();
const appearingSleepers = new Set();
const sleeperBuffer = 300;
let railWindowKey = "";
let maxCreatedIndex = 0;
let minCreatedIndex = -3;
const particles = [];
let canvasWidth = 0;
let canvasHeight = 0;
let lastFrame = 0;

// 2. 空画像と切り替え設定
// 空はsky_01～11、遠景はfar_01～11、近景はnear_01～11。
// 今回の遠景・近景はすべて1920×1080。空は実際の画像比率を使用。
// 奇数は左右がつながる通常シーン、偶数は前後のシーンをつなぐ1回限りの画像。
// 順番: SPACE(01 -> 02 -> 03), ボタン1(03 -> 04 -> 05),
//         ボタン2(05 -> 06 -> 07), ボタン3(07 -> 08 -> 09),
//         ボタン4(09 -> 10 -> 11)
const SCENE_IMAGES = {
  initial: {
    sky: "images/sky_01.png",
    scenery: "images/far_01.png",
    platform: "images/near_01.png"
  },
  routes: {
    0: {
      bridge: { sky: "images/sky_02.png", scenery: "images/far_02.png", platform: "images/near_02.png" },
      destination: { sky: "images/sky_03.png", scenery: "images/far_03.png", platform: "images/near_03.png" }
    },
    1: {
      bridge: { sky: "images/sky_04.png", scenery: "images/far_04.png", platform: "images/near_04.png" },
      destination: { sky: "images/sky_05.png", scenery: "images/far_05.png", platform: "images/near_05.png" }
    },
    2: {
      bridge: { sky: "images/sky_06.png", scenery: "images/far_06.png", platform: "images/near_06.png" },
      destination: { sky: "images/sky_07.png", scenery: "images/far_07.png", platform: "images/near_07.png" }
    },
    3: {
      bridge: { sky: "images/sky_08.png", scenery: "images/far_08.png", platform: "images/near_08.png" },
      destination: { sky: "images/sky_09.png", scenery: "images/far_09.png", platform: "images/near_09.png" }
    },
    4: {
      bridge: { sky: "images/sky_10.png", scenery: "images/far_10.png", platform: "images/near_10.png" },
      destination: { sky: "images/sky_11.png", scenery: "images/far_11.png", platform: "images/near_11.png" }
    }
  }
};

const sceneLayers = {
  sky: {
    element: sky,
    speed: skySpeed,
    segments: []
  },
  scenery: {
    element: sceneryImageLayer,
    speed: scenerySpeed,
    segments: []
  },
  platform: {
    element: platform,
    speed: platformSpeed,
    segments: []
  }
};

// 表示サイズはレイアウト計測時に更新。移動倍率には画面高を掛けない。
// 寸法取得は初期化・画像読み込み後・リサイズ時だけ行う。
const layout = { width: 1, height: 1, trainRight: 0, engineX: 0,
  engineY: 0, engineWidth: 0, engineHeight: 0, railTop: 0, canvasTop: 0 };
let layoutDirty = true;
let backgroundDirty = true;
let lastBackgroundWorldX = NaN;
let buttonStateKey = "";
function measureLayout() {
  const worldRect = document.getElementById("world").getBoundingClientRect();
  // キャンバス高さの変更時はスクロール座標も同比率で拡大縮小し、
  // 画像の端と既に予約した切り替えを同じ場所に保つ。
  const oldHeight = layout.height;
  if (oldHeight > 1 && Math.abs(worldRect.height - oldHeight) > 0.01) {
    const factor = worldRect.height / oldHeight;
    worldX *= factor;
    for (const event of sceneHistory) event.requestWorld *= factor;
    railWindowKey = "";
  }
  const trainRect = train.getBoundingClientRect();
  const engine = trainCars[trainCars.length - 1];
  const engineRect = engine.getBoundingClientRect();
  const railRect = railway.getBoundingClientRect();
  const smokeRect = smokeLayer.getBoundingClientRect();
  layout.width = Math.max(1, worldRect.width);
  layout.height = Math.max(1, worldRect.height);
  layout.trainRight = trainRect.right - railRect.left - trainX;
  layout.engineX = engineRect.left - smokeRect.left - trainX;
  layout.engineY = engineRect.top - smokeRect.top - (engine.bounceY || 0);
  layout.engineWidth = engineRect.width;
  layout.engineHeight = engineRect.height;
  layout.railTop = railRect.top;
  layout.canvasTop = sparkCanvas.getBoundingClientRect().top;
  layoutDirty = false;
  backgroundDirty = true;
}

function sceneLayerSpeed(layer) {
  // 画面をリサイズしても近景＝1のままにし、線路との速度差を防ぐ。
  return layer.speed;
}

// 切り替え予告は画面右側から少し先。単位はCSSピクセル。
const sceneChangeAhead = 100;
// 切り替え開始前に、遠景がつなぎ画像の端へ接続するまでの助走距離。
// この範囲ではつなぎ画像は画面に表示されない。
const transitionPrepareRatio = 0.45; // 画面幅に対する倍率
// つなぎの末尾が画面左から消えた後、遠景を0.6倍に戻す距離。
const transitionRestoreRatio = 0.50;
const sceneHistory = [];
const imageMetadata = new Map();

// 3. 背景画像の事前読み込み
// 最初は朝＋次のつなぎ・春だけを読み込み、一度に33枚を要求しない。
function loadSceneFiles(paths) {
  for (const path of paths.filter(Boolean)) {
    if (imageMetadata.has(path)) continue;
    const image = new Image();
    const metadata = { image, loaded: false, error: false, ratio: 0 };
    imageMetadata.set(path, metadata);
    image.onload = () => {
      metadata.loaded = true;
      metadata.ratio = image.naturalWidth / image.naturalHeight;
      backgroundDirty = true;
      rebuildSceneTimelines();
      updateSceneButtons();
    };
    image.onerror = () => {
      metadata.error = true;
      console.error(`背景画像を読み込めませんでした: ${path}`);
      updateSceneButtons();
    };
    image.src = path;
  }
}
function preloadRoute(choice) {
  const route = SCENE_IMAGES.routes[choice];
  if (route) loadSceneFiles([...Object.values(route.bridge), ...Object.values(route.destination)]);
}
function preloadSceneImages() {
  loadSceneFiles(Object.values(SCENE_IMAGES.initial));
  preloadRoute(0);
}

function imageIsReady(file) {
  return !!file &&
    imageMetadata.get(file)?.loaded === true;
}

function imageWidth(file, element) {
  const ratio = imageMetadata.get(file)?.ratio || 0;

  return layout.height * ratio;
}

// 4. 光エフェクト用Canvasのサイズ設定
function resizeCanvas() {
  const rect = sparkCanvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  canvasWidth = rect.width;
  canvasHeight = rect.height;

  sparkCanvas.width = Math.round(canvasWidth * ratio);
  sparkCanvas.height = Math.round(canvasHeight * ratio);

  sparkCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function getTrainRight() {
  return layout.trainRight + trainX;
}

// 5. 線路パーツ（rail_00.png）の作成
function addSleeper(index, appearing, now) {
  if (sleeperMap.has(index)) return;

  const element = document.createElement("div");
  element.className = "sleeper";
  element.style.left = `${index * sleeperSpacing}px`;
  element.style.opacity = appearing ? "0" : "1";

  // 新しい線路だけ、完成位置より下に小さく配置する。
  if (appearing) {
    element.style.transform =
      `translate3d(0, ${sleeperRiseDistance}px, 0) ` +
      `scale(${sleeperStartScale})`;
  }

  if (appearing) {
    appearingSleepers.add(index);
    element.style.willChange = "transform, opacity";
  }
  sleepers.appendChild(element);
  sleeperMap.set(index, {
    element,
    state: appearing ? "appearing" : "placed",
    startTime: now,
    sparkled: false
  });
}

// 6. 最初から存在する線路の作成
function createInitialSleepers() {
  maxCreatedIndex = Math.ceil((getTrainRight() + sleeperAhead + worldX) / sleeperSpacing);
  spawnNewSleepers(0);
}

// 表示範囲周辺だけを保持。通過済みの線路は逆走時に静止状態で再生成する。
function spawnNewSleepers(now) {
  const oldMax = maxCreatedIndex;
  const target = Math.ceil((getTrainRight() + sleeperAhead + worldX) / sleeperSpacing);
  maxCreatedIndex = Math.max(maxCreatedIndex, target);
  const left = Math.floor((worldX - sleeperBuffer) / sleeperSpacing);
  const right = Math.min(maxCreatedIndex,
    Math.ceil((worldX + layout.width + sleeperBuffer) / sleeperSpacing));
  const key = `${left}:${right}:${maxCreatedIndex}`;
  if (key === railWindowKey) return;
  railWindowKey = key;
  for (const [index, item] of sleeperMap) {
    if (index < left || index > right) {
      item.element.remove();
      sleeperMap.delete(index);
      appearingSleepers.delete(index);
    }
  }
  for (let index = left; index <= right; index++) {
    addSleeper(index, index > oldMax, now);
  }
}

// 8. 新しい線路が現れる際の光エフェクト
function createLightParticles(
  screenX,
  count = particleCount
) {
  // Canvasと線路の位置の違いを補正
  const railwayTop =
    layout.railTop;

  const canvasTop =
    layout.canvasTop;

  const y =
    railwayTop -
    canvasTop +
    sleeperTop +
    sleeperImageHeight * 0.9;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.45 + Math.random() * 1.6;

    particles.push({
      worldX: screenX + worldX,

      y: y + (Math.random() - 0.5) * 20,

      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.8,

      life: 1,
      decay: 0.012 + Math.random() * 0.014,
      radius: 1.2 + Math.random() * 2.2
    });
  }
}

// 9. 滑らかな補間関数
function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

// 10. 線路のスクロールと出現処理
// 新しい線路だけ下から上昇し、設置後はランダムに上下移動しない。
function updateSleepers(now) {
  // 線路全体は左右方向にのみスクロール
  sleepers.style.transform = `translate3d(${-worldX}px, 0, 0)`;

  for (const index of appearingSleepers) {
    const item = sleeperMap.get(index);

    const t = Math.min(
      Math.max((now - item.startTime) / sleeperAppearDuration, 0),
      1
    );

    // 元の「最初は速く、終わりはゆっくり上昇する」動きを復元
    const ease = 1 - Math.pow(1 - t, 3);
    const riseY = sleeperRiseDistance * (1 - ease);
    const scale = sleeperStartScale + (1 - sleeperStartScale) * ease;
    const visibility = smoothStep(t);

    item.element.style.transform =
      `translate3d(0, ${riseY}px, 0) scale(${scale})`;
    item.element.style.opacity = `${visibility}`;

    // 元と同じタイミングで光の粒を発生させる
    if (!item.sparkled && t >= 0.24) {
      const screenX = index * sleeperSpacing + sleeperImageWidth / 2 - worldX;
      createLightParticles(screenX);
      item.sparkled = true;
    }

    if (t >= 1) {
      item.state = "placed";
      appearingSleepers.delete(index);
      item.element.style.willChange = "auto";
      // 固定位置に戻した後は、何もアニメーションさせない
      item.element.style.transform = "none";
      item.element.style.opacity = "1";
    }
  }
}

// 11. 光の粒の更新
function updateParticles(dt) {
  sparkCtx.clearRect(
    0,
    0,
    canvasWidth,
    canvasHeight
  );

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.worldX += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.012 * dt;
    p.life -= p.decay * dt;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const x = p.worldX - worldX;
    const glow = p.radius * 5;

    const gradient =
      sparkCtx.createRadialGradient(
        x, p.y, 0,
        x, p.y, glow
      );

    gradient.addColorStop(
      0,
      `rgba(255,250,215,${p.life})`
    );

    gradient.addColorStop(
      0.3,
      `rgba(255,221,140,${p.life * 0.6})`
    );

    gradient.addColorStop(
      1,
      "rgba(255,221,140,0)"
    );

    sparkCtx.fillStyle = gradient;

    sparkCtx.beginPath();
    sparkCtx.arc(
      x, p.y, glow,
      0, Math.PI * 2
    );
    sparkCtx.fill();
  }
}

// 12. 背景スクロール
function updateBackground() {
  if (backgroundDirty || worldX !== lastBackgroundWorldX) {
    updateSceneBackgrounds();
    lastBackgroundWorldX = worldX;
    backgroundDirty = false;
  }
  // ボタンは状態が変わったときのみ更新する。
  const last = sceneHistory[sceneHistory.length - 1];
  const key = `${sceneHistory.length}:${!last || worldX >= last.bridgeEndWorldX}`;
  if (key !== buttonStateKey) {
    buttonStateKey = key;
    updateSceneButtons();
  }
}

// 13. 列車の移動
function updateTrain(dt = 1) {
  const direction = moveLeft === moveRight ? 0 : moveRight ? 1 : -1;
  // 固定刻み＋端数で積分し、60/120Hz等の速度差を抑える。
  let remaining = dt;
  while (remaining > 0.000001) {
    const step = Math.min(1, remaining);
    remaining -= step;
    if (direction) {
      if (currentSpeed * direction <= 0) {
        if (currentSpeed === 0) currentSpeed = initialSpeed * direction;
        else {
          currentSpeed += deceleration * direction * step;
          if (currentSpeed * direction >= 0) currentSpeed = initialSpeed * direction;
        }
      } else currentSpeed += acceleration * direction * step;
    } else {
      const amount = deceleration * step;
      currentSpeed = currentSpeed > 0 ? Math.max(0, currentSpeed - amount)
        : Math.min(0, currentSpeed + amount);
    }
    currentSpeed = Math.max(-maxSpeed, Math.min(maxSpeed, currentSpeed));
    trainX += currentSpeed * step;
    if (trainX > trainRange) { worldX += trainX - trainRange; trainX = trainRange; }
    if (trainX < -trainRange) { worldX += trainX + trainRange; trainX = -trainRange; }
  }
  train.style.setProperty("--train-x", `${trainX}px`);
}

// 14. アニメーションのメインループ
function animate(now) {
  const dt = lastFrame
    ? Math.min(
        (now - lastFrame) / (1000 / 60),
        3
      )
    : 1;

  lastFrame = now;

  if (layoutDirty) {
    measureLayout();
    resizeCanvas();
    rebuildSceneTimelines();
  }
  updateTrain(dt);
  updateTrainBounce(dt);
  updateSmoke(now, dt);
  updateBackground();
  spawnNewSleepers(now);
  updateSleepers(now);
  updateParticles(dt);

  requestAnimationFrame(animate);
}

// 15. キーボード操作
function handleMoveKey(event, pressed) {
  // スペースキーは最初の空の切り替えだけに使用する。
  // keydownの連続発火は無視するため、押しっぱなしでも1回しか切り替わらない。
  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    if (pressed && !event.repeat) selectScene(0);
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "a" || key === "arrowleft") {
    moveLeft = pressed;
    event.preventDefault();
  }

  if (key === "d" || key === "arrowright") {
    moveRight = pressed;
    event.preventDefault();
  }
}

document.addEventListener(
  "keydown",
  (event) => handleMoveKey(event, true)
);

document.addEventListener(
  "keyup",
  (event) => handleMoveKey(event, false)
);

window.addEventListener("blur", () => {
  moveLeft = false;
  moveRight = false;
});

window.addEventListener("resize", () => { layoutDirty = true; });
document.addEventListener("visibilitychange", () => {
  moveLeft = false;
  moveRight = false;
  lastFrame = 0;
});

// 16. 方法①：3層共通の「季節の切り替え進行度」
// ─────────────────────────────────────────────────────────────
// 通常移動は 空=1.0 / 遠景=0.6 / 近景=1.0 / 線路=1.0。
// つなぎ中は共通の progress(0～1) を全レイヤーで使用。
// 偶数画像は変形せず、画像の左端から右端までを全レイヤーで同時に通過する。
// 近景は常に worldX に追従し、線路と完全に同速。
// 遠景は通常時のタイル位相とつなぎの左右端を一致させるため、
// 画面にまだつなぎが見えない「準備区間」でなめらかに位相調整する。
// 切り替え後の遠景は通常速度0.6へゆっくり戻る。
// 進行度は時間ではなく列車が進んだ距離で決定するため、停止・逆走にも対応。

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// 位相調整区間では位置と両端の速度を一致させる。
function hermitePosition(from, to, fromSpeed, toSpeed, u, distance) {
  const t = clamp01(u);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * from
    + (t3 - 2 * t2 + t) * distance * fromSpeed
    + (-2 * t3 + 3 * t2) * to
    + (t3 - t2) * distance * toSpeed;
}

function hermiteSpeed(from, to, fromSpeed, toSpeed, u, distance) {
  const t = clamp01(u);
  const t2 = t * t;
  const average = (to - from) / Math.max(1, distance);
  return (6 * t - 6 * t2) * average
    + (3 * t2 - 4 * t + 1) * fromSpeed
    + (3 * t2 - 2 * t) * toSpeed;
}

// つなぎ終了後の速度復帰（速度の変化が両端で0になるsmoothstepを積分）。
function settledDistance(distanceTraveled, duration, startSpeed, endSpeed) {
  if (duration <= 0) return 0;
  const u = clamp01(distanceTraveled / duration);
  return duration * (startSpeed * u
    + (endSpeed - startSpeed) * (u ** 3 - 0.5 * u ** 4));
}

// 全レイヤー共通の季節進行度。0:つなぎが画面右端に入る / 1:完全に抜ける。
function transitionProgress(event, position) {
  return clamp01((position - event.lockWorldX)
    / (event.bridgeEndWorldX - event.lockWorldX));
}

// 通常走行では独立した速度、つなぎ中は共通進行度で画像を送る。
// 各ルートの終わりは固定された仮想座標に記録されるため、逆走も連続する。
function sceneScrollAt(type, position, events = sceneHistory) {
  const speed = sceneLayers[type].speed;
  let anchorWorld = 0;
  let anchorScroll = 0;
  for (const event of events) {
    const plan = event.plans[type];
    if (position < event.requestWorld) {
      return anchorScroll + (position - anchorWorld) * speed;
    }
    if (position < event.lockWorldX) {
      const distance = event.lockWorldX - event.requestWorld;
      return hermitePosition(plan.requestScroll, plan.entryScroll,
        speed, plan.transitionSpeed,
        (position - event.requestWorld) / distance, distance);
    }
    if (position < event.bridgeEndWorldX) {
      // 3層すべて同じ進行度を利用。元画像は拡大縮小しない。
      return plan.entryScroll + transitionProgress(event, position)
        * plan.transitionDistance;
    }
    if (position < event.settleEndWorldX) {
      return plan.bridgeEndScroll
        + settledDistance(position - event.bridgeEndWorldX,
          event.settleEndWorldX - event.bridgeEndWorldX,
          plan.transitionSpeed, speed);
    }
    anchorWorld = event.settleEndWorldX;
    anchorScroll = plan.settleScroll;
  }
  return anchorScroll + (position - anchorWorld) * speed;
}

function layerPlanIsSmooth(plan, event, layer) {
  const preparationDistance = event.lockWorldX - event.requestWorld;
  if (preparationDistance <= 0) return false;
  // 滑らかさを優先し、位相調整区間での逆走や極端な加速を避ける。
  const minAllowed = 0.08;
  const maxAllowed = 1.45;
  for (let step = 0; step <= 50; step++) {
    const velocity = hermiteSpeed(plan.requestScroll, plan.entryScroll,
      layer.speed, plan.transitionSpeed, step / 50, preparationDistance);
    if (!Number.isFinite(velocity) || velocity < minAllowed || velocity > maxAllowed) {
      return false;
    }
  }
  return true;
}

// 各レイヤーの「通常画像の整数枚目」につなぎ画像の左端を接続。
// 位相調整はつなぎ表示前だけで完了させ、切り替え本体は共通進行度に任せる。
function computeLayerPlan(type, event, priorEvents) {
  const layer = sceneLayers[type];
  const route = SCENE_IMAGES.routes[event.choice];
  const previous = priorEvents[priorEvents.length - 1];
  const oldFile = previous
    ? SCENE_IMAGES.routes[previous.choice].destination[type]
    : SCENE_IMAGES.initial[type];
  const normalWidth = imageWidth(oldFile, layer.element);
  const bridgeWidth = imageWidth(route.bridge[type], layer.element);
  if (normalWidth <= 0 || bridgeWidth <= 0) return null;

  const origin = previous ? previous.plans[type].bridgeEndScroll : 0;
  const requestScroll = sceneScrollAt(type, event.requestWorld, priorEvents);
  const progressLength = event.bridgeEndWorldX - event.lockWorldX;
  const transitionDistance = layout.width + bridgeWidth;
  const transitionSpeed = transitionDistance / progressLength;
  const preparationLength = event.lockWorldX - event.requestWorld;
  const expectedEntryScroll = requestScroll
    + preparationLength * (layer.speed + transitionSpeed) * 0.5;
  const suggestedIndex = Math.round(
    (expectedEntryScroll + layout.width - origin) / normalWidth);
  // 近景は線路と同じ速度1で動くためタイル番号を固定する。
  const candidates = type === 'platform'
    ? [event.tileIndex]
    : [suggestedIndex, suggestedIndex - 1, suggestedIndex + 1,
      suggestedIndex - 2, suggestedIndex + 2,
      suggestedIndex - 3, suggestedIndex + 3];
  let chosen = null;
  let bestScore = Infinity;
  for (const index of candidates) {
    if (index < 1) continue;
    const bridgeStartScroll = origin + index * normalWidth;
    const bridgeEndScroll = bridgeStartScroll + bridgeWidth;
    const entryScroll = bridgeStartScroll - layout.width;
    const restoreDistance = event.settleEndWorldX - event.bridgeEndWorldX;
    const settleScroll = bridgeEndScroll
      + restoreDistance * (transitionSpeed + layer.speed) * 0.5;
    const plan = {
      requestScroll, entryScroll,
      bridgeStartScroll, bridgeEndScroll, settleScroll,
      transitionDistance, transitionSpeed,
      normalWidth, bridgeWidth, tileIndex: index
    };
    if (!layerPlanIsSmooth(plan, event, layer)) continue;
    const score = Math.abs(entryScroll - expectedEntryScroll);
    if (score < bestScore) {
      chosen = plan;
      bestScore = score;
    }
  }
  return chosen;
}

// ボタンが早めに押されても、前の遠景速度復帰の終了後に次の準備を開始する。
// 表示済みの画像を切り貼りせず、次の通常画像の整数枚先に接続する。
function makeSynchronizedEvent(choice, requestedWorldX, tileIndex, priorEvents) {
  const previous = priorEvents[priorEvents.length - 1];
  const requestWorld = Math.max(requestedWorldX,
    previous ? previous.settleEndWorldX : requestedWorldX);
  const priorNearOrigin = previous ? previous.plans.platform.bridgeEndScroll : 0;
  const oldNearFile = previous
    ? SCENE_IMAGES.routes[previous.choice].destination.platform
    : SCENE_IMAGES.initial.platform;
  const nearNormalWidth = imageWidth(oldNearFile, platform);
  const nearBridgeWidth = imageWidth(SCENE_IMAGES.routes[choice].bridge.platform, platform);
  if (nearNormalWidth <= 0 || nearBridgeWidth <= 0) return null;

  const preparation = Math.max(600, layout.width * transitionPrepareRatio);
  const minBridgeStart = requestWorld + layout.width + preparation + sceneChangeAhead;
  const minTileIndex = Math.max(1,
    Math.ceil((minBridgeStart - priorNearOrigin) / nearNormalWidth));
  const restore = Math.max(700, layout.width * transitionRestoreRatio);

  for (let n = Math.max(tileIndex || 1, minTileIndex);
    n < minTileIndex + 48; n++) {
    // 近景は補正不要。近景/線路の座標は同じworldXを直接使用する。
    const bridgeStart = priorNearOrigin + n * nearNormalWidth;
    const startVisible = bridgeStart - layout.width;
    const bridgeFinished = bridgeStart + nearBridgeWidth;
    const event = {
      choice, requestWorld, tileIndex: n,
      lockWorldX: startVisible,
      startWorldX: bridgeStart,
      bridgeEndWorldX: bridgeFinished,
      settleEndWorldX: bridgeFinished + restore,
      plans: {}
    };
    let valid = true;
    for (const type of Object.keys(sceneLayers)) {
      const plan = computeLayerPlan(type, event, priorEvents);
      if (!plan) { valid = false; break; }
      event.plans[type] = plan;
    }
    if (valid) {
      event.endWorldX = event.bridgeEndWorldX;
      return event;
    }
  }
  return null;
}

function rebuildSceneTimelines() {
  // リサイズ時は表示幅と接続座標を再計算。季節の選択順は維持。
  const rebuilt = [];
  for (const event of sceneHistory) {
    const fresh = makeSynchronizedEvent(
      event.choice, event.requestWorld, event.tileIndex, rebuilt);
    if (!fresh) {
      console.warn('季節の接続位置を再計算できませんでした。', event.choice);
      return;
    }
    Object.assign(event, fresh);
    rebuilt.push(event);
  }
  for (const [type, layer] of Object.entries(sceneLayers)) {
    let file = SCENE_IMAGES.initial[type];
    let from = -Infinity;
    let origin = 0;
    const segments = [];
    for (const event of rebuilt) {
      const route = SCENE_IMAGES.routes[event.choice];
      const plan = event.plans[type];
      segments.push({file, from, to: plan.bridgeStartScroll,
        origin, repeat: true});
      segments.push({file: route.bridge[type],
        from: plan.bridgeStartScroll, to: plan.bridgeEndScroll,
        origin: plan.bridgeStartScroll, repeat: false});
      file = route.destination[type];
      from = plan.bridgeEndScroll;
      origin = plan.bridgeEndScroll;
    }
    segments.push({file, from, to: Infinity, origin, repeat: true});
    layer.segments = segments;
  }
  backgroundDirty = true;
}

// 17. 背景表示用パネル作成
// 画面に見えるタイルだけを使い回す。背景の再描画・全画面clip-path更新を避ける。
function ensureScenePanels(layer) {
  backgroundDirty = true;
}

const backgroundOverlap = 0.5;
function updateSceneBackgrounds() {
  for (const [type, layer] of Object.entries(sceneLayers)) {
    const scrollX = sceneScrollAt(type, worldX);
    const visible = [];
    for (const segment of layer.segments) {
      const width = imageWidth(segment.file, layer.element);
      if (width <= 0 || segment.to <= scrollX || segment.from >= scrollX + layout.width) continue;
      const first = segment.repeat
        ? Math.floor((Math.max(scrollX, segment.from) - segment.origin) / width) : 0;
      const last = segment.repeat
        ? Math.ceil((Math.min(scrollX + layout.width, segment.to) - segment.origin) / width) - 1 : 0;
      for (let tile = first; tile <= last; tile++) {
        const start = segment.origin + tile * width;
        const left = Math.max(start, segment.from);
        const right = Math.min(start + width, segment.to);
        if (right <= left) continue;
        visible.push({file: segment.file, width, left, crop: start - left,
          span: right - left, repeat: segment.repeat});
      }
    }
    while (layer.element.children.length < visible.length) {
      const panel = document.createElement("div");
      panel.className = "scene-image-panel";
      layer.element.appendChild(panel);
    }
    // 不要なGPUレイヤーを保持しない。
    while (layer.element.children.length > visible.length) layer.element.lastElementChild.remove();
    visible.forEach((tile, i) => {
      const panel = layer.element.children[i];
      const key = `${tile.file}:${tile.width}:${tile.span}:${tile.crop}:${tile.repeat}`;
      if (panel.tileKey !== key) {
        panel.tileKey = key;
        panel.style.backgroundImage = `url("${tile.file}")`;
        panel.style.backgroundSize = `${tile.width}px 100%`;
        panel.style.backgroundRepeat = tile.repeat ? "repeat-x" : "no-repeat";
        panel.style.backgroundPositionX = `${tile.crop}px`;
        panel.style.width = `${tile.span + (tile.repeat ? backgroundOverlap : 0)}px`;
      }
      panel.style.transform = `translate3d(${tile.left - scrollX}px, 0, 0)`;
    });
  }
}

// 19. 背景切り替えボタン
function canSelectScene(choice) {
  const route = SCENE_IMAGES.routes[choice];

  if (!route) return false;

  // 0, 1, 2, 3, 4 をこの順に1回ずつ実行する。
  // 0はスペースキー専用、1～4は既存の4つのボタン用。
  // 次の通常画像の1枚目が画面に収まるまで、次のボタンは無効。
  // 全レイヤーでつなぎが画面から消えたら、2枚目を待たずに押せる。
  if (choice !== sceneHistory.length) return false;

  const last =
    sceneHistory[sceneHistory.length - 1];

  if (last && worldX < last.bridgeEndWorldX) {
    return false;
  }

  const currentSkyFile = last
    ? SCENE_IMAGES.routes[last.choice]
        .destination.sky
    : SCENE_IMAGES.initial.sky;

  const routeImages = [
    currentSkyFile,
    ...Object.values(route.bridge),
    ...Object.values(route.destination)
  ].filter(Boolean);

  return routeImages.every(imageIsReady);
}

function updateSceneButtons() {
  for (const button of sceneButtons) {
    button.disabled =
      !canSelectScene(
        Number(button.dataset.sceneChoice)
      );
  }
}

function selectScene(choice) {
  if (!canSelectScene(choice)) return;
  // 全画像の幅を実測済み。現在の worldX を起点に整列地点を決定。
  const event = makeSynchronizedEvent(choice, worldX, 1, sceneHistory);
  if (!event) {
    console.error("季節切り替えの連結位置を確保できませんでした。");
    return;
  }
  sceneHistory.push(event);
  rebuildSceneTimelines();
  backgroundDirty = true;
  preloadRoute(choice + 1);
  updateSceneButtons();
}

for (const button of sceneButtons) {
  button.addEventListener("click", () => {
    selectScene(
      Number(button.dataset.sceneChoice)
    );
  });
}

// 20. 初期化
createTrainCars();
measureLayout();
initializeSmoke();
platform.style.backgroundImage = "none";

preloadSceneImages();
rebuildSceneTimelines();
resizeCanvas();
createInitialSleepers();

requestAnimationFrame(animate);
