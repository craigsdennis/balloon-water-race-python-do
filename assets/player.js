const TARGETS = [
  {id:0, name:"Bozo", color:[255,0,85]},
  {id:1, name:"Chuckles", color:[0,255,0]},
  {id:2, name:"Sprinkles", color:[0,200,255]},
  {id:3, name:"Wiggles", color:[255,255,0]},
  {id:4, name:"Puddles", color:[160,32,240]}
];
const COLOR_TOLERANCE = 120;

// ==================== Audio feedback (haptic substitute for iOS) ====================
let audioCtx = null;
function playShotSound(pitch = 800) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.03);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch (e) {
    // Silently fail if audio isn't supported
  }
}

function playBuzzSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;

    // Two descending tones for a dramatic game-over buzzer
    [600, 400].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.15);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + i * 0.15 + 0.3);
      gain.gain.setValueAtTime(0.15, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.4);
    });
  } catch (e) {
    // Silently fail
  }
}

// Extract game ID from URL path: /player/<id>
const pathParts = window.location.pathname.split('/');
const GAME_ID = pathParts[2] || '';
const HAS_GAME_ID = GAME_ID.length > 0;

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = HAS_GAME_ID ? new WebSocket(`${wsProtocol}//${location.host}/ws/${GAME_ID}`) : null;
let myName = '';
let mySid = null;
let myScore = 0;
let currentTarget = null;
let shootInterval = null;

let gameActive = false;
let currentClownFill = 0;
let currentClownMax = 300;

const gameCodePanel = document.getElementById('game-code-panel');
const joinPanel = document.getElementById('join-panel');
const gamePanel = document.getElementById('game-panel');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const video = document.getElementById('camera');
const lockIndicator = document.getElementById('lock-indicator');
const crosshair = document.querySelector('.crosshair');
const scoreDisplay = document.getElementById('player-score');
const targetBar = document.getElementById('target-bar');

// ==================== LANDING: No game ID ====================
if (!HAS_GAME_ID) {
  // Show game code entry panel
  if (gameCodePanel) gameCodePanel.classList.remove('hidden');
  if (joinPanel) joinPanel.classList.add('hidden');
  if (gamePanel) gamePanel.classList.add('hidden');

  const gameCodeInput = document.getElementById('game-code-input');
  const gameCodeBtn = document.getElementById('game-code-btn');
  const recentGamesEl = document.getElementById('recent-games');

  // Show recent games
  function renderRecentGames() {
    const recent = JSON.parse(localStorage.getItem('bwr_recent_games') || '[]');
    if (recent.length === 0 || !recentGamesEl) return;
    recentGamesEl.innerHTML = '<p class="recent-label">Recent Games</p>';
    recent.forEach(g => {
      const btn = document.createElement('button');
      btn.className = 'recent-game-btn';
      btn.textContent = '🎪 ' + g;
      btn.onclick = () => {
        window.location.href = '/player/' + g;
      };
      recentGamesEl.appendChild(btn);
    });
  }
  renderRecentGames();

  function joinByCode() {
    const code = gameCodeInput.value.trim().toLowerCase();
    if (!code) return;
    window.location.href = '/player/' + code;
  }

  if (gameCodeBtn) gameCodeBtn.onclick = joinByCode;
  if (gameCodeInput) {
    gameCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinByCode();
    });
  }
} else {
  // We have a game ID — show the name entry panel
  if (gameCodePanel) gameCodePanel.classList.add('hidden');
  if (joinPanel) joinPanel.classList.remove('hidden');

  // Display game code on join screen so players know they're in the right one
  const gameCodeDisplay = document.getElementById('current-game-code');
  if (gameCodeDisplay) gameCodeDisplay.textContent = 'Game: ' + GAME_ID;

  // Track this as a recent game
  const recent = JSON.parse(localStorage.getItem('bwr_recent_games') || '[]');
  if (!recent.includes(GAME_ID)) {
    recent.unshift(GAME_ID);
    localStorage.setItem('bwr_recent_games', JSON.stringify(recent.slice(0, 5)));
  }
}

joinBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return;
  myName = name;
  localStorage.setItem('bwr_name', name);
  ws.send(JSON.stringify({action:'join', name}));
};

// Pre-fill saved name
const savedName = localStorage.getItem('bwr_name');
if (savedName) {
  nameInput.value = savedName;
}

// Switch game button
const switchGameBtn = document.getElementById('switch-game-btn');
if (switchGameBtn) {
  switchGameBtn.onclick = () => {
    window.location.href = '/player';
  };
}

// Start camera immediately so players can practice aiming while waiting
startCamera();

if (ws) {
  ws.onopen = () => console.log('Player connected to game:', GAME_ID);
  ws.onerror = (e) => console.error('WebSocket error:', e);
  ws.onclose = (e) => console.log('WebSocket closed:', e.code, e.reason);
  ws.onmessage = (ev) => {
    console.log('WS message:', ev.data);
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') {
      console.log('Joined!');
      mySid = msg.session_id;
      joinPanel.classList.add('hidden');
      gamePanel.classList.remove('hidden');
      document.getElementById('player-name').textContent = msg.name;
    } else if (msg.type === 'state') {
      gameActive = msg.data.game_active || false;

      if (targetBar) {
        if (msg.data.game_active) {
          if (currentTarget !== null) {
            const t = TARGETS.find(x => x.id === currentTarget);
            if (t) {
              targetBar.textContent = 'TARGET: ' + t.name;
              targetBar.style.background = 'rgba(' + t.color.join(',') + ', 0.6)';
              targetBar.style.color = '#fff';
              targetBar.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
            }
          } else {
            targetBar.textContent = 'Aim at a clown mouth...';
            targetBar.style.background = 'rgba(0,0,0,0.5)';
            targetBar.style.color = '#ccc';
            targetBar.style.textShadow = 'none';
          }
        } else {
          const anyPopped = msg.data.clowns && msg.data.clowns.some(c => c.popped);
          if (anyPopped) {
            targetBar.textContent = 'GAME OVER!';
            targetBar.style.background = 'rgba(255, 0, 0, 0.6)';
            targetBar.style.color = '#fff';
          } else {
            targetBar.textContent = 'Waiting for game to start...';
            targetBar.style.background = 'rgba(255, 0, 222, 0.3)';
            targetBar.style.color = '#ff00de';
          }
        }
      }

      if (mySid && msg.data.players && msg.data.players[mySid]) {
        myScore = msg.data.players[mySid].score;
        scoreDisplay.textContent = myScore;
      }
    } else if (msg.type === 'balloon_popped') {
      playBuzzSound();
      // Show +100 bonus flash if this player shot the winning clown
      if (msg.bonuses && myName && msg.bonuses[myName]) {
        showBonusFlash(msg.bonuses[myName]);
        // Update score display immediately with bonus
        myScore += msg.bonuses[myName];
        if (scoreDisplay) scoreDisplay.textContent = myScore;
      }
    }
  };
}

function showBonusFlash(amount) {
  let flash = document.getElementById('bonus-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'bonus-flash';
    flash.style.cssText = 'position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; pointer-events: none;';
    document.body.appendChild(flash);
  }
  flash.innerHTML = '<div style="font-size: 3rem; font-weight: bold; color: #ffd700; text-shadow: 0 0 20px #ffd700, 0 0 40px #ff7b00; animation: bonus-pop 1.5s ease-out forwards;">+' + amount + ' BONUS!</div>';

  // Remove after animation
  setTimeout(() => { if (flash) flash.innerHTML = ''; }, 1500);
}

async function startCamera() {
  console.log('startCamera called');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    console.log('Camera stream obtained');
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      console.log('Video metadata loaded, playing...');
      video.play();
      startTracking();
      setupZoom(stream);
    };
  } catch (e) {
    console.error('Camera error:', e);
    alert('Camera access is required to aim at the screen! Error: ' + e.message);
  }
}

function setupZoom(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  const capabilities = track.getCapabilities();
  console.log('Camera capabilities:', capabilities);

  if (!capabilities.zoom) {
    console.log('Zoom not supported on this camera');
    return;
  }

  const zoomControls = document.getElementById('zoom-controls');
  const zoomIn = document.getElementById('zoom-in');
  const zoomOut = document.getElementById('zoom-out');
  if (!zoomControls || !zoomIn || !zoomOut) return;

  const min = capabilities.zoom.min || 1;
  const max = capabilities.zoom.max || 10;
  const step = (max - min) / 10;
  let currentZoom = min;

  zoomControls.classList.remove('hidden');

  zoomIn.addEventListener('click', () => {
    currentZoom = Math.min(max, currentZoom + step);
    track.applyConstraints({advanced: [{zoom: currentZoom}]})
      .then(() => console.log('Zoom in to', currentZoom))
      .catch(err => console.error('Zoom failed:', err));
  });

  zoomOut.addEventListener('click', () => {
    currentZoom = Math.max(min, currentZoom - step);
    track.applyConstraints({advanced: [{zoom: currentZoom}]})
      .then(() => console.log('Zoom out to', currentZoom))
      .catch(err => console.error('Zoom failed:', err));
  });
}

function startTracking() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently:true});

  // Debug overlay: triple-tap lock indicator to toggle
  let debugTaps = 0;
  let debugVisible = false;
  let debugEl = null;
  if (lockIndicator) {
    lockIndicator.addEventListener('click', () => {
      debugTaps++;
      setTimeout(() => debugTaps = 0, 500);
      if (debugTaps >= 3) {
        debugVisible = !debugVisible;
        if (!debugEl) {
          debugEl = document.createElement('div');
          debugEl.id = 'color-debug';
          debugEl.style.cssText = 'position:fixed;top:50px;left:10px;z-index:30;background:rgba(0,0,0,0.8);color:#0f0;font-family:monospace;font-size:12px;padding:8px;border-radius:6px;pointer-events:none;';
          document.body.appendChild(debugEl);
        }
        debugEl.style.display = debugVisible ? 'block' : 'none';
      }
    });
  }

  // Sample a 5x5 pixel region around center and average for stability
  function sampleCenter() {
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const size = 5;
    const half = Math.floor(size / 2);
    const frame = ctx.getImageData(cx - half, cy - half, size, size).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < frame.length; i += 4) {
      r += frame[i];
      g += frame[i + 1];
      b += frame[i + 2];
      count++;
    }
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  }

  function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const [r, g, b] = sampleCenter();

      if (debugVisible && debugEl) {
        let best = null;
        let bestDist = Infinity;
        for (const t of TARGETS) {
          const d = Math.sqrt((r-t.color[0])**2 + (g-t.color[1])**2 + (b-t.color[2])**2);
          if (d < bestDist) { bestDist = d; best = t; }
        }
        debugEl.innerHTML = 'RGB: ' + r + ',' + g + ',' + b + '<br>Best: ' + (best ? best.name : 'none') + ' dist=' + Math.round(bestDist) + '<br>Tol: ' + COLOR_TOLERANCE;
      }

      let best = null;
      let bestDist = Infinity;
      for (const t of TARGETS) {
        const d = Math.sqrt((r-t.color[0])**2 + (g-t.color[1])**2 + (b-t.color[2])**2);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }

      if (best && bestDist < COLOR_TOLERANCE) {
        if (currentTarget !== best.id) {
          currentTarget = best.id;
          lockIndicator.textContent = gameActive ? 'LOCKED: ' + best.name + ' - AUTO-FIRING!' : 'LOCKED: ' + best.name + ' - Waiting for game...';
          lockIndicator.style.color = 'rgb(' + best.color.join(',') + ')';
          if (crosshair) crosshair.classList.add('locked');
          if (targetBar && gameActive) {
            targetBar.textContent = 'TARGET: ' + best.name;
            targetBar.style.background = 'rgba(' + best.color.join(',') + ', 0.6)';
            targetBar.style.color = '#fff';
            targetBar.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
          }
          // Haptic feedback on lock
          if (navigator.vibrate) navigator.vibrate(40);
          playShotSound(400);
          if (gameActive) {
            startShooting();
          }
        }
      } else {
        if (currentTarget !== null) {
          currentTarget = null;
          lockIndicator.textContent = 'Aim at a clown mouth...';
          lockIndicator.style.color = '#fff';
          if (crosshair) crosshair.classList.remove('locked');
          if (targetBar && gameActive) {
            targetBar.textContent = 'Aim at a clown mouth...';
            targetBar.style.background = 'rgba(0,0,0,0.5)';
            targetBar.style.color = '#ccc';
            targetBar.style.textShadow = 'none';
          }
          stopShooting();
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function startShooting() {
  if (currentTarget === null || shootInterval || !gameActive) return;
  ws.send(JSON.stringify({action:'shoot', clown_id: currentTarget}));
  if (navigator.vibrate) navigator.vibrate(15);
  playShotSound(800);
  showPointFlash();
  shootInterval = setInterval(() => {
    if (currentTarget !== null && gameActive) {
      ws.send(JSON.stringify({action:'shoot', clown_id: currentTarget}));
      if (navigator.vibrate) navigator.vibrate(10);
      playShotSound(800);
      showPointFlash();
    }
  }, 100);
}

// Floating +1 visual feedback for each shot
function showPointFlash() {
  const el = document.createElement('div');
  el.className = 'point-flash';
  el.textContent = '+1';
  // Random horizontal position 10-90%
  const left = 10 + Math.random() * 80;
  el.style.left = left + '%';
  el.style.top = '12%';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

function stopShooting() {
  if (shootInterval) {
    clearInterval(shootInterval);
    shootInterval = null;
  }
}

// ==================== iOS "Add to Home Screen" prompt ====================
(function initInstallBanner() {
  // Show on iOS Safari (including iPad which reports as desktop UA)
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true;
  const dismissed = localStorage.getItem('bwr_install_dismissed');

  if (!isIos || isStandalone || dismissed) return;

  const banner = document.getElementById('ios-install-banner');
  const dismissBtn = document.getElementById('ios-install-dismiss');
  if (!banner || !dismissBtn) return;

  banner.classList.remove('hidden');

  dismissBtn.addEventListener('click', () => {
    banner.classList.add('hidden');
    localStorage.setItem('bwr_install_dismissed', '1');
  });
})();
