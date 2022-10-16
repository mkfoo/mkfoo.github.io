class WasmGame {
    constructor(name, width, height) {
        this.name = name;
        this.width = width;
        this.height = height;
        this.events = [];
        this.touches = {};
    }

    eventVariants = {
        "Escape": 2,
        "ArrowUp": 3,
        "ArrowDown": 4,
        "ArrowLeft": 5,
        "ArrowRight": 6,
        " ": 7,
        "F1": 8,
        "F2": 9,
        "F3": 10,
        "F4": 11,
        "F5": 12,
        "F6": 13,
        "F10": 14,
    };

    palette = [
        [0x00, 0x00, 0x00, 0x00], // TRANSPARENT
        [0x00, 0x00, 0x00, 0xff], // BLACK
        [0x3e, 0xb8, 0x49, 0xff], // MEDIUM_GREEN
        [0x74, 0xd0, 0x7d, 0xff], // LIGHT_GREEN
        [0x59, 0x55, 0xe0, 0xff], // DARK_BLUE
        [0x80, 0x76, 0xf1, 0xff], // LIGHT_BLUE
        [0xb9, 0x5e, 0x51, 0xff], // DARK_RED
        [0x65, 0xdb, 0xef, 0xff], // CYAN
        [0xdb, 0x65, 0x59, 0xff], // MEDIUM_RED
        [0xff, 0x89, 0x7d, 0xff], // LIGHT_RED
        [0xcc, 0xc3, 0x5e, 0xff], // DARK_YELLOW
        [0xde, 0xd0, 0x87, 0xff], // LIGHT_YELLOW
        [0x3a, 0xa2, 0x41, 0xff], // DARK_GREEN
        [0xb7, 0x66, 0xb5, 0xff], // MAGENTA
        [0xcc, 0xcc, 0xcc, 0xff], // GRAY
        [0xff, 0xff, 0xff, 0xff], // WHITE
    ];

    imports = { 
        wasi_snapshot_preview1: {
            fd_seek: (a) => {},
            fd_write: (a) => {},
            fd_close: (a) => {},
            proc_exit: (a) => {},
        },
        env: { 
            wbe_get_keydown: () => { 
                return this.events.shift() || 0; 
            },
            wbe_set_color: (c) => {
                this.renderer.setColor(c);
            },
            wbe_clear: () => {
                this.renderer.clear();
            },
            wbe_set_render_target: (tgt) => {
                this.renderer.target = tgt;
            },
            wbe_render_quads: (ptr, len) => {
                const buf = new Int32Array(this.exports.memory.buffer, ptr, len);
                this.renderer.renderQuads(buf);
            },
            wbe_render_lines: (ptr, len) => {
                const buf = new Int32Array(this.exports.memory.buffer, ptr, len);
                this.renderer.renderLines(buf);
            },
            wbe_render_static: (idx) => {
                this.renderer.renderStatic(idx);
            },
            wbe_toggle_scale_factor: () => {
                this.renderer.toggleScaleFactor();
            },
            wbe_send_audiomsg: (msg) => {
                this.audio.sendMessage(msg);
            },
        },
    };

    async main() {
        const mod = await WebAssembly.compileStreaming(fetch(`./${this.name}.wasm`));
        const inst = await WebAssembly.instantiate(mod, this.imports);
        this.exports = inst.exports;
        this.update = inst.exports.am_update;
        const scale = this.getScaleFactor(this.width, this.height);
        this.renderer = new CanvasRenderer(this.width, this.height, scale);
        const pixelData = this.loadPixelData();
        await this.renderer.loadTexture(this.palette, pixelData);
        this.audio = new AudioSubsystem(this.name);
        await this.audio.init();
        const err = this.exports.am_init(performance.now());
        if (err) throw new Error("init failed");

        document.addEventListener("keydown", (e) => {
            const ev = this.eventVariants[e.key];

            if (ev) {
                e.preventDefault();

                if (!e.repeat) {
                    this.events.push(ev);
                }
            } 
        });

        window.addEventListener("resize", e => {
            const sf = this.getScaleFactor(this.width, this.height);
            this.renderer.setScaleFactor(sf);
        });

        document.addEventListener("touchstart", e => { this.handleStart(e) }, { passive: false });
        document.addEventListener("touchmove", e => { this.handleMove(e) }, { passive: false });
        document.addEventListener("touchend", e => { this.handleEnd(e) });
        document.addEventListener("touchcancel", e => { this.handleEnd(e) });

        const nextFrame = (timestamp) => {
            if (this.update(timestamp)) {
                window.requestAnimationFrame(nextFrame);
            } else {
                const canvas = document.querySelector("canvas");
                document.body.removeChild(canvas);
                this.audio.quit();
            }
        };

        window.requestAnimationFrame(nextFrame);
    }

    loadPixelData() {
        const structPtr = this.exports.wbe_load_pixel_data();
        if (!structPtr) throw new Error("null pixel data");
        const struct = new Int32Array(this.exports.memory.buffer, structPtr, 3);
        const dataPtr = struct[0];
        const width = struct[1];
        const height = struct[2];
        const buf = new Uint8Array(this.exports.memory.buffer, dataPtr, width * height);
        return { buf, width, height };
    }

    getScaleFactor(origW, origH) {
        const w = window.visualViewport.width;
        const h = window.visualViewport.height;

        if (w > h) {
            return Math.floor(h / origH * 10) / 10;
        } else {
            return Math.floor(w / origW * 10) / 10;
        }
    }

    handleStart(e) {
        e.preventDefault();

        for (let t of e.changedTouches) {
            this.touches[t.identifier] = t;
        }

        if (!this.tap) {
            this.tap = true;
            setTimeout(() => { this.tap = false; }, 250);
        } else {
            const ev = this.eventVariants[" "];
            this.events.push(ev);
            this.tap = false;
        }
    }

    handleMove(e) {
        e.preventDefault();
        
        let key = null;

        for (let t of e.changedTouches) {
            const m = 25;
            const prev = this.touches[t.identifier];
            const dx = t.pageX - prev.pageX;
            const dy = t.pageY - prev.pageY;

            if (dx > m) 
                key = "ArrowRight";
            else if (dy > m)
                key = "ArrowDown";
            else if (dx < -m)
                key = "ArrowLeft";
            else if (dy < -m)
                key = "ArrowUp";
          
            this.touches[t.identifier] = t;
        }

        if (key) {
            const ev = this.eventVariants[key];
            this.events.push(ev);
        }
    }

    handleEnd(e) {
        e.preventDefault();

        for (let t of e.changedTouches) {
            delete this.touches[t.identifier];
        }
    }
}

class CanvasRenderer {
    constructor(width, height, scale) {
        this.target = 0;
        this.contexts = [];
        this.origWidth = width;
        this.origHeight = height;
        this.initCanvas(true, { alpha: false });
        this.initCanvas(false, {});
        this.setScaleFactor(scale);
    }

    initCanvas(onscreen, attrs) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", attrs);

        if (!ctx) {
            const p = document.createElement("p");
            p.textContent = "Sorry, your browser does not support canvas rendering.";
            document.body.appendChild(p);
            throw new Error("Could not create 2D context.");
        }

        if (onscreen) {
            document.body.appendChild(canvas);
        }

        ctx.canvas.width = this.origWidth;
        ctx.canvas.height = this.origHeight;
        this.contexts.push(ctx);
    }

    async loadTexture(palette, pixelData) {
        const img = this.contexts[0].createImageData(pixelData.width, pixelData.height);

        for (let i = 0; i < pixelData.buf.length; i++) {
            const j = i * 4;
            const c = pixelData.buf[i];
            img.data[j + 0] = palette[c][0];
            img.data[j + 1] = palette[c][1];
            img.data[j + 2] = palette[c][2];
            img.data[j + 3] = palette[c][3];
        }

        this.cssPalette = palette.map(c => { return `rgb(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})` });
        this.texture = await createImageBitmap(img);
    }

    setColor(c) {
        const ctx = this.contexts[this.target];
        ctx.fillStyle = this.cssPalette[c];
        ctx.strokeStyle = this.cssPalette[c];
    }

    renderQuads(buf) {
        const ctx = this.contexts[this.target];

        for (let i = 0; i < buf.length; i += 8) {
            ctx.drawImage(this.texture,
                          buf[i + 0],
                          buf[i + 1],
                          buf[i + 2],
                          buf[i + 3],
                          buf[i + 4],
                          buf[i + 5],
                          buf[i + 6],
                          buf[i + 7]);
        }
    }   

    renderLines(buf) {
        const ctx = this.contexts[this.target];
        ctx.beginPath();

        for (let i = 0; i < buf.length; i += 4) {
            ctx.moveTo(buf[i + 0] + .5, buf[i + 1] + .5);
            ctx.lineTo(buf[i + 2] + .5, buf[i + 3] + .5);
        }

        ctx.stroke();
    }

    renderStatic(idx) {
        if (idx) {
            const ctx = this.contexts[0];
            const canvas = this.contexts[idx].canvas;
            ctx.drawImage(canvas, 0, 0);
        }
    }

    toggleScaleFactor() {
        this.setScaleFactor((Math.floor(this.scaleFactor) + 1) % 11);
    }

    setScaleFactor(n) {
        const sf = n || 1;
        const w = window.visualViewport.width;
        const h = window.visualViewport.height;
        const margw = Math.floor((w - this.origWidth * sf) / 2);
        const margh = Math.floor((h - this.origHeight * sf) / 2);
        const ctx = this.contexts[0];
        ctx.canvas.style = `
            transform-origin: 0 0; 
            transform: scale(${sf}); 
            --margw: ${margw}px; 
            --margh: ${margh}px; 
        `;
        this.scaleFactor = sf;
    }

    clear() {
        const ctx = this.contexts[this.target];
        ctx.fillRect(0, 0, this.origWidth, this.origHeight);
    }
}

class AudioSubsystem {
    constructor(name) {
        this.ctx = new AudioContext({ sampleRate: 44100 });
        this.name = name;
    }

    async init() {
        const modName = this.name + "_audio";
        await this.ctx.audioWorklet.addModule(modName + ".js");
        const res = await fetch(`./${modName}.wasm`);
        const wasmSrc = await res.arrayBuffer();
        const options = { 
            numberOfInputs: 0, 
            processorOptions: { wasmSrc } 
        };
        this.worklet = new AudioWorkletNode(this.ctx, modName, options);
        this.worklet.connect(this.ctx.destination);
    }

    sendMessage(msg) {
        this.worklet.port.postMessage(msg);
    }

    quit() {
        this.worklet.disconnect();
        this.ctx.close();
    }
}

function chromeCompatibilityHack() {
    const game = new WasmGame("antimatter", 256, 192);
    let ctx = new AudioContext();

    setTimeout(() => {
        if (ctx.state === "suspended") {
            const btn = document.createElement("button");
            btn.textContent = "Click to play";
            document.body.appendChild(btn);
            ctx = null;

            btn.onclick = _ => {
                document.body.removeChild(btn);
                game.main();
            };
        } else {
            ctx = null;
            game.main();
        }
    }, 500);
}

chromeCompatibilityHack();
