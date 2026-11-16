'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const TICK_RATE = 20;
const SNAPSHOT_RATE = 15;
const DT = 1 / TICK_RATE;

const WORLD = {
  width: 160,
  height: 100,
  cell: 4,
  gridWidth: 40,
  gridHeight: 25
};

const MATCH_SECONDS = 240;
const OVERDRIVE_SECONDS = 30;
const MAX_PLAYERS = 16;
const MIN_BOTS = 7;
const PLAYER_RADIUS = 1.6;
const BASE_RADIUS = 4.5;
const MAX_TRAIL = 900;
const BOOST_COOLDOWN = 2.4;
const BOOST_DURATION = 0.42;
const NORMAL_SPEED = 19;
const BOOST_SPEED = 31;

const COLORS = [
  '#ff4d6d',
  '#4cc9f0',
  '#ffd166',
  '#80ed99',
  '#c77dff',
  '#ff9f1c',
  '#00f5d4',
  '#f72585',
  '#90be6d',
  '#577590',
  '#f9844a',
  '#43aa8b',
  '#b8f2e6',
  '#e76f51',
  '#a8dadc',
  '#ffca3a'
];

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'traildash.io',
    rooms: rooms.size,
    players: countHumanPlayers()
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function id() {
  return crypto.randomBytes(5).toString('hex');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (!lenSq) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);

  return Math.hypot(
    px - (ax + t * dx),
    py - (ay + t * dy)
  );
}

function sanitizeName(value) {
  const name = String(value || 'Runner')
    .replace(/[^\p{L}\p{N}_\- ]/gu, '')
    .trim()
    .slice(0, 16);

  return name || 'Runner';
}

function makeGrid() {
  return Array.from(
    { length: WORLD.gridHeight },
    () => Array(WORLD.gridWidth).fill(null)
  );
}

function gridPosition(x, y) {
  return {
    gx: clamp(Math.floor(x / WORLD.cell), 0, WORLD.gridWidth - 1),
    gy: clamp(Math.floor(y / WORLD.cell), 0, WORLD.gridHeight - 1)
  };
}

function cellCenter(gx, gy) {
  return {
    x: gx * WORLD.cell + WORLD.cell / 2,
    y: gy * WORLD.cell + WORLD.cell / 2
  };
}

function createRoom(code = null) {
  const room = {
    id: code || id().slice(0, 6).toUpperCase(),
    elapsed: 0,
    overdrive: false,
    finished: false,
    nextSnapshot: 0,
    players: new Map(),
    grid: makeGrid(),
    orbs: [],
    events: []
  };

  rooms.set(room.id, room);
  seedOrbs(room);
  return room;
}

function seedOrbs(room) {
  for (let i = 0; i < 28; i++) {
    room.orbs.push({
      id: id(),
      x: 6 + Math.random() * (WORLD.width - 12),
      y: 6 + Math.random() * (WORLD.height - 12),
      value: Math.random() < 0.08 ? 10 : 2,
      rare: Math.random() < 0.08
    });
  }
}

function findOrCreateRoom(requestedCode) {
  if (requestedCode) {
    const code = requestedCode
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);

    if (code && rooms.has(code)) return rooms.get(code);
    if (code) return createRoom(code);
  }

  for (const room of rooms.values()) {
    if (!room.finished && room.players.size < MAX_PLAYERS) return room;
  }

  return createRoom();
}

function countHumanPlayers() {
  let total = 0;

  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (!player.bot) total++;
    }
  }

  return total;
}

function chooseSpawn(room) {
  const players = [...room.players.values()];

  for (let attempt = 0; attempt < 60; attempt++) {
    const x = 10 + Math.random() * (WORLD.width - 20);
    const y = 10 + Math.random() * (WORLD.height - 20);

    if (players.every((player) => {
      return Math.hypot(player.x - x, player.y - y) > 15;
    })) {
      return { x, y };
    }
  }

  return {
    x: WORLD.width / 2 + (Math.random() - 0.5) * 20,
    y: WORLD.height / 2 + (Math.random() - 0.5) * 20
  };
}

function createPlayer(room, socket, name, bot = false) {
  const spawn = chooseSpawn(room);

  const player = {
    id: id(),
    socket,
    bot,
    name: sanitizeName(name),
    color: COLORS[room.players.size % COLORS.length],
    x: spawn.x,
    y: spawn.y,
    angle: Math.random() * Math.PI * 2,
    targetAngle: Math.random() * Math.PI * 2,
    radius: BASE_RADIUS,
    territory: 1,
    kills: 0,
    captures: 0,
    largestCapture: 0,
    alive: true,
    respawnAt: 0,
    shieldUntil: Date.now() + 2500,
    boostUntil: 0,
    nextBoost: 0,
    trail: [],
    input: {
      angle: 0,
      active: false,
      boost: false
    },
    lastInputAt: Date.now()
  };

  room.players.set(player.id, player);
  paintInitialBase(room, player);
  return player;
}

function paintInitialBase(room, player) {
  const center = gridPosition(player.x, player.y);

  for (let gy = center.gy - 1; gy <= center.gy + 1; gy++) {
    for (let gx = center.gx - 1; gx <= center.gx + 1; gx++) {
      if (
        gx >= 0 &&
        gx < WORLD.gridWidth &&
        gy >= 0 &&
        gy < WORLD.gridHeight
      ) {
        room.grid[gy][gx] = player.id;
      }
    }
  }
}

function cellOwnedBy(room, player, x, y) {
  const { gx, gy } = gridPosition(x, y);
  return room.grid[gy][gx] === player.id;
}

function isInsideOwnTerritory(room, player) {
  return cellOwnedBy(room, player, player.x, player.y);
}

function beginTrail(player) {
  if (!player.trail.length) {
    player.trail.push({ x: player.x, y: player.y });
  }
}

function addTrailPoint(player) {
  const last = player.trail[player.trail.length - 1];

  if (
    !last ||
    Math.hypot(last.x - player.x, last.y - player.y) >= 0.7
  ) {
    player.trail.push({ x: player.x, y: player.y });
  }

  if (player.trail.length > MAX_TRAIL) {
    player.trail.splice(
      0,
      player.trail.length - MAX_TRAIL
    );
  }
}

function pointInPolygon(x, y, polygon) {
  let inside = false;

  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.00001) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function fillTerritory(room, player) {
  if (player.trail.length < 3) return 0;

  const polygon = player.trail.slice();

  const bounds = polygon.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      maxX: Math.max(result.maxX, point.x),
      minY: Math.min(result.minY, point.y),
      maxY: Math.max(result.maxY, point.y)
    }),
    {
      minX: WORLD.width,
      maxX: 0,
      minY: WORLD.height,
      maxY: 0
    }
  );

  const minGX = clamp(
    Math.floor(bounds.minX / WORLD.cell) - 1,
    0,
    WORLD.gridWidth - 1
  );
  const maxGX = clamp(
    Math.ceil(bounds.maxX / WORLD.cell) + 1,
    0,
    WORLD.gridWidth - 1
  );
  const minGY = clamp(
    Math.floor(bounds.minY / WORLD.cell) - 1,
    0,
    WORLD.gridHeight - 1
  );
  const maxGY = clamp(
    Math.ceil(bounds.maxY / WORLD.cell) + 1,
    0,
    WORLD.gridHeight - 1
  );

  let changed = 0;

  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const point = cellCenter(gx, gy);

      if (pointInPolygon(point.x, point.y, polygon)) {
        if (room.grid[gy][gx] !== player.id) {
          room.grid[gy][gx] = player.id;
          changed++;
        }
      }
    }
  }

  player.trail = [];
  player.captures++;
  player.largestCapture = Math.max(
    player.largestCapture,
    changed
  );
  player.territory += changed;

  if (changed > 0) {
    room.events.push({
      type: 'capture',
      player: player.id,
      x: player.x,
      y: player.y,
      amount: changed,
      at: Date.now()
    });
  }

  return changed;
}

function eliminate(room, victim, killerId = null) {
  if (!victim.alive) return;

  victim.alive = false;
  victim.respawnAt = Date.now() + 1800;
  victim.trail = [];

  const killer = killerId ? room.players.get(killerId) : null;

  if (killer && killer.id !== victim.id) {
    killer.kills++;
  }

  const dropped = Math.max(
    2,
    Math.floor(victim.territory * 0.18)
  );

  let removed = 0;

  for (
    let gy = 0;
    gy < WORLD.gridHeight && removed < dropped;
    gy++
  ) {
    for (
      let gx = 0;
      gx < WORLD.gridWidth && removed < dropped;
      gx++
    ) {
      if (room.grid[gy][gx] === victim.id) {
        room.grid[gy][gx] = null;
        removed++;
      }
    }
  }

  victim.territory = Math.max(
    1,
    victim.territory - removed
  );

  room.events.push({
    type: 'elimination',
    victim: victim.id,
    killer: killer ? killer.id : null,
    x: victim.x,
    y: victim.y,
    at: Date.now()
  });
}

function respawn(room, player) {
  const spawn = chooseSpawn(room);

  player.x = spawn.x;
  player.y = spawn.y;
  player.angle = Math.random() * Math.PI * 2;
  player.targetAngle = player.angle;
  player.alive = true;
  player.trail = [];
  player.territory = 1;
  player.shieldUntil = Date.now() + 2800;

  paintInitialBase(room, player);
}

function collectOrbs(room, player) {
  for (let i = room.orbs.length - 1; i >= 0; i--) {
    const orb = room.orbs[i];

    if (
      Math.hypot(orb.x - player.x, orb.y - player.y) <
      player.radius + 1.4
    ) {
      player.territory += orb.value;
      room.orbs.splice(i, 1);
    }
  }

  while (room.orbs.length < 28) {
    room.orbs.push({
      id: id(),
      x: 6 + Math.random() * (WORLD.width - 12),
      y: 6 + Math.random() * (WORLD.height - 12),
      value: Math.random() < 0.08 ? 10 : 2,
      rare: Math.random() < 0.08
    });
  }
}

function checkTrailCollisions(room, movingPlayer) {
  if (
    !movingPlayer.alive ||
    Date.now() < movingPlayer.shieldUntil
  ) {
    return;
  }

  for (const other of room.players.values()) {
    if (!other.alive || other.id === movingPlayer.id) continue;

    for (let i = 1; i < other.trail.length; i++) {
      const a = other.trail[i - 1];
      const b = other.trail[i];

      if (
        pointSegmentDistance(
          movingPlayer.x,
          movingPlayer.y,
          a.x,
          a.y,
          b.x,
          b.y
        ) < PLAYER_RADIUS + 0.65
      ) {
        eliminate(room, other, movingPlayer.id);
        break;
      }
    }

    for (let i = 1; i < movingPlayer.trail.length; i++) {
      const a = movingPlayer.trail[i - 1];
      const b = movingPlayer.trail[i];

      if (
        pointSegmentDistance(
          other.x,
          other.y,
          a.x,
          a.y,
          b.x,
          b.y
        ) < PLAYER_RADIUS + 0.65
      ) {
        eliminate(room, movingPlayer, other.id);
        break;
      }
    }
  }
}

function movePlayer(room, player, now) {
  if (!player.alive) {
    if (now >= player.respawnAt) respawn(room, player);
    return;
  }

  if (
    player.input.active &&
    Number.isFinite(player.input.angle)
  ) {
    player.targetAngle = player.input.angle;
  }

  let angleDelta = player.targetAngle - player.angle;

  while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
  while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;

  player.angle += clamp(angleDelta, -DT * 7, DT * 7);

  if (
    player.input.boost &&
    now >= player.nextBoost
  ) {
    player.boostUntil =
      now + BOOST_DURATION * 1000;
    player.nextBoost =
      now + BOOST_COOLDOWN * 1000;
  }

  player.input.boost = false;

  const speed =
    now < player.boostUntil
      ? BOOST_SPEED
      : NORMAL_SPEED;

  player.x += Math.cos(player.angle) * speed * DT;
  player.y += Math.sin(player.angle) * speed * DT;

  if (
    player.x <= 0 ||
    player.x >= WORLD.width ||
    player.y <= 0 ||
    player.y >= WORLD.height
  ) {
    player.x = clamp(player.x, 0.5, WORLD.width - 0.5);
    player.y = clamp(player.y, 0.5, WORLD.height - 0.5);
    player.angle += Math.PI * 0.8;
  }

  if (isInsideOwnTerritory(room, player)) {
    if (player.trail.length > 2) fillTerritory(room, player);
  } else {
    beginTrail(player);
    addTrailPoint(player);
  }

  collectOrbs(room, player);
  checkTrailCollisions(room, player);
}

function ensureBots(room) {
  const aliveCount = [...room.players.values()]
    .filter((player) => player.alive)
    .length;

  if (aliveCount >= MIN_BOTS) return;

  let number = 1;

  while (room.players.size < Math.min(MIN_BOTS, MAX_PLAYERS)) {
    createPlayer(room, null, `Bot${number++}`, true);
  }
}

function updateBots(room, now) {
  for (const player of room.players.values()) {
    if (!player.bot || !player.alive) continue;

    if (Math.random() < 0.025) {
      player.targetAngle +=
        (Math.random() - 0.5) * 2.2;
    }

    if (
      player.trail.length > 40 &&
      Math.random() < 0.035
    ) {
      player.targetAngle += Math.PI;
    }

    player.input.angle = player.targetAngle;
    player.input.active = true;
    player.input.boost =
      Math.random() < 0.015 &&
      now >= player.nextBoost;
  }
}

function playerScore(room, player) {
  let owned = 0;

  for (const row of room.grid) {
    for (const owner of row) {
      if (owner === player.id) owned++;
    }
  }

  return owned;
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      score: playerScore(room, player),
      kills: player.kills,
      alive: player.alive
    }))
    .sort((a, b) => {
      return b.score - a.score || b.kills - a.kills;
    })
    .slice(0, 10);
}

function serializeRoom(room, viewer) {
  return {
    type: 'snapshot',
    room: room.id,
    self: viewer.id,
    elapsed: room.elapsed,
    duration: MATCH_SECONDS,
    overdrive: room.overdrive,
    finished: room.finished,
    world: WORLD,
    grid: room.grid,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      x: player.x,
      y: player.y,
      angle: player.angle,
      radius: player.radius,
      alive: player.alive,
      shield: Date.now() < player.shieldUntil,
      boosting: Date.now() < player.boostUntil,
      trail: player.trail,
      score: playerScore(room, player),
      kills: player.kills,
      nextBoost: Math.max(
        0,
        player.nextBoost - Date.now()
      )
    })),
    orbs: room.orbs,
    leaderboard: leaderboard(room),
    events: room.events
  };
}

function send(socket, payload) {
  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(JSON.stringify(payload));
  }
}

function updateRoom(room) {
  if (room.finished) return;

  const now = Date.now();

  room.elapsed += DT;
  room.overdrive =
    room.elapsed >= MATCH_SECONDS - OVERDRIVE_SECONDS;

  ensureBots(room);
  updateBots(room, now);

  for (const player of room.players.values()) {
    movePlayer(room, player, now);
  }

  room.events = room.events.filter((event) => {
    return now - event.at < 1400;
  });

  if (room.elapsed >= MATCH_SECONDS) {
    room.finished = true;
  }
}

wss.on('connection', (socket) => {
  let room = null;
  let player = null;

  socket.on('message', (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'join') {
      if (player) return;

      room = findOrCreateRoom(message.room);
      player = createPlayer(
        room,
        socket,
        message.name,
        false
      );

      send(socket, {
        type: 'joined',
        id: player.id,
        room: room.id,
        name: player.name
      });

      return;
    }

    if (!player) return;

    if (message.type === 'input') {
      const angle = Number(message.angle);

      if (Number.isFinite(angle)) {
        player.input.angle = angle;
        player.input.active = Boolean(message.active);
        player.input.boost = Boolean(message.boost);
        player.lastInputAt = Date.now();
      }
    }
  });

  socket.on('close', () => {
    if (room && player) {
      room.players.delete(player.id);

      if (!room.players.size) {
        rooms.delete(room.id);
      }
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room);

    const now = Date.now();

    if (now >= room.nextSnapshot) {
      room.nextSnapshot =
        now + 1000 / SNAPSHOT_RATE;

      for (const player of room.players.values()) {
        if (!player.bot) {
          send(
            player.socket,
            serializeRoom(room, player)
          );
        }
      }
    }
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(
    `TrailDash.io listening on port ${PORT}`
  );
});
