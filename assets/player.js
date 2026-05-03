const TARGETS = [
  {id:0, name:"Bozo", color:[255,0,85]},
  {id:1, name:"Chuckles", color:[0,255,0]},
  {id:2, name:"Sprinkles", color:[0,200,255]},
  {id:3, name:"Wiggles", color:[255,255,0]},
  {id:4, name:"Puddles", color:[255,100,0]}
];
const COLOR_TOLERANCE = 90;

// Extract game ID from URL path: /player/<id>
const GAME_ID = window.location.pathname.split('/')[2] || 'default';
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/${GAME_ID}`);
let myName = '';
let mySid = null;
let myScore = 0;
let currentTarget = null;
let shootInterval = null;

let gameActive = false;
let currentClownFill = 0;
let currentClownMax = 300;

const joinPanel = document.getElementById('join-panel');
const gamePanel = document.getElementById('game-panel');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const video = document.getElementById('camera');
const lockIndicator = document.getElementById('lock-indicator');
const crosshair = document.querySelector('.crosshair');
const scoreDisplay = document.getElementById('player-score');
const targetBar = document.getElementById('target-bar');

joinBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return;
  myName = name;
  ws.send(JSON.stringify({action:'join', name}));
};

// Start camera immediately so players can practice aiming while waiting
startCamera();

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
            targetBar.textContent = `TARGET: ${t.name}`;
            targetBar.style.background = `rgba(${t.color.join(',')}, 0.6)`;
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
  }
};

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

  function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const frame = ctx.getImageData(cx, cy, 1, 1).data;
      const [r, g, b] = frame;

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
          lockIndicator.textContent = gameActive ? `LOCKED: ${best.name} - AUTO-FIRING!` : `LOCKED: ${best.name} - Waiting for game...`;
          lockIndicator.style.color = `rgb(${best.color.join(',')})`;
          if (crosshair) crosshair.classList.add('locked');
          if (targetBar && gameActive) {
            targetBar.textContent = `TARGET: ${best.name}`;
            targetBar.style.background = `rgba(${best.color.join(',')}, 0.6)`;
            targetBar.style.color = '#fff';
            targetBar.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
          }
          // Haptic feedback on lock
          if (navigator.vibrate) navigator.vibrate(40);
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
  shootInterval = setInterval(() => {
    if (currentTarget !== null && gameActive) {
      ws.send(JSON.stringify({action:'shoot', clown_id: currentTarget}));
      if (navigator.vibrate) navigator.vibrate(10);
    }
  }, 100);
}

function stopShooting() {
  if (shootInterval) {
    clearInterval(shootInterval);
    shootInterval = null;
  }
}
