// Renderer: draws one game snapshot onto the canvas. Purely presentational: it never changes game state.
// Everything is drawn in world units (a fixed 360 x 640 portrait world) and scaled to the canvas.
// Layers, back to front: sky, sun, clouds, hills, obstacles, player, particles, ground, score, effects, debug.

const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif';

const PAL = {
    skyTop: '#5bbcf2',
    skyBottom: '#d9f3ff',
    sun: '#fff3b0',
    cloud: '#ffffff',
    hillFar: '#a9dccb',
    hillNear: '#7cc79f',
    hillNearDark: '#64b389',
    pillar: '#7b6cf6',
    pillarLight: '#a49bff',
    pillarDark: '#5b4bd6',
    pillarBand: 'rgba(59, 47, 143, 0.25)',
    outline: '#3b2f8f',
    bird: '#ff8a3d',
    birdDark: '#e0682a',
    birdOutline: '#7a3210',
    belly: '#ffd9b0',
    wing: '#ffb36b',
    beak: '#ffc93c',
    eye: '#ffffff',
    pupil: '#2b1a10',
    grass: '#79d36a',
    grassDark: '#5fbf52',
    grassEdge: '#3f8f3a',
    dirt: '#e2be86',
    dirtLight: '#ecd09f',
    ink: '#2a2140',
};

export function createRenderer(canvas, config) {
    const ctx = canvas.getContext('2d');
    const W = config.worldWidth;
    const H = config.worldHeight;
    const GY = config.groundY;
    const fx = { scorePop: 0, flash: 0, shake: 0, fade: 0 };
    const particles = Array.from({ length: 10 }, () => ({ life: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0 }));
    const clouds = makeClouds();
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    // Visible area in world units. Taller-than-9:16 screens see extra sky above and ground below.
    const view = { top: 0, bottom: H, left: 0, right: W };

    const sky = ctx.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, PAL.skyTop);
    sky.addColorStop(1, PAL.skyBottom);

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        scale = Math.min(w / W, h / H);
        offsetX = (w - W * scale) / 2;
        offsetY = (h - H * scale) / 2;
        // Pad by the largest screen-shake offset so shaking never reveals an unpainted edge.
        view.top = -offsetY / scale - 8;
        view.bottom = H + offsetY / scale + 8;
        view.left = -offsetX / scale - 8;
        view.right = W + offsetX / scale + 8;
    }

    function onEvent(event, s) {
        switch (event) {
            case 'Scored':
                fx.scorePop = 0.2;
                break;
            case 'HitObstacle':
            case 'HitBoundary':
                fx.flash = 0.2;
                fx.shake = 0.3;
                burstFeathers(s);
                break;
            case 'HitGround':
                fx.flash = 0.14;
                fx.shake = 0.22;
                burstFeathers(s);
                break;
            case 'Restarted':
                fx.fade = 0.3;
                break;
        }
    }

    function burstFeathers(s) {
        particles.forEach((p, i) => {
            const angle = (i / particles.length) * Math.PI * 2 + Math.random() * 0.5;
            const speed = 60 + Math.random() * 90;
            p.life = 0.7 + Math.random() * 0.3;
            p.x = s.playerX;
            p.y = s.playerY;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 60;
            p.rot = Math.random() * Math.PI;
            p.spin = (Math.random() * 2 - 1) * 8;
        });
    }

    function draw(s, dt, fps) {
        resize();
        for (const key in fx) fx[key] = Math.max(0, fx[key] - dt);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let shakeX = 0;
        let shakeY = 0;
        if (fx.shake > 0) {
            const magnitude = 6 * (fx.shake / 0.3);
            shakeX = (Math.random() * 2 - 1) * magnitude;
            shakeY = (Math.random() * 2 - 1) * magnitude;
        }
        ctx.setTransform(scale, 0, 0, scale, offsetX + shakeX * scale, offsetY + shakeY * scale);

        drawSky();
        drawClouds(s);
        drawHills(s);
        for (const o of s.obstacles) drawObstaclePair(o);
        drawPlayer(s);
        drawParticles(dt);
        drawGround(s);
        if (s.debug) drawHitboxes(s);
        drawScore(s);
        drawOverlayEffects();
        if (s.debug) drawDebugPanel(s, fps);
    }

    // ---------- Background ----------

    function drawSky() {
        ctx.fillStyle = PAL.skyTop;
        ctx.fillRect(view.left, view.top, view.right - view.left, -view.top);
        ctx.fillStyle = sky;
        ctx.fillRect(view.left, 0, view.right - view.left, GY + 2);

        ctx.fillStyle = 'rgba(255, 243, 176, 0.35)';
        circle(285, 120, 46);
        ctx.fill();
        ctx.fillStyle = PAL.sun;
        circle(285, 120, 32);
        ctx.fill();
    }

    function drawClouds(s) {
        const tile = 720;
        const shift = s.scroll * 0.08 + s.time * 5;
        ctx.fillStyle = PAL.cloud;
        for (const c of clouds) {
            const x = mod(c.x - shift, tile) - 90;
            if (x > W + 60) continue;
            ctx.globalAlpha = c.alpha;
            ctx.beginPath();
            ctx.arc(x, c.y, 18 * c.size, 0, Math.PI * 2);
            ctx.arc(x + 20 * c.size, c.y - 9 * c.size, 22 * c.size, 0, Math.PI * 2);
            ctx.arc(x + 44 * c.size, c.y, 17 * c.size, 0, Math.PI * 2);
            ctx.rect(x, c.y, 44 * c.size, 17 * c.size);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawHills(s) {
        hillLayer(s.scroll * 0.15, GY - 95, [[22, 0.011, 0.4], [12, 0.027, 1.7]], PAL.hillFar);
        hillLayer(s.scroll * 0.35, GY - 38, [[16, 0.016, 2.1], [8, 0.043, 0.3]], PAL.hillNear);

        // A row of round bushes on the near hills, moving with them.
        const offset = s.scroll * 0.35;
        const spacing = 58;
        ctx.fillStyle = PAL.hillNearDark;
        for (let i = -1; i <= W / spacing + 1; i++) {
            const worldX = Math.floor(offset / spacing + i) * spacing;
            const x = worldX - offset;
            const size = 9 + 5 * Math.sin(worldX * 0.37);
            const y = GY - 38 - hillHeight(worldX, [[16, 0.016, 2.1], [8, 0.043, 0.3]]) + 6;
            circle(x, y, size);
            ctx.fill();
        }
    }

    function hillLayer(offset, baseY, waves, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-20, GY + 2);
        for (let x = -20; x <= W + 20; x += 8) {
            ctx.lineTo(x, baseY - hillHeight(x + offset, waves));
        }
        ctx.lineTo(W + 20, GY + 2);
        ctx.closePath();
        ctx.fill();
    }

    // ---------- Obstacles ----------

    function drawObstaclePair(o) {
        drawPillar(o.x, view.top, o.width, o.gapTop - view.top, 'bottom');
        drawPillar(o.x, o.gapBottom, o.width, GY - o.gapBottom, 'top');
    }

    function drawPillar(x, top, w, h, capSide) {
        if (h <= 0) return;
        const capH = 24;
        const over = 5;

        ctx.fillStyle = PAL.pillar;
        ctx.fillRect(x + 2, top, w - 4, h);
        ctx.fillStyle = PAL.pillarLight;
        ctx.fillRect(x + 9, top, 8, h);
        ctx.fillStyle = PAL.pillarDark;
        ctx.fillRect(x + w - 15, top, 9, h);

        // Stone bands, anchored to the cap so they do not crawl as the gap height changes.
        ctx.fillStyle = PAL.pillarBand;
        const anchor = capSide === 'bottom' ? top + h : top;
        for (let d = capH + 22; d < h; d += 34) {
            const y = capSide === 'bottom' ? anchor - d : anchor + d;
            ctx.fillRect(x + 2, y, w - 4, 3);
        }

        ctx.strokeStyle = PAL.outline;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, top, w - 4, h);

        const capY = capSide === 'bottom' ? top + h - capH : top;
        roundRect(x - over, capY, w + over * 2, capH, 6);
        ctx.fillStyle = PAL.pillar;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = PAL.pillarLight;
        ctx.fillRect(x + 3, capY, 9, capH);
        ctx.fillStyle = PAL.pillarDark;
        ctx.fillRect(x + w - 12, capY, 12, capH);
        ctx.restore();
        roundRect(x - over, capY, w + over * 2, capH, 6);
        ctx.stroke();
    }

    // ---------- Player ----------

    function drawPlayer(s) {
        const r = config.playerRadius;
        const dead = s.state === 'Dying' || s.state === 'GameOver';

        ctx.save();
        ctx.translate(s.playerX, s.playerY);
        ctx.rotate((s.playerRotation * Math.PI) / 180);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = PAL.birdOutline;

        // Tail
        ctx.fillStyle = PAL.birdDark;
        ctx.beginPath();
        ctx.moveTo(-r + 3, -3);
        ctx.lineTo(-r - 9, -9);
        ctx.lineTo(-r - 6, 1);
        ctx.lineTo(-r - 9, 8);
        ctx.lineTo(-r + 3, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Head tuft
        ctx.beginPath();
        ctx.moveTo(-3, -r + 2);
        ctx.quadraticCurveTo(-2, -r - 9, 5, -r - 6);
        ctx.quadraticCurveTo(1, -r - 2, 3, -r + 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Body and belly
        ctx.fillStyle = PAL.bird;
        circle(0, 0, r);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = PAL.belly;
        ctx.beginPath();
        ctx.ellipse(3, 6, r * 0.62, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // Beak
        ctx.fillStyle = PAL.beak;
        ctx.beginPath();
        ctx.moveTo(r - 4, -1);
        ctx.lineTo(r + 9, 3);
        ctx.lineTo(r - 4, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Eye
        ctx.fillStyle = PAL.eye;
        circle(7, -6, 6.2);
        ctx.fill();
        ctx.stroke();
        if (dead) {
            ctx.strokeStyle = PAL.pupil;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(4.5, -8.5);
            ctx.lineTo(9.5, -3.5);
            ctx.moveTo(9.5, -8.5);
            ctx.lineTo(4.5, -3.5);
            ctx.stroke();
            ctx.strokeStyle = PAL.birdOutline;
            ctx.lineWidth = 2.5;
        } else {
            ctx.fillStyle = PAL.pupil;
            circle(9, -6, 2.8);
            ctx.fill();
            ctx.fillStyle = PAL.eye;
            circle(9.8, -7, 0.9);
            ctx.fill();
        }

        // Wing: swings with the wing phase, which beats faster right after a flap.
        ctx.save();
        ctx.translate(-5, 3);
        ctx.rotate(dead ? 0.5 : Math.sin(s.wingPhase) * 0.8 - 0.1);
        ctx.fillStyle = PAL.wing;
        ctx.beginPath();
        ctx.ellipse(-3, 0, 10, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.restore();
    }

    function drawParticles(dt) {
        ctx.fillStyle = PAL.wing;
        ctx.strokeStyle = PAL.birdOutline;
        ctx.lineWidth = 1.5;
        for (const p of particles) {
            if (p.life <= 0) continue;
            p.life -= dt;
            p.vy += 260 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.spin * dt;
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.beginPath();
            ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }

    // ---------- Ground ----------

    function drawGround(s) {
        const stripe = 24;
        const offset = mod(s.scroll, stripe);
        const grassH = 16;

        const bottom = view.bottom;
        ctx.fillStyle = PAL.dirt;
        ctx.fillRect(view.left, GY, view.right - view.left, bottom - GY);

        ctx.fillStyle = PAL.dirtLight;
        for (let x = -stripe * 2 - offset; x < W + (bottom - GY); x += stripe * 2) {
            ctx.beginPath();
            ctx.moveTo(x, GY + grassH);
            ctx.lineTo(x + stripe, GY + grassH);
            const slant = (bottom - GY - grassH) * 0.4;
            ctx.lineTo(x + stripe - slant, bottom);
            ctx.lineTo(x - slant, bottom);
            ctx.closePath();
            ctx.fill();
        }

        ctx.fillStyle = PAL.grass;
        ctx.fillRect(view.left, GY, view.right - view.left, grassH);
        ctx.fillStyle = PAL.grassDark;
        for (let x = -stripe - offset; x < W + stripe; x += stripe) {
            ctx.beginPath();
            ctx.moveTo(x, GY + 3);
            ctx.lineTo(x + stripe / 2, GY + 3);
            ctx.lineTo(x + stripe / 2 - 6, GY + grassH);
            ctx.lineTo(x - 6, GY + grassH);
            ctx.closePath();
            ctx.fill();
        }

        ctx.fillStyle = PAL.grassEdge;
        ctx.fillRect(view.left, GY - 1, view.right - view.left, 4);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.fillRect(view.left, GY + grassH, view.right - view.left, 4);
    }

    // ---------- UI on canvas ----------

    function drawScore(s) {
        if (s.state !== 'Playing' && s.state !== 'Paused' && s.state !== 'Dying') return;
        const pop = 1 + 0.4 * (fx.scorePop / 0.2);
        ctx.save();
        ctx.translate(W / 2, 92);
        ctx.scale(pop, pop);
        ctx.font = `900 56px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 10;
        ctx.strokeStyle = PAL.ink;
        ctx.strokeText(String(s.score), 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(s.score), 0, 0);
        ctx.restore();
    }

    function drawOverlayEffects() {
        if (fx.flash > 0) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.75 * (fx.flash / 0.2)})`;
            ctx.fillRect(view.left, view.top, view.right - view.left, view.bottom - view.top);
        }
        if (fx.fade > 0) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * (fx.fade / 0.3)})`;
            ctx.fillRect(view.left, view.top, view.right - view.left, view.bottom - view.top);
        }
    }

    // ---------- Debug ----------

    function drawHitboxes(s) {
        const inset = config.obstacleHitboxInset;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#00e676';
        ctx.fillStyle = 'rgba(0, 230, 118, 0.15)';
        for (const o of s.obstacles) {
            for (const [y, h] of [[view.top, o.gapTop - view.top], [o.gapBottom, GY - o.gapBottom]]) {
                ctx.fillRect(o.x + inset, y, o.width - inset * 2, h);
                ctx.strokeRect(o.x + inset, y, o.width - inset * 2, h);
            }
        }

        ctx.strokeStyle = '#ff1744';
        ctx.fillStyle = 'rgba(255, 23, 68, 0.25)';
        circle(s.playerX, s.playerY, config.playerHitboxRadius);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, GY);
        ctx.lineTo(W, GY);
        ctx.stroke();
    }

    function drawDebugPanel(s, fps) {
        // Two compact columns on the ground strip, so the panel never hides the playfield.
        const columns = [
            [`FPS    ${fps.toFixed(0)}`, `State  ${s.state}`, `Vel Y  ${s.playerVelocityY.toFixed(0)}`, `Rot    ${s.playerRotation.toFixed(0)}°`],
            [`Speed  ${s.speed.toFixed(1)}`, `Level  ${s.level} ${s.levelName}`, `Score  ${s.score} / ${s.best}`, `Pairs  ${s.obstacles.length}`],
        ];
        const top = GY + 24;
        ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(20, 16, 40, 0.78)';
        ctx.fillRect(8, top, W - 16, 4 * 14 + 10);
        ctx.fillStyle = '#e8ffe8';
        columns.forEach((lines, c) => lines.forEach((line, i) => ctx.fillText(line, 16 + c * 172, top + 6 + i * 14)));
    }

    // ---------- Helpers ----------

    function circle(x, y, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
    }

    return {
        draw,
        onEvent,
        dispose() {},
    };
}

function hillHeight(x, waves) {
    let y = 0;
    for (const [amplitude, frequency, phase] of waves) y += amplitude * Math.sin(x * frequency + phase);
    return y;
}

function makeClouds() {
    // Fixed layout so the sky looks the same every visit.
    return [
        { x: 0, y: 70, size: 1.0, alpha: 0.95 },
        { x: 170, y: 150, size: 0.7, alpha: 0.85 },
        { x: 300, y: 48, size: 0.85, alpha: 0.9 },
        { x: 430, y: 200, size: 0.6, alpha: 0.8 },
        { x: 560, y: 110, size: 0.95, alpha: 0.9 },
    ];
}

function mod(a, n) {
    return ((a % n) + n) % n;
}
