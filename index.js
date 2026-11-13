
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
const scenerySpeed = 0.8;
const skySpeed = 0.8;
// 3層の番号とつなぎの境界をそろえるため、同じ速度を使用する。
const platformSpeed = skySpeed;

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
  const rect = engine.getBoundingClientRect();
  const layerRect = smokeLayer.getBoundingClientRect();

  return {
    x: rect.left - layerRect.left + rect.width * SMOKE_CONFIG.chimneyX
      + SMOKE_CONFIG.offsetX,
    y: rect.top - layerRect.top + rect.height * SMOKE_CONFIG.chimneyY
      + SMOKE_CONFIG.offsetY
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
const sleeperRiseDistance = 38; // 生成位置から上昇する距離 (px)
const sleeperStartScale = 0.88; // 出現時の縮小率
const sleeperAppearDuration = 650;
const sleeperAhead = 210;
const particleCount = 8;

const sleeperMap = new Map();
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

// ブラウザの高さ変更後も同じ空の位置を保つための基準高さ。
// 空・遠景・近景すべてに同じ倍率を適用し、番号の境界をそろえる。
const skyReferenceHeight = Math.max(1, sky.getBoundingClientRect().height);

function sceneLayerSpeed(layer) {
  if (layer.element === sky || layer.element === sceneryImageLayer || layer.element === platform) {
    const currentHeight = Math.max(1, sky.getBoundingClientRect().height);
    return skySpeed * currentHeight / skyReferenceHeight;
  }
  return layer.speed;
}

const sceneChangeAhead = 100;
const sceneHistory = [];
const imageMetadata = new Map();

// 3. 背景画像の事前読み込み
function preloadSceneImages() {
  const paths = new Set();

  for (const file of Object.values(SCENE_IMAGES.initial)) {
    if (file) paths.add(file);
  }

  for (const route of Object.values(SCENE_IMAGES.routes)) {
    for (const file of [
      ...Object.values(route.bridge),
      ...Object.values(route.destination)
    ]) {
      if (file) paths.add(file);
    }
  }

  for (const path of paths) {
    const image = new Image();

    const metadata = {
      image,
      loaded: false,
      error: false,
      ratio: 0
    };

    imageMetadata.set(path, metadata);

    image.onload = () => {
      metadata.loaded = true;
      metadata.ratio =
        image.naturalWidth / image.naturalHeight;

      rebuildSceneTimelines();
      updateSceneBackgrounds();
      updateSceneButtons();
    };

    image.onerror = () => {
      metadata.error = true;
      console.error(
        `背景画像を読み込めませんでした: ${path}`
      );
      updateSceneButtons();
    };

    image.src = path;
  }
}

function imageIsReady(file) {
  return !!file &&
    imageMetadata.get(file)?.loaded === true;
}

function imageWidth(file, element) {
  const ratio = imageMetadata.get(file)?.ratio || 0;

  return element.getBoundingClientRect().height * ratio;
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
  const trainRect = train.getBoundingClientRect();
  const railwayRect = railway.getBoundingClientRect();

  return trainRect.right - railwayRect.left;
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
  const trainRight = getTrainRight();

  const initialRightIndex = Math.ceil(
    (trainRight + sleeperAhead) / sleeperSpacing
  );

  minCreatedIndex = -3;
  maxCreatedIndex = initialRightIndex;

  for (
    let i = minCreatedIndex;
    i <= initialRightIndex;
    i++
  ) {
    addSleeper(i, false, 0);
  }
}

// 7. 列車の前方に新しい線路を作る
function spawnNewSleepers(now) {
  const trainRightWorld = getTrainRight() + worldX;

  const targetIndex = Math.ceil(
    (trainRightWorld + sleeperAhead) / sleeperSpacing
  );

  if (targetIndex > maxCreatedIndex) {
    for (
      let i = maxCreatedIndex + 1;
      i <= targetIndex;
      i++
    ) {
      // 下から浮かび上がる出現アニメーションで生成
      addSleeper(i, true, now);
    }

    maxCreatedIndex = targetIndex;
  }

  // 左方向へ移動した際に不足する線路も生成
  const leftmost = Math.floor(
    (worldX - 60) / sleeperSpacing
  );

  if (leftmost < minCreatedIndex) {
    for (
      let i = leftmost;
      i < minCreatedIndex;
      i++
    ) {
      addSleeper(i, false, now);
    }

    minCreatedIndex = leftmost;
  }
}

// 8. 新しい線路が現れる際の光エフェクト
function createLightParticles(
  screenX,
  count = particleCount
) {
  // Canvasと線路の位置の違いを補正
  const railwayTop =
    railway.getBoundingClientRect().top;

  const canvasTop =
    sparkCanvas.getBoundingClientRect().top;

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

  for (const [index, item] of sleeperMap) {
    if (item.state !== "appearing") continue;

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
  updateSceneBackgrounds();

  sceneryTrack.style.transform =
    `translateX(${-worldX * scenerySpeed}px)`;
}

// 13. 列車の移動
function updateTrain() {
  let direction = 0;

  if (moveLeft && !moveRight) {
    direction = -1;
  }

  if (moveRight && !moveLeft) {
    direction = 1;
  }

  if (direction !== 0) {

    if (currentSpeed * direction <= 0) {
      if (currentSpeed === 0) {
        currentSpeed = initialSpeed * direction;
      } else {
        currentSpeed += deceleration * direction;

        if (currentSpeed * direction >= 0) {
          currentSpeed = initialSpeed * direction;
        }
      }
    } else {
      currentSpeed += acceleration * direction;
    }

  } else {
    if (currentSpeed > 0) {
      currentSpeed = Math.max(
        0,
        currentSpeed - deceleration
      );
    } else if (currentSpeed < 0) {
      currentSpeed = Math.min(
        0,
        currentSpeed + deceleration
      );
    }
  }

  currentSpeed = Math.max(
    -maxSpeed,
    Math.min(maxSpeed, currentSpeed)
  );

  trainX += currentSpeed;

  if (trainX > trainRange) {
    worldX += trainX - trainRange;
    trainX = trainRange;
  }

  if (trainX < -trainRange) {
    worldX += trainX + trainRange;
    trainX = -trainRange;
  }

  train.style.left =
    `calc(50% + ${trainX}px)`;
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

  updateTrain();
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

window.addEventListener("resize", () => {
  resizeCanvas();
  rebuildSceneTimelines();
  updateSceneBackgrounds();
  updateSceneButtons();
});

// 16. 背景切り替えのタイムライン
function rebuildSceneTimelines() {
  let currentSkyFile = SCENE_IMAGES.initial.sky;
  let currentSkyOrigin = 0;

  for (const event of sceneHistory) {
    const route =
      SCENE_IMAGES.routes[event.choice];

    const oldWidth =
      imageWidth(currentSkyFile, sky);

    const bridgeWidth =
      imageWidth(route.bridge.sky, sky);

    if (!oldWidth || !bridgeWidth) return;

    event.skyStart =
      currentSkyOrigin +
      event.tileIndex * oldWidth;

    event.skyEnd =
      event.skyStart + bridgeWidth;

    event.startWorldX =
      event.skyStart / sceneLayerSpeed(sceneLayers.sky);

    currentSkyFile = route.destination.sky;
    currentSkyOrigin = event.skyEnd;
  }

  for (const event of sceneHistory) {
    const route =
      SCENE_IMAGES.routes[event.choice];

    event.endWorldX =
      event.skyEnd / sceneLayerSpeed(sceneLayers.sky);

    for (const [type, layer] of
      Object.entries(sceneLayers)) {

      const bridgeFile = route.bridge[type];

      if (bridgeFile) {
        const end =
          event.startWorldX +
          imageWidth(
            bridgeFile,
            layer.element
          ) / sceneLayerSpeed(layer);

        event.endWorldX =
          Math.max(event.endWorldX, end);
      }
    }
  }

  for (const [type, layer] of
    Object.entries(sceneLayers)) {

    let currentFile = SCENE_IMAGES.initial[type];
    let currentStart = -Infinity;
    let currentOrigin = 0;

    const segments = [];

    for (const event of sceneHistory) {
      if (!Number.isFinite(event.startWorldX)) {
        continue;
      }

      const route =
        SCENE_IMAGES.routes[event.choice];

      const bridgeFile = route.bridge[type];
      const destinationFile =
        route.destination[type];

      if (!bridgeFile && !destinationFile) {
        continue;
      }

      const start =
        event.startWorldX * sceneLayerSpeed(layer);

      if (currentFile) {
        segments.push({
          file: currentFile,
          from: currentStart,
          to: start,
          origin: currentOrigin,
          repeat: true
        });
      }

      let bridgeEnd = start;

      if (bridgeFile) {
        const width =
          imageWidth(
            bridgeFile,
            layer.element
          );

        bridgeEnd = start + width;

        segments.push({
          file: bridgeFile,
          from: start,
          to: bridgeEnd,
          origin: start,
          repeat: false
        });
      }

      currentFile =
        destinationFile || currentFile;

      currentStart = bridgeEnd;
      currentOrigin = bridgeEnd;
    }

    if (currentFile) {
      segments.push({
        file: currentFile,
        from: currentStart,
        to: Infinity,
        origin: currentOrigin,
        repeat: true
      });
    }

    layer.segments = segments;

    ensureScenePanels(
      layer,
      segments.length
    );
  }
}

// 17. 背景表示用パネル作成
function ensureScenePanels(layer, count) {
  while (layer.element.children.length < count) {
    const panel =
      document.createElement("div");

    panel.className = "scene-image-panel";
    layer.element.appendChild(panel);
  }

  while (layer.element.children.length > count) {
    layer.element.lastElementChild.remove();
  }

  layer.segments.forEach((segment, i) => {
    const panel = layer.element.children[i];

    panel.style.backgroundImage =
      `url("${segment.file}")`;

    panel.style.backgroundRepeat =
      segment.repeat
        ? "repeat-x"
        : "no-repeat";
  });
}

// 18. 背景画像の継ぎ目対策
const backgroundOverlap = 3;

function updateSceneBackgrounds() {
  for (const layer of Object.values(sceneLayers)) {
    const scrollX = worldX * sceneLayerSpeed(layer);

    const screenWidth =
      layer.element.getBoundingClientRect().width;

    layer.segments.forEach((segment, i) => {
      const panel = layer.element.children[i];

      const startX = segment.from - scrollX;
      const endX = segment.to - scrollX;

      const left = Math.max(
        0,
        Math.min(
          screenWidth,
          startX - backgroundOverlap
        )
      );

      const right = Math.max(
        0,
        Math.min(
          screenWidth,
          endX + backgroundOverlap
        )
      );

      if (right <= left) {
        panel.style.display = "none";
        return;
      }

      panel.style.display = "block";

      panel.style.backgroundPositionX =
        `${segment.origin - scrollX}px`;

      panel.style.clipPath =
        `inset(0 ${screenWidth - right}px 0 ${left}px)`;
    });
  }

  updateSceneButtons();
}

// 19. 背景切り替えボタン
function canSelectScene(choice) {
  const route = SCENE_IMAGES.routes[choice];

  if (!route) return false;

  // 0, 1, 2, 3, 4 をこの順に1回ずつ実行する。
  // 0はスペースキー専用、1～4は既存の4つのボタン用。
  // 前のつなぎ画像を通過するまでは次を選択できない。
  if (choice !== sceneHistory.length) return false;

  const last =
    sceneHistory[sceneHistory.length - 1];

  if (last && worldX < last.endWorldX) {
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

  const last =
    sceneHistory[sceneHistory.length - 1];

  const previousSkyFile = last
    ? SCENE_IMAGES.routes[last.choice]
        .destination.sky
    : SCENE_IMAGES.initial.sky;

  const origin = last ? last.skyEnd : 0;

  const width = imageWidth(
    previousSkyFile,
    sky
  );

  const scrollX = worldX * sceneLayerSpeed(sceneLayers.sky);

  const targetX =
    scrollX +
    sky.getBoundingClientRect().width +
    sceneChangeAhead;

  const tileIndex = Math.max(
    1,
    Math.ceil((targetX - origin) / width)
  );

  sceneHistory.push({
    choice,
    tileIndex,
    skyStart: 0,
    skyEnd: 0,
    startWorldX: 0
  });

  rebuildSceneTimelines();
  updateSceneBackgrounds();
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
initializeSmoke();
platform.style.backgroundImage = "none";

preloadSceneImages();
rebuildSceneTimelines();
resizeCanvas();
createInitialSleepers();

requestAnimationFrame(animate);
