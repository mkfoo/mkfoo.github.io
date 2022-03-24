const importObj = { 
    wasi_snapshot_preview1: {
        fd_seek: (a) => {},
        fd_write: (a) => {},
        fd_close: (a) => {},
        proc_exit: (a) => {},
    },
};

class AntimatterAudio extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.loadWASM(options);
        this.messages = [];
        this.port.onmessage = (e) => {
            this.messages.push(e.data); 
        }; 
    }

    async loadWASM(options) {
        const mod = await WebAssembly.compile(options.processorOptions.wasmSrc);
        const inst = await WebAssembly.instantiate(mod, importObj);
        const wasm = inst.exports;
        const ptr = wasm.am_audio_init();

        if (ptr) {
            this.buf = new Float32Array(wasm.memory.buffer, ptr, 128);
            this.ptr = ptr;
            this.wasm = wasm;    
        }
    }

    process (inputs, outputs, parameters) {
        if (this.wasm) {
            while (this.messages.length) {
                this.wasm.am_audio_recv_msg(this.messages.shift());
            }

            const chn = outputs[0][0];
            const err = this.wasm.am_audio_generate(chn.length);
            if (err) throw new Error(`audio error: ${err}`);

            if (chn.length !== this.buf.length) {
                this.buf = new Float32Array(this.wasm.memory.buffer, this.ptr, chn.length);
            }
            
            chn.set(this.buf); 
        } 

        return true;
    }
}

registerProcessor("antimatter_audio", AntimatterAudio);

