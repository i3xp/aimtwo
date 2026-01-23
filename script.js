const CFG = {
    baseSpeed: 365,
    sprintSpeed: 375,
    jumpForce: 25,
    gravity: 90,
    friction: 0.1,
    stopSpeed: 10.0,
    airControl: 0.15,
    sens: 0.004,
    scopeSens: 0.001,
    tickRate: 30,
    matchDuration: 300,
    maxAmmo: 5,
    reloadTime: 2000,
    isMobile: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
};

const State = {
    isHost: false,
    conn: null,
    peer: null,
    playing: false,
    gameOver: false,
    myName: "PLAYER 1",
    enemyName: "PLAYER 2",
    me: {
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        rot: {
            x: 0,
            y: 0
        },
        onGround: false,
        scoped: false,
        dead: false,
        sprinting: false,
        ammo: CFG.maxAmmo,
        reloading: false,
        spawnIdx: -1
    },
    headBobTimer: 0,
    weaponSway: new THREE.Vector2(),
    recoil: 0,
    players: {},
    lastFrame: 0,
    lastTick: 0,
    keys: {},
    score: {
        me: 0,
        enemy: 0
    },
    timeLeft: CFG.matchDuration,
    mobileSprint: false,
    scopeButtonHeld: {
        left: false,
        right: false
    },
    chat: {
        active: false,
        messages: [],
        maxMessages: 20
    },
    audio: {
        lobbyVol: 0.5,
        matchVol: 0.8,
        stepVol: 0.8
    },
    rematchState: 'IDLE'
};

const SfxElements = {
    death: document.getElementById('sfx-death'),
    headshot: document.getElementById('sfx-headshot'),
    bodyshot: document.getElementById('sfx-bodyshot'),
    firing: document.getElementById('sfx-firing')
};

const LobbyAudio = {
    el: document.getElementById('lobby-audio'),
    init: () => {
        LobbyAudio.el.volume = State.audio.lobbyVol;
        Object.values(SfxElements).forEach(el => el.volume = State.audio.matchVol);
        LobbyAudio.el.play().catch(() => document.getElementById('autoplay-warning').classList.add('active'));
    },
    play: () => LobbyAudio.el.play().catch(e => {}),
    pause: () => LobbyAudio.el.pause(),
    setLobbyVolume: (val) => {
        State.audio.lobbyVol = val;
        LobbyAudio.el.volume = val;
    },
    setMatchVolume: (val) => {
        State.audio.matchVol = val;
        Object.values(SfxElements).forEach(el => el.volume = val);
    },
    setStepVolume: (val) => {
        State.audio.stepVol = val;
    },
    playSfx: (name) => {
        const el = SfxElements[name];
        if (el) {
            el.currentTime = 0;
            el.play().catch(e => {});
        }
    }
};

const Sfx = {
    ctx: null,
    init: () => {
        if (!Sfx.ctx) Sfx.ctx = new(window.AudioContext || window.webkitAudioContext)();
    },
    play: (type) => {
        if (!Sfx.ctx) Sfx.init();
        if (Sfx.ctx.state === 'suspended') Sfx.ctx.resume();
        const t = Sfx.ctx.currentTime;

        if (type === 'step') {
            const osc = Sfx.ctx.createOscillator();
            const gain = Sfx.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(80, t);
            gain.gain.setValueAtTime(State.audio.stepVol, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.1);
            osc.connect(gain);
            gain.connect(Sfx.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.1);
        } else if (type === 'reload') {
            const osc = Sfx.ctx.createOscillator();
            const gain = Sfx.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(600, t);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
            osc.connect(gain);
            gain.connect(Sfx.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.05);
        } else if (type === 'empty') {
            const osc = Sfx.ctx.createOscillator();
            const gain = Sfx.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(800, t);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.05);
            osc.connect(gain);
            gain.connect(Sfx.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.05);
        }
    }
};

const Gfx = {
    scene: null,
    camera: null,
    renderer: null,
    colliders: [],
    weaponGroup: null,
    laserLine: null,
    particles: [],

    init: () => {
        Gfx.scene = new THREE.Scene();
        Gfx.scene.background = new THREE.Color(0x87CEEB);

        Gfx.camera = new THREE.PerspectiveCamera(85, innerWidth / innerHeight, 0.1, 500);
        Gfx.renderer = new THREE.WebGLRenderer({
            antialias: true
        });
        Gfx.renderer.setPixelRatio(1);
        Gfx.renderer.setSize(innerWidth, innerHeight);
        Gfx.renderer.shadowMap.enabled = false;
        document.getElementById('game-layer').appendChild(Gfx.renderer.domElement);

        const amb = new THREE.AmbientLight(0xffffff, 0.7);
        Gfx.scene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(50, 100, 50);
        Gfx.scene.add(dir);

        Gfx.buildMap();
        Gfx.loadWeapon();
    },

    createNameSprite: (name) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        ctx.font = "Bold 40px 'Rubik'";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "black";
        ctx.strokeText(name, 128, 48);
        ctx.fillText(name, 128, 48);
        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex,
            transparent: true
        }));
        sprite.scale.set(6, 1.5, 1);
        return sprite;
    },

    loadWeapon: () => {
        Gfx.weaponGroup = new THREE.Group();
        const matGun = new THREE.MeshStandardMaterial({
            color: 0x333333
        });
        const matAccent = new THREE.MeshStandardMaterial({
            color: 0xffe600
        });

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 1.0), matGun);
        body.position.z = 0.2;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2), new THREE.MeshStandardMaterial({
            color: 0x111
        }));
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.05, -0.8);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.15), matAccent);
        mag.position.set(0, -0.2, 0.2);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4), matGun);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.18, 0.2);

        Gfx.weaponGroup.add(body, barrel, mag, scope);
        Gfx.weaponGroup.scale.set(0.5, 0.5, 0.5);

        const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -100)]);
        Gfx.laserLine = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5
        }));
        Gfx.laserLine.position.set(0, 0.18, -0.8);
        Gfx.laserLine.visible = false;
        Gfx.weaponGroup.add(Gfx.laserLine);

        Gfx.camera.add(Gfx.weaponGroup);
        Gfx.scene.add(Gfx.camera);
    },

    buildMap: () => {
        const matFloor = new THREE.MeshLambertMaterial({
            color: 0x4CAF50
        });
        const matWall = new THREE.MeshLambertMaterial({
            color: 0xffffff
        });
        const matTrim = new THREE.MeshBasicMaterial({
            color: 0x2196F3
        });

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), matFloor);
        floor.rotation.x = -Math.PI / 2;
        Gfx.scene.add(floor);

        const createBox = (w, h, d, x, y, z, mat) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            Gfx.addColl(m);
        };

        createBox(200, 40, 10, 0, 20, -100, matWall);
        createBox(200, 40, 10, 0, 20, 100, matWall);
        createBox(10, 40, 200, -100, 20, 0, matWall);
        createBox(10, 40, 200, 100, 20, 0, matWall);

        createBox(20, 10, 20, 0, 5, 0, matWall);
        createBox(22, 1, 22, 0, 10.1, 0, matTrim);

        [
            [-40, 40],
            [40, -40],
            [-40, -40],
            [40, 40]
        ].forEach(p => {
            createBox(10, 8, 10, p[0], 4, p[1], matWall);
            createBox(10.5, 1, 10.5, p[0], 8.1, p[1], matTrim);
        });
    },

    addColl: (mesh) => {
        Gfx.scene.add(mesh);
        Gfx.colliders.push(mesh);
    },

    createPlayer: () => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.8, 1.0), new THREE.MeshLambertMaterial({
            color: 0x333333
        }));
        b.position.y = 0.9;
        b.name = "body";
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial({
            color: 0xffe600
        }));
        h.position.y = 2.1;
        h.name = "head";
        g.add(b, h);

        const nameSprite = Gfx.createNameSprite(State.enemyName);
        nameSprite.position.y = 3.2;
        g.add(nameSprite);
        g.userData.nameTag = nameSprite;
        Gfx.scene.add(g);
        return g;
    },

    spawnParticles: (pos, color, count) => {
        const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const mat = new THREE.MeshBasicMaterial({
            color: color
        });
        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            mesh.position.add(new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)));
            Gfx.particles.push({
                mesh,
                vel: new THREE.Vector3((Math.random() - .5) * 4, (Math.random() - .5) * 4, (Math.random() - .5) * 4),
                life: 1.0
            });
            Gfx.scene.add(mesh);
        }
    },

    updateParticles: (dt) => {
        for (let i = Gfx.particles.length - 1; i >= 0; i--) {
            const p = Gfx.particles[i];
            p.life -= dt * 2.0;
            p.mesh.position.addScaledVector(p.vel, dt);
            p.mesh.scale.setScalar(p.life);
            if (p.life <= 0) {
                Gfx.scene.remove(p.mesh);
                Gfx.particles.splice(i, 1);
            }
        }
    },

    tracer: (start, end) => {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({
            color: 0xffff00,
            linewidth: 2
        }));
        Gfx.scene.add(line);
        setTimeout(() => Gfx.scene.remove(line), 50);
    }
};

const SPAWN_POINTS = [
    new THREE.Vector3(-90, 5, -90),
    new THREE.Vector3(90, 5, -90),
    new THREE.Vector3(-90, 5, 90),
    new THREE.Vector3(90, 5, 90)
];

const Net = {
    init: (role) => {
        const n = document.getElementById('inp-name').value.trim();
        if (!n) return UI.toast("ENTER NAME");
        State.myName = n.substring(0, 12).toUpperCase();
        State.peer = new Peer();

        State.peer.on('open', id => {
            if (role === 'host') {
                State.isHost = true;
                document.getElementById('lobby-code').value = id;
                UI.showLobby(true);
                State.peer.on('connection', conn => {
                    State.conn = conn;
                    Net.setup();
                });
            } else {
                const code = document.getElementById('inp-code').value.trim();
                if (!code) return UI.toast("ENTER CODE");
                document.getElementById('btn-connect').innerText = "CONNECTING...";
                State.conn = State.peer.connect(code);
                Net.setup();
            }
        });
        State.peer.on('error', () => UI.toast("NETWORK ERROR"));
    },

    setup: () => {
        State.conn.on('open', () => {
            State.conn.send({
                t: 'name',
                n: State.myName
            });

            if (State.isHost) {
                document.getElementById('btn-start-lobby').disabled = false;
            } else {
                UI.showLobby(false);
                document.getElementById('lobby-code').value = document.getElementById('inp-code').value;
                document.getElementById('lobby-p1').innerText = "HOST (CONNECTING...)";
            }
        });

        State.conn.on('data', data => {
            switch (data.t) {
                case 'name':
                    State.enemyName = data.n;
                    if (State.isHost) {
                        document.getElementById('lobby-p2').innerText = State.enemyName;
                        document.getElementById('lobby-p2').style.color = "#000";
                    } else {
                        document.getElementById('lobby-p1').innerText = State.enemyName;
                        document.getElementById('lobby-p1').style.color = "#000";
                        document.getElementById('lobby-p2').innerText = State.myName + " (YOU)";
                        document.getElementById('lobby-p2').style.color = "var(--primary)";
                    }
                    break;
                case 'start':
                    State.enemyName = data.enemyName;
                    State.me.spawnIdx = data.spawnIdx;
                    UI.startGame();
                    break;
                case 'm':
                    if (!State.players['enemy']) State.players['enemy'] = {
                        mesh: Gfx.createPlayer(),
                        targetPos: new THREE.Vector3(),
                        dead: false
                    };
                    const en = State.players['enemy'];
                    en.targetPos.copy(data.p);
                    en.mesh.rotation.y = data.r;
                    en.mesh.visible = !data.d;
                    en.dead = data.d;
                    break;
                case 's':
                    Gfx.tracer(data.o, data.d);
                    LobbyAudio.playSfx('firing');
                    break;
                case 'score_update':
                    State.score.enemy = data.v;
                    UI.updateScore();
                    break;
                case 'die':
                    Logic.die();
                    break;
                case 'end':
                    Logic.endGame(false);
                    break;
                case 'rematch_req':
                    UI.handleRematchRequest();
                    break;
                case 'rematch_acc':
                    UI.handleRematchAccept();
                    break;
                case 'rematch_dec':
                    UI.handleRematchDecline();
                    break;
                case 'chat':
                    UI.addChatMessage(data.n, data.m);
                    break;
            }
        });
        State.conn.on('close', () => {
            UI.toast("DISCONNECTED");
            setTimeout(() => location.reload(), 2000);
        });
    },

    broadcast: () => {
        if (!State.conn || !State.playing) return;
        const now = performance.now();
        if (now - State.lastTick < (1000 / CFG.tickRate)) return;
        State.lastTick = now;
        State.conn.send({
            t: 'm',
            p: State.me.pos,
            r: State.me.rot.y,
            d: State.me.dead
        });

        if (State.isHost && Math.random() < 0.05) {
            State.conn.send({
                t: 'time',
                v: State.timeLeft
            });
        }
    }
};

const UI = {
    showPanel: (id) => {
        document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
        if (id === 'panel-main') LobbyAudio.init();
    },

    showLobby: (isHost) => {
        document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
        const p = document.getElementById('panel-lobby');
        p.classList.remove('hidden');

        if (isHost) {
            document.getElementById('lobby-p1').innerText = State.myName + " (HOST)";
            document.getElementById('lobby-p2').innerText = "WAITING FOR PLAYER...";
            document.getElementById('btn-start-lobby').style.display = 'block';
            document.getElementById('btn-start-lobby').disabled = true;
        } else {
            document.getElementById('btn-start-lobby').style.display = 'none';
        }
    },

    toast: (msg) => {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerText = msg;
        c.appendChild(el);
        setTimeout(() => {
            el.style.opacity = 0;
            setTimeout(() => el.remove(), 300);
        }, 3000);
    },

    startGame: () => {
        document.getElementById('menu-layer').classList.add('hidden');
        document.getElementById('hud').style.display = 'block';
        LobbyAudio.pause();
        if (CFG.isMobile && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(e => {});

        State.playing = true;
        State.gameOver = false;
        State.rematchState = 'IDLE';
        State.timeLeft = CFG.matchDuration;

        if (!CFG.isMobile) document.body.requestPointerLock();

        UI.updateScore();
        UI.updateAmmo();
        Logic.spawn();
    },

    updateScore: () => {
        document.getElementById('score-p1-val').innerText = State.score.me;
        document.getElementById('score-p2-val').innerText = State.score.enemy;
    },

    updateTimer: () => {
        const m = Math.floor(State.timeLeft / 60);
        const s = Math.floor(State.timeLeft % 60);
        document.getElementById('timer-box').innerText = `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
    },

    updateAmmo: () => {
        document.getElementById('ammo-val').innerText = `${State.me.ammo}/${CFG.maxAmmo}`;
        if (State.me.reloading) {
            document.getElementById('ammo-count').style.display = 'none';
            document.getElementById('reloading-text').style.display = 'block';
        } else {
            document.getElementById('ammo-count').style.display = 'block';
            document.getElementById('reloading-text').style.display = 'none';
            document.getElementById('ammo-count').style.color = State.me.ammo === 0 ? '#ff3333' : '#fff';
        }
    },

    feed: (text) => {
        const el = document.getElementById('killfeed');
        el.innerText = text;
        el.style.opacity = 1;
        setTimeout(() => el.style.opacity = 0, 2000);
    },

    showHitMarker: () => {
        const hm = document.getElementById('hitmarker');
        hm.classList.add('hit-active');
        setTimeout(() => hm.classList.remove('hit-active'), 150);
    },

    addChatMessage: (sender, message) => {
        const messagesEl = document.getElementById('chat-messages');
        const msgEl = document.createElement('div');
        msgEl.innerHTML = `<span class="chat-sender">${sender}:</span> ${message}`;
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    },

    toggleChat: () => {
        const w = document.getElementById('chat-input-wrapper');
        const i = document.getElementById('chat-input');
        State.chat.active = !State.chat.active;
        w.style.display = State.chat.active ? 'block' : 'none';
        if (State.chat.active) {
            i.focus();
            i.value = '';
        } else i.blur();
    },

    showEndScreen: () => {
        State.gameOver = true;
        if (!CFG.isMobile) document.exitPointerLock();

        const overlay = document.getElementById('rematch-overlay');
        const title = document.getElementById('end-title');

        overlay.style.display = 'flex';
        document.getElementById('end-score-me').innerText = State.score.me;
        document.getElementById('end-score-enemy').innerText = State.score.enemy;

        if (State.score.me > State.score.enemy) {
            title.innerText = "VICTORY ROYALE";
            title.className = "end-victory";
        } else if (State.score.me < State.score.enemy) {
            title.innerText = "DEFEAT";
            title.className = "end-defeat";
        } else {
            title.innerText = "DRAW";
            title.className = "end-defeat";
        }

        document.getElementById('btn-end-rematch').disabled = false;
        document.getElementById('btn-end-rematch').innerText = "PLAY AGAIN";
        document.getElementById('accept-decline-container').style.display = 'none';
        document.getElementById('rematch-status-msg').innerText = "";
    },

    handleRematchRequest: () => {
        State.rematchState = 'RECEIVED';
        document.getElementById('accept-decline-container').style.display = 'flex';
    },

    requestRematch: () => {
        State.rematchState = 'REQUESTING';
        State.conn.send({
            t: 'rematch_req'
        });
        const btn = document.getElementById('btn-end-rematch');
        btn.disabled = true;
        btn.innerText = "WAITING...";
        document.getElementById('rematch-status-msg').innerText = "Waiting for opponent...";
    },

    acceptRematch: () => {
        if (State.rematchState !== 'RECEIVED') return;
        State.conn.send({
            t: 'rematch_acc'
        });
        Logic.resetGame();
    },

    declineRematch: () => {
        State.conn.send({
            t: 'rematch_dec'
        });
        document.getElementById('accept-decline-container').style.display = 'none';
    },

    handleRematchAccept: () => {
        if (State.rematchState === 'REQUESTING') Logic.resetGame();
    },
    handleRematchDecline: () => {
        if (State.rematchState === 'REQUESTING') {
            const btn = document.getElementById('btn-end-rematch');
            btn.disabled = false;
            btn.innerText = "PLAY AGAIN";
            document.getElementById('rematch-status-msg').innerText = "Opponent declined.";
        }
    }
};

const Logic = {
    loop: (t) => {
        requestAnimationFrame(Logic.loop);
        const dt = Math.min((t - State.lastFrame) / 1000, 0.1);
        State.lastFrame = t;

        if (State.playing) {
            if (!State.gameOver) {
                Logic.physics(dt);

                if (State.timeLeft > 0) {
                    State.timeLeft -= dt;
                    if (State.timeLeft <= 0) {
                        State.timeLeft = 0;
                        Logic.endGame();
                    }
                    UI.updateTimer();
                }
            }

            const p = State.players['enemy'];
            if (p && p.mesh) {
                p.mesh.position.lerp(p.targetPos, 0.2);
                if (p.mesh.userData.nameTag) p.mesh.userData.nameTag.lookAt(Gfx.camera.position);
            }

            Gfx.updateParticles(dt);
            Gfx.renderer.render(Gfx.scene, Gfx.camera);
            if (!State.gameOver) Net.broadcast();
        }
    },

    spawn: () => {
        if (State.me.spawnIdx !== -1 && SPAWN_POINTS[State.me.spawnIdx]) {
            State.me.pos.copy(SPAWN_POINTS[State.me.spawnIdx]);
        } else {
            State.me.pos.set(0, 50, 0);
        }

        State.me.vel.set(0, 0, 0);
        State.me.onGround = false;
        State.me.dead = false;
        State.me.scoped = false;
        State.me.ammo = CFG.maxAmmo;
        State.me.reloading = false;
        State.recoil = 0;
        UI.updateAmmo();
        document.getElementById('scope').style.display = 'none';
        document.getElementById('crosshair').style.display = 'block';
        Gfx.laserLine.visible = false;
    },

    reload: () => {
        if (State.me.reloading || State.me.ammo === CFG.maxAmmo) return;
        State.me.reloading = true;
        UI.updateAmmo();
        Sfx.play('reload');
        setTimeout(() => {
            State.me.ammo = CFG.maxAmmo;
            State.me.reloading = false;
            UI.updateAmmo();
        }, CFG.reloadTime);
    },

    physics: (dt) => {
        if (State.me.dead) return;
        const {
            me,
            keys
        } = State;
        const isMoving = (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']);
        const isSprinting = (State.mobileSprint || keys['ShiftLeft']) && !me.scoped && isMoving && !me.reloading;
        const speed = isSprinting ? CFG.sprintSpeed : CFG.baseSpeed;

        const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), me.rot.y);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), me.rot.y);
        const inputDir = new THREE.Vector3();
        if (keys['KeyW']) inputDir.add(fwd);
        if (keys['KeyS']) inputDir.sub(fwd);
        if (keys['KeyA']) inputDir.sub(right);
        if (keys['KeyD']) inputDir.add(right);
        if (inputDir.length() > 0) inputDir.normalize();

        const accel = speed * dt * (me.onGround ? 10.0 : CFG.airControl);
        if (inputDir.length() > 0) me.vel.add(inputDir.multiplyScalar(accel));

        if (me.onGround) {
            me.vel.x *= CFG.friction;
            me.vel.z *= CFG.friction;
            if (me.vel.length() < CFG.stopSpeed && !isMoving) {
                me.vel.x = 0;
                me.vel.z = 0;
            }
        } else {
            me.vel.x *= 0.98;
            me.vel.z *= 0.98;
        }

        if (keys['Space'] && me.onGround) {
            me.vel.y = CFG.jumpForce;
            me.onGround = false;
        }
        me.vel.y -= CFG.gravity * dt;

        const resolve = (axis) => {
            const nextPos = me.pos.clone();
            if (axis === 'x') nextPos.x += me.vel.x * dt;
            if (axis === 'z') nextPos.z += me.vel.z * dt;
            const pBox = new THREE.Box3().setFromCenterAndSize(nextPos.clone().add(new THREE.Vector3(0, 1.5, 0)), new THREE.Vector3(1.0, 3, 1.0));
            for (let c of Gfx.colliders) {
                if (new THREE.Box3().setFromObject(c).intersectsBox(pBox)) return true;
            }
            return false;
        }
        if (!resolve('x')) me.pos.x += me.vel.x * dt;
        else me.vel.x = 0;
        if (!resolve('z')) me.pos.z += me.vel.z * dt;
        else me.vel.z = 0;
        me.pos.y += me.vel.y * dt;

        if (me.pos.y < -60) Logic.die();
        if (me.pos.y <= 0) {
            me.pos.y = 0;
            if (me.vel.y < 0) me.vel.y = 0;
            me.onGround = true;
        } else {
            if (me.vel.y <= 0) {
                const ray = new THREE.Raycaster(me.pos.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0));
                const hits = ray.intersectObjects(Gfx.colliders);
                if (hits.length > 0 && hits[0].distance < 1.1) {
                    me.pos.y = hits[0].point.y;
                    me.vel.y = 0;
                    me.onGround = true;
                } else me.onGround = false;
            } else me.onGround = false;
        }

        let camY = me.pos.y + 2.4;
        const time = performance.now() * 0.001;
        let bobX = 0,
            bobY = 0;
        if (me.onGround && isMoving && !me.scoped) {
            State.headBobTimer += dt * (isSprinting ? 15 : 10);
            bobY = Math.sin(State.headBobTimer) * (isSprinting ? 0.08 : 0.04);
            bobX = Math.cos(State.headBobTimer * 0.5) * (isSprinting ? 0.08 : 0.04);
            if (Math.abs(Math.sin(State.headBobTimer)) > 0.9 && (State.headBobTimer % 2 > 1)) {
                if (State.lastStepTime === undefined || time - State.lastStepTime > 0.3) {
                    Sfx.play('step');
                    State.lastStepTime = time;
                }
            }
        } else {
            State.weaponSway.x = Math.sin(time * 1.5) * 0.001;
            State.weaponSway.y = Math.cos(time * 1.2) * 0.001;
        }

        if (State.recoil > 0) State.recoil = Math.max(0, State.recoil - dt * 5);
        Gfx.camera.position.set(me.pos.x, camY + bobY, me.pos.z);
        Gfx.camera.rotation.set(me.rot.x + State.recoil, me.rot.y, 0, 'YXZ');

        if (Gfx.weaponGroup) {
            const posHip = new THREE.Vector3(0.35, -0.35, -0.5);
            const posAim = new THREE.Vector3(0, -0.18, -0.2);
            let targetPos = me.scoped ? posAim : posHip;
            if (isSprinting && !me.scoped) targetPos = new THREE.Vector3(0.1, -0.45, -0.8);

            targetPos.x += State.weaponSway.x + bobX;
            targetPos.y += State.weaponSway.y + bobY;
            targetPos.z += State.recoil * 0.5;
            Gfx.weaponGroup.position.lerp(targetPos, me.scoped ? 0.3 : 0.2);

            Gfx.weaponGroup.rotation.x = THREE.MathUtils.lerp(Gfx.weaponGroup.rotation.x, me.scoped ? 0 : State.recoil + 0.05, 0.2);
            Gfx.weaponGroup.rotation.y = THREE.MathUtils.lerp(Gfx.weaponGroup.rotation.y, me.scoped ? 0 : -State.weaponSway.x, 0.2);

            if (me.reloading) {
                Gfx.weaponGroup.rotation.x = -Math.PI / 4;
                Gfx.weaponGroup.position.y -= 0.2;
            }
        }

        const targetFov = me.scoped ? 20 : (isSprinting ? 95 : 85);
        Gfx.camera.fov += (targetFov - Gfx.camera.fov) * 0.3;
        Gfx.camera.updateProjectionMatrix();

        if (me.scoped && Gfx.laserLine) {
            Gfx.laserLine.visible = true;
            const hits = new THREE.Raycaster(Gfx.camera.position, Gfx.camera.getWorldDirection(new THREE.Vector3())).intersectObjects([...Gfx.colliders, State.players['enemy']?.mesh].filter(x => x));
            if (hits.length > 0) Gfx.laserLine.scale.z = hits[0].distance / 100;
        } else if (Gfx.laserLine) Gfx.laserLine.visible = false;
    },

    shoot: () => {
        if (State.me.dead || State.gameOver || State.me.reloading) return;
        if (State.me.ammo <= 0) {
            Sfx.play('empty');
            UI.toast("RELOAD!");
            return;
        }

        State.me.ammo--;
        UI.updateAmmo();
        LobbyAudio.playSfx('firing');
        State.recoil = 0.1;

        const ray = new THREE.Raycaster();
        ray.setFromCamera({
            x: 0,
            y: 0
        }, Gfx.camera);
        const gunPos = Gfx.camera.position.clone().add(new THREE.Vector3(0.3, -0.3, 0.5).applyQuaternion(Gfx.camera.quaternion));
        const end = new THREE.Vector3().copy(Gfx.camera.position).add(ray.ray.direction.clone().multiplyScalar(300));

        Gfx.tracer(gunPos, end);
        State.conn.send({
            t: 's',
            o: gunPos,
            d: end
        });

        const obstacles = [...Gfx.colliders];
        const p = State.players['enemy'];
        if (p && p.mesh && !p.dead) obstacles.push(p.mesh);
        const hits = ray.intersectObjects(obstacles, true);

        if (hits.length > 0) {
            let hitEnemy = false,
                isHeadshot = false,
                obj = hits[0].object;
            while (obj.parent && obj.parent.type !== 'Scene') {
                if (obj.parent === p.mesh) {
                    hitEnemy = true;
                    if (obj.name === "head") isHeadshot = true;
                    break;
                }
                obj = obj.parent;
            }

            if (hitEnemy) {
                LobbyAudio.playSfx(isHeadshot ? 'headshot' : 'bodyshot');
                UI.feed(isHeadshot ? "HEADSHOT!" : "HIT!");
                Gfx.spawnParticles(hits[0].point, 0xff0000, 10);
                UI.showHitMarker();

                State.score.me++;
                UI.updateScore();
                State.conn.send({
                    t: 'score_update',
                    v: State.score.me
                });

                State.conn.send({
                    t: 'die'
                });
            }
        }
    },

    die: () => {
        State.me.dead = true;
        State.me.pos.y = -100;
        LobbyAudio.playSfx('death');
        UI.feed("ELIMINATED");
        setTimeout(() => Logic.spawn(), 2500);
    },

    endGame: () => {
        UI.showEndScreen();
    },

    resetGame: () => {
        State.score.me = 0;
        State.score.enemy = 0;
        State.gameOver = false;
        State.rematchState = 'IDLE';
        State.timeLeft = CFG.matchDuration;
        UI.updateScore();
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('rematch-overlay').style.display = 'none';

        if (State.isHost) {
            const indices = [0, 1, 2, 3].sort(() => 0.5 - Math.random());
            State.me.spawnIdx = indices[0];
            const clientIdx = indices[1];
            State.conn.send({
                t: 'start',
                spawnIdx: clientIdx,
                enemyName: State.myName
            });
            Logic.spawn();
        }

        if (!CFG.isMobile) document.body.requestPointerLock();
        UI.toast("MATCH STARTED");
    }
};

window.onload = () => {
    Gfx.init();
    Logic.loop(0);

    window.onkeydown = e => {
        if (e.code === 'KeyT' && State.playing && !State.gameOver && !State.chat.active) {
            e.preventDefault();
            UI.toggleChat();
            return;
        }
        if (State.chat.active) {
            if (e.code === 'Enter') {
                const m = document.getElementById('chat-input').value.trim();
                if (m) {
                    UI.addChatMessage('YOU', m);
                    State.conn.send({
                        t: 'chat',
                        n: State.myName,
                        m: m
                    });
                    document.getElementById('chat-input').value = '';
                }
                UI.toggleChat();
            } else if (e.code === 'Escape') UI.toggleChat();
            return;
        }
        State.keys[e.code] = true;
        if (e.code === 'KeyR' && State.playing && !State.me.dead) Logic.reload();
    };
    window.onkeyup = e => {
        if (!State.chat.active) State.keys[e.code] = false;
    };

    window.onmousedown = (e) => {
        if (State.playing && !State.gameOver && document.pointerLockElement !== document.body) {
            if (!e.target.closest('.modal-content') && !e.target.closest('.panel') && !e.target.closest('#rematch-overlay') && !e.target.closest('#chat-input')) document.body.requestPointerLock();
            return;
        }
        if (document.pointerLockElement !== document.body) return;
        if (e.button === 0 || e.button === 2) {
            e.preventDefault();
            if (e.button === 0) State.scopeButtonHeld.left = true;
            if (e.button === 2) State.scopeButtonHeld.right = true;
            State.me.scoped = true;
            document.getElementById('scope').style.display = 'block';
            document.getElementById('crosshair').style.display = 'none';
        }
    };
    window.onmouseup = (e) => {
        if ((e.button === 0 || e.button === 2) && State.me.scoped) {
            e.preventDefault();
            if (e.button === 0) State.scopeButtonHeld.left = false;
            if (e.button === 2) State.scopeButtonHeld.right = false;
            if (!State.scopeButtonHeld.left && !State.scopeButtonHeld.right) {
                Logic.shoot();
                State.me.scoped = false;
                document.getElementById('scope').style.display = 'none';
                document.getElementById('crosshair').style.display = 'block';
            }
        }
    };
    window.oncontextmenu = e => {
        if (State.playing) e.preventDefault();
    };
    window.onmousemove = e => {
        if (document.pointerLockElement !== document.body || State.me.dead || State.gameOver || State.chat.active) return;
        const s = State.me.scoped ? CFG.scopeSens : CFG.sens;
        State.me.rot.y -= e.movementX * s;
        State.me.rot.x -= e.movementY * s;
        State.me.rot.x = Math.max(-1.5, Math.min(1.5, State.me.rot.x));
    };

    document.getElementById('settings-btn').onclick = () => document.getElementById('settings-modal').classList.toggle('active');
    document.getElementById('btn-close-warning').onclick = () => document.getElementById('autoplay-warning').classList.remove('active');
    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-modal').classList.remove('active');
    document.getElementById('vol-lobby').oninput = (e) => LobbyAudio.setLobbyVolume(e.target.value);
    document.getElementById('vol-match').oninput = (e) => LobbyAudio.setMatchVolume(e.target.value);
    document.getElementById('vol-walk').oninput = (e) => LobbyAudio.setStepVolume(e.target.value);

    const joy = document.getElementById('joystick-area');
    let joyId = null,
        joyCenter = {
            x: 0,
            y: 0
        };
    joy.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        joyId = t.identifier;
        const r = joy.getBoundingClientRect();
        joyCenter = {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2
        };
        updateJoy(t);
    });
    joy.addEventListener('touchmove', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++)
            if (e.changedTouches[i].identifier === joyId) updateJoy(e.changedTouches[i]);
    });
    const endJoy = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++)
            if (e.changedTouches[i].identifier === joyId) {
                joyId = null;
                document.getElementById('joystick-knob').style.transform = `translate(-50%, -50%)`;
                State.keys['KeyW'] = State.keys['KeyS'] = State.keys['KeyA'] = State.keys['KeyD'] = false;
            }
    };
    joy.addEventListener('touchend', endJoy);
    joy.addEventListener('touchcancel', endJoy);

    function updateJoy(t) {
        let dx = t.clientX - joyCenter.x,
            dy = t.clientY - joyCenter.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 45) {
            dx = (dx / dist) * 45;
            dy = (dy / dist) * 45;
        }
        document.getElementById('joystick-knob').style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        State.keys['KeyW'] = dy < -10;
        State.keys['KeyS'] = dy > 10;
        State.keys['KeyA'] = dx < -10;
        State.keys['KeyD'] = dx > 10;
    }

    let lookId = null,
        lastLookX = 0,
        lastLookY = 0;
    document.getElementById('ui-layer').addEventListener('touchstart', e => {
        if (e.target.closest('#mobile-controls')) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.clientX > window.innerWidth / 2) {
                lookId = t.identifier;
                lastLookX = t.clientX;
                lastLookY = t.clientY;
            }
        }
    });
    document.getElementById('ui-layer').addEventListener('touchmove', e => {
        if (lookId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === lookId) {
                const dx = t.clientX - lastLookX,
                    dy = t.clientY - lastLookY;
                lastLookX = t.clientX;
                lastLookY = t.clientY;
                const s = State.me.scoped ? CFG.scopeSens * 100 : CFG.sens * 100;
                State.me.rot.y -= dx * s;
                State.me.rot.x -= dy * s;
                State.me.rot.x = Math.max(-1.5, Math.min(1.5, State.me.rot.x));
            }
        }
    });
    const endLook = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++)
            if (e.changedTouches[i].identifier === lookId) lookId = null;
    };
    document.getElementById('ui-layer').addEventListener('touchend', endLook);
    document.getElementById('ui-layer').addEventListener('touchcancel', endLook);

    document.getElementById('sprint-toggle').addEventListener('touchstart', e => {
        e.preventDefault();
        State.mobileSprint = !State.mobileSprint;
        e.target.classList.toggle('active', State.mobileSprint);
    });
    document.getElementById('scope-btn').addEventListener('touchstart', e => {
        e.preventDefault();
        if (State.playing && !State.gameOver) {
            State.me.scoped = true;
            document.getElementById('scope').style.display = 'block';
            document.getElementById('crosshair').style.display = 'none';
        }
    });
    document.getElementById('scope-btn').addEventListener('touchend', e => {
        e.preventDefault();
        if (State.me.scoped) {
            Logic.shoot();
            State.me.scoped = false;
            document.getElementById('scope').style.display = 'none';
            document.getElementById('crosshair').style.display = 'block';
        }
    });

    document.getElementById('btn-host').onclick = () => Net.init('host');
    document.getElementById('btn-join').onclick = () => UI.showPanel('panel-join');
    document.getElementById('btn-connect').onclick = () => Net.init('client');

    document.getElementById('btn-start-lobby').onclick = () => {
        if (State.conn) {
            const indices = [0, 1, 2, 3].sort(() => 0.5 - Math.random());
            State.me.spawnIdx = indices[0];
            const clientIdx = indices[1];

            State.conn.send({
                t: 'start',
                spawnIdx: clientIdx,
                enemyName: State.myName
            });
            UI.startGame();
        }
    };

    document.getElementById('lobby-code').onclick = (e) => navigator.clipboard.writeText(e.target.value).then(() => UI.toast("COPIED"));
    document.getElementById('btn-leave').onclick = () => location.reload();
    document.getElementById('btn-back-2').onclick = () => UI.showPanel('panel-main');
    document.getElementById('btn-end-rematch').onclick = UI.requestRematch;
    document.getElementById('btn-end-exit').onclick = () => location.reload();
    document.getElementById('btn-accept').onclick = UI.acceptRematch;
    document.getElementById('btn-decline').onclick = UI.declineRematch;
};