'use strict';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const result = document.getElementById('result');
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname');
const roomInput = document.getElementById('room-code');
const joinError = document.getElementById('join-error');
const leaderboardList = document.getElementById('leaderboard-list');
const timerElement = document.getElementById('timer');
const phaseElement = document.getElementById('phase');
const landStat = document.getElementById('land-stat');
const killsStat = document.getElementById('kills-stat');
const boostButton = document.getElementById('boost-button');
const roomButton = document.getElementById('room-button');
const roomToast = document.getElementById('room-toast');
const resultTitle = document.getElementById('result-title');
const resultSubtitle = document.getElementById('result-subtitle');
const resultStats = document.getElementById('result-stats');
const rematchButton = document.getElementById('rematch-button');
const backButton = document.getElementById('back-button');

let socket = null;
let roomState = null;
let previousState = null;
let selfId = null;
let nickname = '';
let roomCode = '';
let canvasWidth = 0;
let canvasHeight = 0;
let deviceScale = 1;
let pointer = {
  x: 0,
  y: 0,
  active: false
};
let boostPressed = false;
let particles = [];
let lastFrame = performance.now();
let camera = {
  x: 0,
  y: 0,
  zoom: 1
};
let toastTimeout = null;

function resizeCanvas() {
  deviceScale = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvasWidth = window.innerWidth;
  canvasHeight = window.innerHeight;

  canvas.width = Math.floor(canvasWidth * deviceScale);
  canvas.height = Math.floor(canvasHeight * deviceScale);
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function show(section) {
  lobby.hidden = section !== 'lobby';
  game.hidden = section !== 'game';
  result.hidden = section !== 'result';
}

function wsUrl() {
  const protocol =
    location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${location.host}`;
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();

  nickname =
    nicknameInput.value.trim() || 'Runner';
  roomCode = roomInput.value.trim().toUpperCase();
  joinError.textContent = '';

  socket = new WebSocket(wsUrl());

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      type: 'join',
      name: nickname,
      room: roomCode
    }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'joined') {
      selfId = message.id;
      roomCode = message.room;
      show('game');
      announce(`Room ${roomCode}`);
    }

    if (message.type === 'snapshot') {
      previousState = roomState;
      roomState = message;
      updateHud();

      if (message.finished) {
        finishMatch();
      }
    }
  });

  socket.addEventListener('close', () => {
    if (!result.hidden) return;

    joinError.textContent =
      'Connection lost. Refresh to rejoin the rush.';
  });

  socket.addEventListener('error', () => {
    joinError.textContent =
      'Could not connect to TrailDash.io.';
  });
});

function sendInput(boost = false) {
  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    !roomState
  ) {
    return;
  }

  const self = roomState.players.find(
    (player) => player.id === selfId
  );

  if (!self) return;

  const worldPoint = screenToWorld(
    pointer.x,
    pointer.y
  );

  const angle = Math.atan2(
    worldPoint.y - self.y,
    worldPoint.x - self.x
  );

  socket.send(JSON.stringify({
    type: 'input',
    angle,
    active: pointer.active,
    boost
  }));
}

function updatePointer(clientX, clientY, active = true) {
  pointer.x = clientX;
  pointer.y = clientY;
  pointer.active = active;
  sendInput(false);
}

canvas.addEventListener('pointermove', (event) => {
  updatePointer(
    event.clientX,
    event.clientY,
    true
  );
});

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture?.(event.pointerId);

  updatePointer(
    event.clientX,
    event.clientY,
    true
  );
});

canvas.addEventListener('pointerup', () => {
  pointer.active = false;
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;

  event.preventDefault();

  if (!boostPressed) {
    boostPressed = true;
    sendInput(true);
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    boostPressed = false;
  }
});

boostButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  boostPressed = true;
  sendInput(true);
});

boostButton.addEventListener('pointerup', () => {
  boostPressed = false;
});

boostButton.addEventListener('pointercancel', () => {
  boostPressed = false;
});

roomButton.addEventListener('click', async () => {
  const link =
    `${location.origin}/?room=${encodeURIComponent(roomCode)}`;

  try {
    await navigator.clipboard.writeText(link);
    announce('Private room link copied');
  } catch {
    announce(`Room code: ${roomCode}`);
  }
});

const queryRoom =
  new URLSearchParams(location.search).get('room');

if (queryRoom) {
  roomInput.value = queryRoom.toUpperCase();
}

function updateHud() {
  if (!roomState) return;

  const seconds = Math.max(
    0,
    Math.ceil(
      roomState.duration - roomState.elapsed
    )
  );

  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');

  timerElement.textContent =
    `${minutes}:${remainder}`;

  phaseElement.textContent =
    roomState.overdrive ? 'OVERDRIVE ×2' : 'LIVE';

  const self = roomState.players.find(
    (player) => player.id === selfId
  );

  if (self) {
    const totalCells =
      roomState.world.gridWidth *
      roomState.world.gridHeight;

    landStat.textContent =
      `${Math.round((self.score / totalCells) * 100)}%`;

    killsStat.textContent = self.kills;
  }

  leaderboardList.innerHTML = '';

  for (const entry of roomState.leaderboard) {
    const li = document.createElement('li');

    li.className =
      entry.id === selfId ? 'me' : '';

    li.innerHTML =
      `<span style="color:${entry.color}">●</span> ` +
      `${escapeHtml(entry.name)} ` +
      `<b>${Math.round((entry.score / 250) * 100)}%</b>`;

    leaderboardList.appendChild(li);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

function announce(message) {
  roomToast.textContent = message;
  roomToast.classList.add('visible');

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    roomToast.classList.remove('visible');
  }, 1700);
}

function interpolate(a, b, amount) {
  if (!a || !b) return b || a;
  return a + (b - a) * amount;
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom +
      canvasWidth / 2,
    y: (y - camera.y) * camera.zoom +
      canvasHeight / 2
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - canvasWidth / 2) /
      camera.zoom + camera.x,
    y: (y - canvasHeight / 2) /
      camera.zoom + camera.y
  };
}

function updateCamera() {
  if (!roomState) return;

  const self = roomState.players.find(
    (player) => player.id === selfId
  );

  if (!self) return;

  camera.x = interpolate(
    camera.x,
    self.x,
    .09
  );

  camera.y = interpolate(
    camera.y,
    self.y,
    .09
  );

  const worldAspect =
    roomState.world.width /
    roomState.world.height;

  const screenAspect =
    canvasWidth / canvasHeight;

  const fit = screenAspect > worldAspect
    ? canvasHeight / roomState.world.height
    : canvasWidth / roomState.world.width;

  camera.zoom = Math.max(3.3, fit * .93);
}

function drawBackground() {
  ctx.fillStyle = '#090b18';

  ctx.fillRect(
    0,
    0,
    canvasWidth * deviceScale,
    canvasHeight * deviceScale
  );

  ctx.save();
  ctx.scale(deviceScale, deviceScale);

  const gradient = ctx.createRadialGradient(
    canvasWidth / 2,
    canvasHeight / 2,
    10,
    canvasWidth / 2,
    canvasHeight / 2,
    Math.max(canvasWidth, canvasHeight) * .75
  );

  gradient.addColorStop(
    0,
    'rgba(28, 35, 73, .8)'
  );

  gradient.addColorStop(
    1,
    'rgba(9, 11, 24, 0)'
  );

  ctx.fillStyle = gradient;
  ctx.fillRect(
    0,
    0,
    canvasWidth,
    canvasHeight
  );

  ctx.restore();
}

function drawWorld() {
  if (!roomState) return;

  const {
    width,
    height,
    gridWidth,
    gridHeight,
    cell
  } = roomState.world;

  const topLeft = worldToScreen(0, 0);
  const bottomRight = worldToScreen(
    width,
    height
  );

  ctx.save();
  ctx.scale(deviceScale, deviceScale);

  ctx.fillStyle = 'rgba(10, 12, 29, .88)';
  ctx.fillRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );

  ctx.strokeStyle = roomState.overdrive
    ? 'rgba(255, 77, 141, .8)'
    : 'rgba(76, 201, 240, .35)';

  ctx.lineWidth = 2;

  ctx.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );

  const cellWidth = cell * camera.zoom;

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const owner = roomState.grid[gy][gx];
      if (!owner) continue;

      const player = roomState.players.find(
        (item) => item.id === owner
      );

      if (!player) continue;

      const point = worldToScreen(
        gx * cell,
        gy * cell
      );

      ctx.globalAlpha = roomState.overdrive
        ? .42
        : .3;

      ctx.fillStyle = player.color;

      ctx.fillRect(
        point.x,
        point.y,
        cellWidth + .7,
        cellWidth + .7
      );
    }
  }

  ctx.globalAlpha = 1;

  for (const orb of roomState.orbs) {
    const point = worldToScreen(orb.x, orb.y);
    const radius =
      (orb.rare ? 1.9 : 1.1) * camera.zoom;

    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      radius * 2.7,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = orb.rare
      ? 'rgba(255, 209, 102, .14)'
      : 'rgba(76, 201, 240, .12)';

    ctx.fill();

    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = orb.rare
      ? '#ffd166'
      : '#4cc9f0';

    ctx.fill();
  }

  ctx.restore();
}

function drawTrail(player) {
  if (
    !player.trail ||
    player.trail.length < 2
  ) {
    return;
  }

  ctx.save();
  ctx.scale(deviceScale, deviceScale);
  ctx.beginPath();

  player.trail.forEach((point, index) => {
    const screen = worldToScreen(
      point.x,
      point.y
    );

    if (!index) {
      ctx.moveTo(screen.x, screen.y);
    } else {
      ctx.lineTo(screen.x, screen.y);
    }
  });

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 2.9 * camera.zoom;
  ctx.shadowColor = player.color;
  ctx.shadowBlur = 10 * camera.zoom;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, .7)';
  ctx.lineWidth = .7 * camera.zoom;
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.restore();
}

function drawPlayer(player) {
  if (!player.alive) return;

  const point = worldToScreen(
    player.x,
    player.y
  );

  const radius =
    player.radius * camera.zoom;

  ctx.save();
  ctx.scale(deviceScale, deviceScale);

  if (player.shield) {
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      radius * 1.65,
      0,
      Math.PI * 2
    );

    ctx.strokeStyle =
      'rgba(255, 255, 255, .7)';

    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.arc(
    point.x,
    point.y,
    radius * 1.35,
    0,
    Math.PI * 2
  );

  ctx.fillStyle = `${player.color}33`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(
    point.x,
    point.y,
    radius,
    0,
    Math.PI * 2
  );

  ctx.fillStyle = player.color;
  ctx.shadowColor = player.color;
  ctx.shadowBlur = player.boosting ? 22 : 10;
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(
    point.x - radius * .28,
    point.y - radius * .3,
    radius * .25,
    0,
    Math.PI * 2
  );

  ctx.fillStyle = 'rgba(255, 255, 255, .82)';
  ctx.fill();

  ctx.font =
    `700 ${Math.max(9, 2.1 * camera.zoom)}px system-ui`;

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 255, 255, .86)';

  ctx.fillText(
    player.name,
    point.x,
    point.y - radius * 1.75
  );

  ctx.restore();
}

function finishMatch() {
  if (!result.hidden) return;

  const self = roomState.players.find(
    (player) => player.id === selfId
  );

  const ranking = roomState.leaderboard;
  const place = Math.max(
    1,
    ranking.findIndex(
      (entry) => entry.id === selfId
    ) + 1
  );

  resultTitle.textContent =
    place === 1
      ? 'MAP CHAMPION!'
      : 'RUSH COMPLETE';

  resultSubtitle.textContent =
    place === 1
      ? 'You owned the map when the storm settled.'
      : `You finished #${place}. Every trail is a second chance.`;

  const totalCells =
    roomState.world.gridWidth *
    roomState.world.gridHeight;

  const percent = self
    ? Math.round((self.score / totalCells) * 100)
    : 0;

  resultStats.innerHTML = `
    <strong>${escapeHtml(self?.name || nickname)}</strong><br>
    Territory claimed: <strong>${percent}%</strong><br>
    Trail cuts: <strong>${self?.kills || 0}</strong><br>
    Room: <strong>${roomCode}</strong>
  `;

  show('result');
}

rematchButton.addEventListener('click', () => {
  result.hidden = true;
  lobby.hidden = false;
  roomInput.value = roomCode;
  joinError.textContent = '';
});

backButton.addEventListener('click', () => {
  if (socket) socket.close();

  roomState = null;
  previousState = null;
  show('lobby');
});

function render(now) {
  const delta = Math.min(
    .05,
    (now - lastFrame) / 1000
  );

  lastFrame = now;

  updateCamera();
  drawBackground();
  drawWorld();

  if (roomState) {
    for (const player of roomState.players) {
      drawTrail(player);
    }

    for (const player of roomState.players) {
      drawPlayer(player);
    }
  }

  void delta;
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
