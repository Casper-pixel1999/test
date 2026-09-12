(function () {
  'use strict';

  var STATE = { MENU: 'MENU', PLAY: 'PLAY', PAUSE: 'PAUSE', GAMEOVER: 'GAMEOVER', AD: 'AD' };

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d', { alpha: false });

  var state = STATE.MENU;
  var W = 360, H = 640, dpr = 1;
  var letterbox = { x: 0, y: 0, w: 0, h: 0, scale: 1 };

  var player = { x: 0.5, y: 0.82, w: 0.07, h: 0.05, vx: 0 };
  var gates = [];
  var orbs = [];
  var particles = [];
  var score = 0;
  var combo = 0;
  var bestDisplay = 0;
  var scrollSpeed = 0.22;
  var gateWidth = 0.38;
  var shake = 0;
  var continuedThisRun = false;
  var doubledThisRun = false;
  var runAlive = false;
  var lastTs = 0;
  var inputLeft = false;
  var inputRight = false;
  var mouseSteer = null;
  var loadingReadyCalled = false;
  var audioCtx = null;
  var soundPrimed = false;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function resize() {
    var vv = window.visualViewport;
    var vw = vv ? vv.width : window.innerWidth;
    var vh = vv ? vv.height : window.innerHeight;
    var root = document.getElementById('game-root');
    if (root) {
      root.style.width = vw + 'px';
      root.style.height = vh + 'px';
    }
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    // Design aspect: portrait long:short <= 2:1
    var aspect = vw / vh;
    var targetAspect = 9 / 16;
    var maxAspect = 1 / 2; // short/long for portrait = 0.5 means 2:1 long:short
    var drawW, drawH, ox, oy;

    // Prefer filling portrait; letterbox if too wide or too tall beyond 2:1
    if (aspect > 0.75) {
      // landscape-ish: fit height, letterbox sides, cap width to 0.75*H style
      drawH = vh;
      drawW = drawH * targetAspect;
      if (drawW > vw) {
        drawW = vw;
        drawH = drawW / targetAspect;
      }
    } else if (aspect < maxAspect) {
      // too tall: letterbox top/bottom to max 2:1
      drawW = vw;
      drawH = drawW / maxAspect;
    } else {
      drawW = vw;
      drawH = vh;
    }
    ox = (vw - drawW) / 2;
    oy = (vh - drawH) / 2;

    letterbox = { x: ox, y: oy, w: drawW, h: drawH, scale: drawW / 360 };
    W = Math.round(360);
    H = Math.round(360 * (drawH / drawW));

    canvas.style.width = drawW + 'px';
    canvas.style.height = drawH + 'px';
    canvas.style.position = 'absolute';
    canvas.style.left = ox + 'px';
    canvas.style.top = oy + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function showScreen(id) {
    ['screen-menu', 'screen-how', 'screen-hud', 'screen-pause', 'screen-gameover', 'screen-ad'].forEach(function (s) {
      var el = document.getElementById(s);
      if (!el) return;
      if (s === id) el.classList.add('active');
      else el.classList.remove('active');
    });
  }

  function updateSoundButtons() {
    var on = Saves.getSoundOn();
    var icon = on ? I18n.t('soundOn') : I18n.t('soundOff');
    var a = document.getElementById('btn-sound');
    var b = document.getElementById('btn-pause-sound');
    if (a) { a.textContent = icon; a.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (b) { b.textContent = icon; }
    SdkBridge.setMute(!on || state === STATE.PAUSE || state === STATE.AD || document.hidden);
  }

  function refreshBestUI() {
    bestDisplay = Saves.getBest();
    var v = document.getElementById('val-best');
    var g = document.getElementById('val-go-best');
    if (v) v.textContent = String(bestDisplay);
    if (g) g.textContent = String(bestDisplay);
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
  }

  function primeAudio() {
    var ac = ensureAudio();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    // silent buffer to unlock
    try {
      var buf = ac.createBuffer(1, 1, 22050);
      var src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
      soundPrimed = true;
    } catch (e) {}
  }

  function beep(freq, dur, type, gain) {
    if (!Saves.getSoundOn() || window.__gameMuted) return;
    var ac = ensureAudio();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    var t0 = ac.currentTime;
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.12));
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + (dur || 0.12) + 0.02);
  }

  function sfxScore() { beep(660, 0.08, 'square', 0.06); setTimeout(function () { beep(990, 0.1, 'square', 0.05); }, 40); }
  function sfxOrb() { beep(880, 0.06, 'sine', 0.07); beep(1320, 0.1, 'triangle', 0.04); }
  function sfxFail() { beep(180, 0.25, 'sawtooth', 0.09); setTimeout(function () { beep(110, 0.35, 'sawtooth', 0.07); }, 80); }
  function sfxClick() { beep(440, 0.05, 'triangle', 0.05); }

  function spawnParticles(nx, ny, color, n) {
    for (var i = 0; i < (n || 12); i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 0.08 + Math.random() * 0.25;
      particles.push({
        x: nx, y: ny,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5,
        color: color || '#7fffd4',
        size: 1.5 + Math.random() * 2.5
      });
    }
  }

  function resetRun() {
    player.x = 0.5;
    player.y = 0.82;
    player.vx = 0;
    gates = [];
    orbs = [];
    particles = [];
    score = 0;
    combo = 0;
    scrollSpeed = 0.22;
    gateWidth = 0.38;
    shake = 0;
    continuedThisRun = false;
    doubledThisRun = false;
    runAlive = true;
    inputLeft = false;
    inputRight = false;
    mouseSteer = null;
    // seed first gates
    var y = -0.15;
    for (var i = 0; i < 5; i++) {
      pushGate(y);
      y -= 0.38 + Math.random() * 0.08;
    }
    updateHud();
  }

  function pushGate(y) {
    var opening = gateWidth;
    var cx = 0.2 + Math.random() * 0.6;
    cx = clamp(cx, opening / 2 + 0.05, 1 - opening / 2 - 0.05);
    gates.push({
      y: y,
      cx: cx,
      opening: opening,
      h: 0.045,
      passed: false
    });
    // orb between gates sometimes
    if (Math.random() < 0.55) {
      orbs.push({
        x: clamp(cx + (Math.random() - 0.5) * 0.25, 0.12, 0.88),
        y: y - 0.18 - Math.random() * 0.08,
        r: 0.022,
        taken: false
      });
    }
  }

  function difficultyStep() {
    scrollSpeed = Math.min(0.55, 0.22 + score * 0.008);
    gateWidth = Math.max(0.22, 0.38 - score * 0.0045);
  }

  function updateHud() {
    var s = document.getElementById('val-score');
    var c = document.getElementById('val-combo');
    var wrap = document.getElementById('combo-wrap');
    if (s) s.textContent = String(score);
    if (c) c.textContent = String(Math.max(1, combo));
    if (wrap) {
      if (combo >= 2) wrap.classList.add('show');
      else wrap.classList.remove('show');
    }
  }

  function startPlay() {
    primeAudio();
    sfxClick();
    resetRun();
    Saves.incGamesPlayed();
    state = STATE.PLAY;
    showScreen('screen-hud');
    SdkBridge.setMute(!Saves.getSoundOn());
    SdkBridge.gameplayStart();
  }

  function goMenu() {
    SdkBridge.gameplayStop();
    runAlive = false;
    state = STATE.MENU;
    showScreen('screen-menu');
    refreshBestUI();
    updateSoundButtons();
  }

  function pauseGame() {
    if (state !== STATE.PLAY) return;
    state = STATE.PAUSE;
    SdkBridge.gameplayStop();
    SdkBridge.setMute(true);
    showScreen('screen-pause');
    updateSoundButtons();
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    state = STATE.PLAY;
    showScreen('screen-hud');
    SdkBridge.setMute(!Saves.getSoundOn());
    SdkBridge.gameplayStart();
  }

  function fail() {
    if (!runAlive || state !== STATE.PLAY) return;
    runAlive = false;
    shake = 12;
    sfxFail();
    SdkBridge.gameplayStop();
    SdkBridge.setMute(true);
    Saves.setBest(score);
    refreshBestUI();

    state = STATE.AD;
    showScreen('screen-ad');

    Ads.onGameOverInterstitial({
      onBeforeAd: function () {},
      onAfterAd: function () {
        SdkBridge.setMute(!Saves.getSoundOn());
      }
    }).then(function () {
      enterGameOver();
    });
  }

  function enterGameOver() {
    state = STATE.GAMEOVER;
    showScreen('screen-gameover');
    var gs = document.getElementById('val-go-score');
    if (gs) gs.textContent = String(score);
    refreshBestUI();

    var btnC = document.getElementById('btn-continue');
    var btnD = document.getElementById('btn-double');
    if (btnC) {
      if (!continuedThisRun) btnC.classList.remove('hidden');
      else btnC.classList.add('hidden');
    }
    if (btnD) {
      if (!doubledThisRun && score > 0) btnD.classList.remove('hidden');
      else btnD.classList.add('hidden');
    }
    updateSoundButtons();
  }

  function continueRun() {
    continuedThisRun = true;
    runAlive = true;
    player.x = 0.5;
    player.vx = 0;
    // clear nearby hazards
    gates.forEach(function (g) {
      if (g.y > player.y - 0.2 && g.y < player.y + 0.15) g.passed = true;
    });
    shake = 0;
    state = STATE.PLAY;
    showScreen('screen-hud');
    SdkBridge.setMute(!Saves.getSoundOn());
    SdkBridge.gameplayStart();
    var btnC = document.getElementById('btn-continue');
    if (btnC) btnC.classList.add('hidden');
  }

  function update(dt) {
    if (state !== STATE.PLAY || !runAlive) {
      // still update particles for juice
      updateParticles(dt);
      if (shake > 0) shake = Math.max(0, shake - dt * 40);
      return;
    }

    var steer = 0;
    if (inputLeft) steer -= 1;
    if (inputRight) steer += 1;
    if (mouseSteer != null) {
      var target = mouseSteer;
      var diff = target - player.x;
      steer = clamp(diff * 8, -1, 1);
    }
    player.vx = steer * 1.35;
    player.x += player.vx * dt;
    player.x = clamp(player.x, 0.04, 0.96);

    // leave screen fail (extra margin)
    if (player.x <= 0.02 || player.x >= 0.98) {
      fail();
      return;
    }

    var i, g, o;
    for (i = 0; i < gates.length; i++) {
      gates[i].y += scrollSpeed * dt;
    }
    for (i = 0; i < orbs.length; i++) {
      orbs[i].y += scrollSpeed * dt;
    }

    // recycle
    while (gates.length && gates[0].y > 1.15) gates.shift();
    while (orbs.length && (orbs[0].y > 1.2 || orbs[0].taken)) {
      if (orbs[0].taken || orbs[0].y > 1.2) orbs.shift();
      else break;
    }
    var topY = gates.length ? gates[gates.length - 1].y : 0;
    while (topY > -0.8) {
      topY -= 0.36 + Math.random() * 0.1;
      pushGate(topY);
    }

    // collisions
    var px = player.x;
    var py = player.y;
    var pw = player.w * 0.55;
    for (i = 0; i < gates.length; i++) {
      g = gates[i];
      var gy = g.y;
      var halfH = g.h / 2;
      if (py + player.h * 0.3 > gy - halfH && py - player.h * 0.2 < gy + halfH) {
        var leftWall = g.cx - g.opening / 2;
        var rightWall = g.cx + g.opening / 2;
        if (px - pw < leftWall || px + pw > rightWall) {
          spawnParticles(px, py, '#ff6b9d', 18);
          fail();
          return;
        }
        if (!g.passed && py < gy) {
          g.passed = true;
          combo += 1;
          score += 1 + Math.floor((combo - 1) / 3);
          difficultyStep();
          updateHud();
          sfxScore();
          spawnParticles(g.cx, gy, '#7fffd4', 14);
        }
      }
    }

    for (i = 0; i < orbs.length; i++) {
      o = orbs[i];
      if (o.taken) continue;
      var dx = o.x - px;
      var dy = o.y - py;
      if (dx * dx + dy * dy < (o.r + pw) * (o.r + pw)) {
        o.taken = true;
        score += 2 + Math.min(5, combo);
        updateHud();
        sfxOrb();
        spawnParticles(o.x, o.y, '#ffd56a', 10);
      }
    }

    updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.15 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawBg() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0a1e');
    g.addColorStop(0.5, '#080818');
    g.addColorStop(1, '#050510');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // grid lines
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.07)';
    ctx.lineWidth = 1;
    var t = performance.now() * 0.00005;
    for (var i = 0; i < 12; i++) {
      var yy = ((i / 12 + t) % 1) * H;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
    for (var j = 0; j < 8; j++) {
      var xx = (j / 8) * W;
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, H);
      ctx.stroke();
    }
    ctx.restore();
  }

  function nx(x) { return x * W; }
  function ny(y) { return y * H; }

  function drawGates() {
    for (var i = 0; i < gates.length; i++) {
      var g = gates[i];
      var y = ny(g.y);
      var h = Math.max(8, g.h * H);
      var left = 0;
      var openL = nx(g.cx - g.opening / 2);
      var openR = nx(g.cx + g.opening / 2);
      var right = W;

      // left wall
      drawNeonRect(left, y - h / 2, openL - left, h, '#ff2d6a', '#ff6b9d');
      // right wall
      drawNeonRect(openR, y - h / 2, right - openR, h, '#ff2d6a', '#ff6b9d');
      // opening glow
      ctx.save();
      ctx.fillStyle = 'rgba(0, 255, 200, 0.08)';
      ctx.fillRect(openL, y - h / 2 - 4, openR - openL, h + 8);
      ctx.strokeStyle = 'rgba(0, 255, 200, 0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(openL, y - h / 2, openR - openL, h);
      ctx.restore();
    }
  }

  function drawNeonRect(x, y, w, h, core, glow) {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = core;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, w, Math.max(2, h * 0.25));
    ctx.restore();
  }

  function drawOrbs() {
    var t = performance.now() * 0.005;
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      if (o.taken) continue;
      var x = nx(o.x);
      var y = ny(o.y);
      var r = o.r * Math.min(W, H) * (1 + 0.1 * Math.sin(t + i));
      ctx.save();
      ctx.shadowColor = '#ffd56a';
      ctx.shadowBlur = 16;
      var grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, '#fff6c8');
      grd.addColorStop(0.5, '#ffd56a');
      grd.addColorStop(1, 'rgba(255, 160, 40, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPlayer() {
    var x = nx(player.x);
    var y = ny(player.y);
    var hw = player.w * W * 0.5;
    var hh = player.h * H;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = '#00ffc8';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(hw, hh * 0.6);
    ctx.lineTo(0, hh * 0.25);
    ctx.lineTo(-hw, hh * 0.6);
    ctx.closePath();
    var grd = ctx.createLinearGradient(0, -hh, 0, hh);
    grd.addColorStop(0, '#e8ffff');
    grd.addColorStop(0.4, '#7fffd4');
    grd.addColorStop(1, '#00aaff');
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // engine
    ctx.shadowColor = '#00aaff';
    ctx.beginPath();
    ctx.moveTo(-hw * 0.3, hh * 0.5);
    ctx.lineTo(0, hh * 0.5 + 6 + Math.random() * 6);
    ctx.lineTo(hw * 0.3, hh * 0.5);
    ctx.fillStyle = 'rgba(100, 200, 255, 0.7)';
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.save();
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(nx(p.x), ny(p.y), p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function draw() {
    var ox = 0, oy = 0;
    if (shake > 0) {
      ox = (Math.random() - 0.5) * shake;
      oy = (Math.random() - 0.5) * shake;
    }
    ctx.save();
    ctx.translate(ox, oy);
    drawBg();
    if (state === STATE.PLAY || state === STATE.PAUSE || state === STATE.GAMEOVER || state === STATE.AD) {
      drawGates();
      drawOrbs();
      drawPlayer();
      drawParticles();
    } else if (state === STATE.MENU) {
      // decorative idle scene
      drawIdleDecor();
    }
    ctx.restore();
  }

  function drawIdleDecor() {
    var t = performance.now() * 0.001;
    // floating gate preview
    var gy = H * 0.35 + Math.sin(t) * 8;
    var open = W * 0.36;
    var cx = W * 0.5;
    drawNeonRect(0, gy, cx - open / 2, 18, '#ff2d6a', '#ff6b9d');
    drawNeonRect(cx + open / 2, gy, W - (cx + open / 2), 18, '#ff2d6a', '#ff6b9d');
    // ship
    player.x = 0.5 + Math.sin(t * 0.7) * 0.08;
    player.y = 0.72;
    drawPlayer();
    // orbs
    for (var i = 0; i < 3; i++) {
      var ox = 0.3 + i * 0.2;
      var oy = 0.45 + Math.sin(t + i) * 0.04;
      orbs = [{ x: ox, y: oy, r: 0.02, taken: false }];
      drawOrbs();
    }
    orbs = [];
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    if (SdkBridge.isPaused() && state === STATE.PLAY) {
      pauseGame();
    }

    if (!(SdkBridge.isPaused() && state === STATE.PAUSE)) {
      update(dt);
    }
    draw();
    requestAnimationFrame(loop);
  }

  function setZoneVisual() {
    var zl = document.getElementById('zone-left');
    var zr = document.getElementById('zone-right');
    if (zl) zl.classList.toggle('active', inputLeft);
    if (zr) zr.classList.toggle('active', inputRight);
  }

  function pointerToNormX(clientX) {
    var rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  }

  function bindInput() {
    window.addEventListener('keydown', function (e) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { inputLeft = true; e.preventDefault(); }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { inputRight = true; e.preventDefault(); }
      if (e.code === 'Escape' && state === STATE.PLAY) pauseGame();
      setZoneVisual();
    }, { passive: false });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') inputLeft = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') inputRight = false;
      setZoneVisual();
    });

    function onPointerDown(e) {
      if (state !== STATE.PLAY) return;
      var x = pointerToNormX(e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0));
      if (e.pointerType === 'mouse' && e.button === 0) {
        mouseSteer = x;
      } else {
        if (x < 0.5) { inputLeft = true; inputRight = false; }
        else { inputRight = true; inputLeft = false; }
      }
      setZoneVisual();
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (state !== STATE.PLAY) return;
      if (e.pointerType === 'mouse' && (e.buttons & 1)) {
        mouseSteer = pointerToNormX(e.clientX);
      } else if (e.pointerType !== 'mouse') {
        var x = pointerToNormX(e.clientX);
        if (x < 0.5) { inputLeft = true; inputRight = false; }
        else { inputRight = true; inputLeft = false; }
        setZoneVisual();
      }
    }
    function onPointerUp(e) {
      if (e.pointerType === 'mouse') mouseSteer = null;
      inputLeft = false;
      inputRight = false;
      setZoneVisual();
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: false });

    var zones = document.getElementById('touch-zones');
    if (zones) {
      zones.addEventListener('pointerdown', function (e) {
        if (state !== STATE.PLAY) return;
        var x = pointerToNormX(e.clientX);
        if (x < 0.5) { inputLeft = true; inputRight = false; }
        else { inputRight = true; inputLeft = false; }
        setZoneVisual();
        e.preventDefault();
      }, { passive: false });
      zones.addEventListener('pointerup', onPointerUp, { passive: false });
      zones.addEventListener('pointercancel', onPointerUp, { passive: false });
    }

    // mouse move steer without press on desktop
    canvas.addEventListener('mousemove', function (e) {
      if (state !== STATE.PLAY) return;
      if (e.buttons === 0 && matchMedia('(pointer:fine)').matches) {
        mouseSteer = pointerToNormX(e.clientX);
      }
    });

    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('selectstart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) {
      if (e.target === canvas || (e.target.closest && e.target.closest('#game-root'))) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  function bindUI() {
    document.getElementById('btn-play').addEventListener('click', function () {
      if (Ads.isAdShowing()) return;
      startPlay();
    });
    document.getElementById('btn-how').addEventListener('click', function () {
      sfxClick();
      showScreen('screen-how');
    });
    document.getElementById('btn-how-back').addEventListener('click', function () {
      sfxClick();
      showScreen('screen-menu');
    });
    document.getElementById('btn-sound').addEventListener('click', function () {
      Saves.setSoundOn(!Saves.getSoundOn());
      updateSoundButtons();
      primeAudio();
      sfxClick();
    });
    document.getElementById('btn-pause-sound').addEventListener('click', function () {
      Saves.setSoundOn(!Saves.getSoundOn());
      updateSoundButtons();
      sfxClick();
    });
    document.getElementById('btn-pause').addEventListener('click', function () {
      pauseGame();
    });
    document.getElementById('btn-resume').addEventListener('click', function () {
      sfxClick();
      resumeGame();
    });
    document.getElementById('btn-pause-menu').addEventListener('click', function () {
      sfxClick();
      goMenu();
    });
    document.getElementById('btn-restart').addEventListener('click', function () {
      if (Ads.isAdShowing()) return;
      startPlay();
    });
    document.getElementById('btn-go-menu').addEventListener('click', function () {
      if (Ads.isAdShowing()) return;
      sfxClick();
      goMenu();
    });
    document.getElementById('btn-continue').addEventListener('click', function () {
      if (Ads.isAdShowing() || continuedThisRun) return;
      state = STATE.AD;
      showScreen('screen-ad');
      Ads.showRewardedContinue({
        onRewarded: function () {
          // grant ONLY here
          continueRun();
        },
        onAfterAd: function () {
          SdkBridge.setMute(!Saves.getSoundOn());
          if (!runAlive || state === STATE.AD) {
            // closed without reward
            if (state === STATE.AD && !runAlive) enterGameOver();
            else if (state === STATE.AD && continuedThisRun) { /* already continued */ }
            else if (state === STATE.AD) enterGameOver();
          }
        }
      }).then(function (res) {
        if (!res.rewarded && state === STATE.AD) enterGameOver();
      });
    });
    document.getElementById('btn-double').addEventListener('click', function () {
      if (Ads.isAdShowing() || doubledThisRun) return;
      state = STATE.AD;
      showScreen('screen-ad');
      Ads.showRewardedDouble({
        onRewarded: function () {
          doubledThisRun = true;
          score = score * 2;
          Saves.setBest(score);
          var gs = document.getElementById('val-go-score');
          if (gs) gs.textContent = String(score);
          refreshBestUI();
          var btnD = document.getElementById('btn-double');
          if (btnD) btnD.classList.add('hidden');
          sfxScore();
        },
        onAfterAd: function () {
          SdkBridge.setMute(!Saves.getSoundOn());
          if (state === STATE.AD) enterGameOver();
        }
      }).then(function () {
        if (state === STATE.AD) enterGameOver();
      });
    });
  }

  function firstPaintThenReady() {
    // wait a frame after menu shown
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!loadingReadyCalled) {
          loadingReadyCalled = true;
          primeAudio();
          SdkBridge.ready();
        }
      });
    });
  }

  function boot() {
    resize();
    window.addEventListener('resize', resize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resize);
      window.visualViewport.addEventListener('scroll', resize);
    }

    SdkBridge.init().then(function () {
      var lang = I18n.detect(SdkBridge.getLang());
      I18n.setLang(lang);
      I18n.applyDom();
      document.documentElement.lang = lang;

      return Saves.load();
    }).then(function () {
      refreshBestUI();
      updateSoundButtons();
      bindInput();
      bindUI();
      showScreen('screen-menu');
      state = STATE.MENU;

      SdkBridge.onPauseChange(function (paused) {
        if (paused && state === STATE.PLAY) pauseGame();
        updateSoundButtons();
      });

      requestAnimationFrame(loop);
      firstPaintThenReady();
    }).catch(function () {
      I18n.setLang('ru');
      I18n.applyDom();
      bindInput();
      bindUI();
      showScreen('screen-menu');
      requestAnimationFrame(loop);
      firstPaintThenReady();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
