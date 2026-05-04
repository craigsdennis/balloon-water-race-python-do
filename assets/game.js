const CLOWNS = [
  {id:0, name:"Bozo", color:"#ff0055"},
  {id:1, name:"Chuckles", color:"#00ff00"},
  {id:2, name:"Sprinkles", color:"#00c8ff"},
  {id:3, name:"Wiggles", color:"#ffff00"},
  {id:4, name:"Puddles", color:"#ff6400"}
];

// Extract game ID from URL path: /game/<id>
const GAME_ID = window.location.pathname.split('/')[2] || 'default';
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/${GAME_ID}`);
let gameState = null;
let activeShooters = [];
let allTimeScores = [];
let particles = [];
let shakeOffsets = {};
let explosions = {};

// Canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

ws.onopen = () => console.log('Screen connected to game:', GAME_ID);
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'state') {
    gameState = msg.data;
    activeShooters = msg.active_shooters || [];
    allTimeScores = msg.all_time || [];
    updatePlayerCount();
  } else if (msg.type === 'balloon_popped') {
    const idx = msg.clown_id;
    explosions[idx] = {timer: 30}; // 0.5s of 💥
    spawnConfetti(getClownX(idx), getClownY() - 100, CLOWNS[idx].color);
    shakeOffsets[idx] = {timer: 30};
  } else if (msg.type === 'diagnostic') {
    console.log('🔬 DIAGNOSTIC RAW:', msg.data);
    displayDiagnostics(msg.data);
  }
};

function getClownX(index) {
  const gap = canvas.width / (CLOWNS.length + 1);
  return gap * (index + 1);
}
function getClownY() {
  return canvas.height * 0.45;
}

function drawOrangeBalloon(ctx) {
  // String
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 32);
  ctx.quadraticCurveTo(4, 50, 0, 70);
  ctx.stroke();

  // Knot
  ctx.fillStyle = '#d9650a';
  ctx.beginPath();
  ctx.ellipse(0, 32, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Balloon body with orange gradient
  const grad = ctx.createRadialGradient(-10, -15, 5, 0, 0, 35);
  grad.addColorStop(0, '#ff9e4a');
  grad.addColorStop(0.4, '#f48120');
  grad.addColorStop(1, '#c45a0c');

  ctx.fillStyle = grad;
  ctx.shadowColor = '#f48120';
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.ellipse(0, -5, 30, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-10, -18, 8, 14, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Small secondary highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.ellipse(-16, -8, 3, 5, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function spawnConfetti(x, y, baseColor) {
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 10;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      life: 1.0,
      decay: 0.004 + Math.random() * 0.008,
      color: `hsl(${Math.random() * 360}, 100%, 60%)`,
      width: 4 + Math.random() * 8,
      height: 2 + Math.random() * 5,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.4,
      gravity: 0.12 + Math.random() * 0.12,
      type: 'confetti'
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity || 0.15;
    p.vx *= 0.98;
    p.life -= p.decay || 0.02;
    if (p.type === 'confetti') {
      p.rotation += p.rotationSpeed;
    }
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.type === 'confetti') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (p.size || 4) * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawClown(c, x, y, fillPct, isPopped, shooterCount) {
  let sx = 0, sy = 0;
  if (shakeOffsets[c.id] && shakeOffsets[c.id].timer > 0) {
    shakeOffsets[c.id].timer--;
    sx = (Math.random() - 0.5) * 10;
    sy = (Math.random() - 0.5) * 10;
    if (shakeOffsets[c.id].timer <= 0) delete shakeOffsets[c.id];
  }

  ctx.save();
  ctx.translate(x + sx, y + sy);

  // Winner highlight glow (shows when popped = game over)
  if (isPopped) {
    const pulse = 1 + Math.sin(Date.now() / 80) * 0.15;
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.arc(0, 0, 75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.font = '50px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑', 0, -140);
  }

  // Balloon above head
  const balloonScale = 1.0 + (fillPct * 4.0);
  const balloonY = -100;

  if (isPopped) {
    // Show explosion briefly, then nothing
    if (explosions[c.id] && explosions[c.id].timer > 0) {
      explosions[c.id].timer--;
      ctx.font = 'bold 80px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💥', 0, balloonY);
    }
  } else {
    ctx.save();
    ctx.translate(0, balloonY);
    ctx.scale(balloonScale, balloonScale);
    drawOrangeBalloon(ctx);
    ctx.restore();
  }

  // Clown face - always visible
  ctx.font = '120px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🤡', 0, 0);

  // Target solid circle on mouth - always visible
  ctx.fillStyle = c.color;
  ctx.shadowColor = c.color;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(0, 18, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Name below
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = isPopped ? '#ffd700' : c.color;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(c.name, 0, 90);
  ctx.shadowBlur = 0;

  // Active shooter count
  if (shooterCount > 0) {
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(`🔫 ${shooterCount}`, 0, 115);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function updatePlayerCount() {
  if (!gameState) return;
  const playerCount = Object.keys(gameState.players || {}).length;
  const countEl = document.getElementById('player-count');
  if (countEl) {
    countEl.textContent = `${playerCount} player${playerCount !== 1 ? 's' : ''} online`;
  }
  updateScoreboard();
}

function updateScoreboard() {
  if (!gameState) return;
  const list = document.getElementById('top-players-list');
  if (!list) return;

  const players = Object.values(gameState.players || {})
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);

  if (players.length === 0) {
    list.innerHTML = '<li class="empty">Waiting for players...</li>';
  } else {
    list.innerHTML = players.map((p, i) => {
      const rankColor = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#fff';
      return `<li><span class="name" style="color:${rankColor}">${p.name}</span><span class="score">${p.score}</span></li>`;
    }).join('');
  }

  // All-time hall of fame from SQLite
  const allTimeList = document.getElementById('all-time-list');
  if (allTimeList) {
    if (allTimeScores.length === 0) {
      allTimeList.innerHTML = '<li class="empty">No records yet</li>';
    } else {
      allTimeList.innerHTML = allTimeScores.map((p, i) => {
        return `<li><span class="name">${p.name}</span><span class="score">${p.score}</span></li>`;
      }).join('');
    }
  }
}

let countdownValue = 0;
let isCountingDown = false;

function showCountdown(value) {
  const overlay = document.getElementById('countdown-overlay');
  const text = document.getElementById('countdown-text');
  if (value > 0) {
    text.textContent = value;
    overlay.classList.remove('hidden');
  } else if (value === 0) {
    text.textContent = 'GO!';
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 800);
  } else {
    overlay.classList.add('hidden');
  }
}

function runCountdown() {
  if (isCountingDown) return;
  isCountingDown = true;
  countdownValue = 3;
  showCountdown(countdownValue);

  const interval = setInterval(() => {
    countdownValue--;
    if (countdownValue >= 0) {
      showCountdown(countdownValue);
    }
    if (countdownValue < 0) {
      clearInterval(interval);
      isCountingDown = false;
      ws.send(JSON.stringify({action: 'start_game'}));
    }
  }, 1000);
}

// Spacebar to start countdown
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && gameState && !gameState.game_active && !isCountingDown) {
    e.preventDefault();
    runCountdown();
  }
});

function draw() {
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, canvas.width
  );
  grad.addColorStop(0, '#2d1b4e');
  grad.addColorStop(1, '#1a0b2e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (gameState) {
    CLOWNS.forEach((c, i) => {
      const clownData = gameState.clowns[i];
      const fillPct = clownData.popped ? 1.0 : (clownData.fill / clownData.max_fill);
      if (explosions[i] && explosions[i].timer <= 0) delete explosions[i];
      const shooterCount = activeShooters[i] || 0;
      drawClown(c, getClownX(i), getClownY(), fillPct, clownData.popped, shooterCount);
    });
  } else {
    CLOWNS.forEach((c, i) => {
      drawClown(c, getClownX(i), getClownY(), 0, false, 0);
    });
  }

  updateParticles();
  drawParticles();

  requestAnimationFrame(draw);
}

// QR Code - link to player page for THIS game
function initQRCode() {
  if (typeof QRCode === 'undefined') {
    console.error('QRCode library not loaded');
    document.getElementById('qrcode').innerHTML = '<p style="color:red">QR library failed to load</p>';
    return;
  }

  const url = `${location.protocol}//${location.host}/player/${GAME_ID}`;

  const container = document.getElementById('qrcode');
  container.innerHTML = '';

  new QRCode(container, {
    text: url,
    width: 120,
    height: 120,
    colorDark: '#ffffff',
    colorLight: 'transparent',
    correctLevel: QRCode.CorrectLevel.H
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initQRCode, 100);
    draw();
  });
} else {
  setTimeout(initQRCode, 100);
  draw();
}

// ==================== DEBUG / TEST TOOLS ====================
// Press D to toggle debug panel
let debugVisible = false;
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyD') {
    debugVisible = !debugVisible;
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.classList.toggle('hidden', !debugVisible);
    }
  }
});

function testShoot(clownId) {
  if (!gameState || !gameState.game_active) {
    console.log('Game not active - press SPACE to start first');
    return;
  }
  // Send 5 rapid shots
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      ws.send(JSON.stringify({action: 'shoot', clown_id: clownId}));
    }, i * 50);
  }
}

function testPop(clownId) {
  if (!gameState) return;
  const clown = gameState.clowns[clownId];
  if (!clown || clown.popped) return;
  
  // Calculate how many shots needed to pop
  const remaining = clown.max_fill - clown.fill;
  if (remaining <= 0) return;
  
  // Fire that many shots rapidly
  for (let i = 0; i < remaining; i++) {
    setTimeout(() => {
      ws.send(JSON.stringify({action: 'shoot', clown_id: clownId}));
    }, i * 30);
  }
}

let fakePlayerCount = 0;
function joinFakePlayer() {
  fakePlayerCount++;
  const fakeName = `Tester_${fakePlayerCount}`;
  // Open a new WebSocket as a fake player
  const fakeWs = new WebSocket(`${wsProtocol}//${location.host}/ws/${GAME_ID}`);
  fakeWs.onopen = () => {
    fakeWs.send(JSON.stringify({action: 'join', name: fakeName}));
  };
  // Auto-shoot after joining
  fakeWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') {
      setInterval(() => {
        if (gameState && gameState.game_active) {
          const target = Math.floor(Math.random() * 5);
          fakeWs.send(JSON.stringify({action: 'shoot', clown_id: target}));
        }
      }, 200);
    }
  };
  console.log('Fake player joined:', fakeName);
}

function rapidFireAll() {
  if (!gameState || !gameState.game_active) {
    console.log('Game not active - press SPACE to start first');
    return;
  }
  // Fire at all clowns rapidly for 3 seconds
  const interval = setInterval(() => {
    if (!gameState || !gameState.game_active) {
      clearInterval(interval);
      return;
    }
    const target = Math.floor(Math.random() * 5);
    ws.send(JSON.stringify({action: 'shoot', clown_id: target}));
  }, 50);
  setTimeout(() => clearInterval(interval), 3000);
}

// ==================== SQL DIAGNOSTICS ====================
function runDiagnostics() {
  const output = document.getElementById('sql-output');
  if (output) {
    output.textContent = 'Running diagnostics...';
    output.classList.remove('error');
  }
  ws.send(JSON.stringify({action: 'diagnostic'}));
}

function displayDiagnostics(data) {
  const output = document.getElementById('sql-output');
  if (!output) return;

  let html = '';

  if (data.test_query) {
    html += `SQL Test: ${data.test_query} ✅\n`;
  }

  if (data.errors && data.errors.length > 0) {
    output.classList.add('error');
    html += '\nERRORS:\n';
    data.errors.forEach(e => {
      html += `  ❌ ${e}\n`;
    });
  } else {
    output.classList.remove('error');
  }

  const tables = data.tables || {};
  if (tables.exists) {
    html += `Tables: ${tables.exists.join(', ') || 'none'}\n`;
  }
  if (typeof tables.count === 'number') {
    html += `Row count: ${tables.count}\n`;
  }

  if (tables.rows && tables.rows.length > 0) {
    html += '\nhigh_scores table:\n';
    html += 'NAME'.padEnd(14) + 'SCORE'.padStart(8) + '\n';
    html += '-'.repeat(24) + '\n';
    tables.rows.forEach(r => {
      html += r.name.toString().substring(0, 12).padEnd(14) + r.score.toString().padStart(8) + '\n';
    });
  } else {
    html += '\nNo rows in high_scores';
  }

  // Show row introspection debug for the first few rows
  if (data.row_debug && data.row_debug.length > 0) {
    html += '\n\n🔍 ROW DEBUG (first 3 rows):\n';
    data.row_debug.forEach(rd => {
      html += `\n--- ${rd.label} ---\n`;
      html += `type: ${rd.type}\n`;
      html += `repr: ${rd.repr}\n`;
      html += 'access results:\n';
      const access = rd.access || {};
      Object.entries(access).forEach(([k, v]) => {
        const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        const short = valStr.length > 60 ? valStr.substring(0, 60) + '...' : valStr;
        html += `  ${k}: ${short}\n`;
      });
    });
  }

  output.textContent = html;
}
