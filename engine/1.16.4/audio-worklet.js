// A separate first-party WASM mixer, driven on the audio rendering thread.
// Control handlers may allocate; process uses cached views and browser buffers.
export class MixerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.ready = false; this.closed = false; this.fault = 0; this.frames = 0; this.auditOps = 0;
    this.instance = new WebAssembly.Instance(options.processorOptions.module, {starhermit: {
      report_error: () => {this.fault = 1;}, report_note: () => {},
    }});
    this.instance.exports.main(0,0);
    this.channels = options.processorOptions.channels; this.limit = options.processorOptions.limit;this.ceiling=options.processorOptions.ceiling??256;
    if (!this.instance.exports.sh_audio_open(sampleRate, this.channels, this.limit,this.ceiling)) throw new Error('Audio mixer initialization failed');
    this.autoHint=options.processorOptions.autoHint??this.limit;
    if(!this.instance.exports.sh_audio_seed_hint(this.autoHint,0))throw new Error('Invalid Auto recommendation');
    const performance=globalThis.performance,date=globalThis.Date;
    this.clock=typeof performance?.now==='function'?performance.now.bind(performance):typeof date?.now==='function'?date.now.bind(date):null;
    this.clockKind=typeof performance?.now==='function'?1:this.clock?2:0;
    if (!(this.instance.exports.memory.buffer instanceof ArrayBuffer)) throw new Error('Audio shared memory is unsupported');
    this.refreshViews(); this.ready = true;
    this.port.onmessage = event => this.message(event.data);
    this.port.postMessage({type:'ready'});
  }
  refreshViews() {
    const memory = this.instance.exports.memory.buffer;
    if (this.buffer === memory) return;
    this.buffer = memory;
    this.input = new Float32Array(memory, this.instance.exports.sh_audio_input_ptr(), 16384);
    this.output = new Float32Array(memory, this.instance.exports.sh_audio_output_ptr(), 4096 * this.channels);
    this.bytes = new Uint8Array(memory, this.instance.exports.sh_audio_bytes_ptr(), 65536);
  }
  // Synthesis graph records (Uint8Array chunks of at most 64 KiB).
  graphBytes(message) {
    if (!(message.bytes instanceof Uint8Array) || message.bytes.length > 65536) throw new Error('Invalid audio graph chunk');
    this.bytes.set(message.bytes); return message.bytes.length;
  }
  message(message) {
    if (message?.type === 'shutdown') {
      this.closed = true; this.ready = false; this.instance?.exports.sh_audio_close();
      this.input = this.output = this.bytes = this.buffer = this.instance = null; this.port.close(); return;
    }
    if(this.closed)return;
    const id = message?.id;
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff) return;
    try {
      if (!this.ready || this.closed || this.fault) throw new Error('Audio processor unavailable');
      const wasm = this.instance.exports; let value;
      switch (message.type) {
        case 'begin': value = wasm.sh_audio_clip_begin(message.rate,message.channels,message.mask,message.samples); break;
        case 'append': {
          if (!(message.samples instanceof Float32Array) || !(message.samples.buffer instanceof ArrayBuffer) || message.samples.length > 16384) throw new Error('Invalid audio chunk');
          this.input.set(message.samples); value = wasm.sh_audio_clip_append(message.samples.length); break;
        }
        case 'commit': value = wasm.sh_audio_clip_commit(); break;
        case 'streamWrite': {
          if (!(message.samples instanceof Float32Array) || message.samples.length > 16384 || !Number.isInteger(message.handle)) throw new Error('Invalid audio stream chunk');
          this.input.set(message.samples); value = wasm.sh_audio_stream_write(message.handle, message.samples.length); break;
        }
        case 'abort': wasm.sh_audio_clip_abort(); value = 1; break;
        case 'play': {const priority=message.priority??0;if(!Number.isInteger(priority)||priority< -32768||priority>32767)throw new Error('Invalid voice priority');value = wasm.sh_audio_play(message.clip,message.gain,message.pitch,message.loopStart,message.loopEnd,message.pan,message.bus,message.offset,priority);break;}
        case 'command': value = wasm.sh_audio_command(message.op,message.handle,message.a,message.b); break;
        case 'preferences':{if(!Array.isArray(message.volumes)||message.volumes.length!==5||message.volumes.some(value=>!Number.isFinite(value)||value<0||value>1)||!Number.isInteger(message.flags)||message.flags<0||message.flags>15||(message.requested!=='auto'&&(!Number.isInteger(message.requested)||message.requested<1||message.requested>256))||!Number.isInteger(message.autoLimit)||message.autoLimit<1||message.autoLimit>256)throw new Error('Invalid audio preferences');this.input.set(message.volumes);value=wasm.sh_audio_preferences(message.flags,message.requested==='auto'?0:message.requested,message.autoLimit);break;}
        case 'resetFeedback':if(!Number.isInteger(message.autoHint)||message.autoHint<1||message.autoHint>256)throw new Error('Invalid Auto recommendation');value=wasm.sh_audio_seed_hint(message.autoHint,1);break;
        case 'graphOpen': value = wasm.sh_audio_graph_open(this.graphBytes(message)); break;
        case 'graphAppend': value = wasm.sh_audio_graph_append(this.graphBytes(message)); break;
        case 'graphApply': {
          const length = wasm.sh_audio_graph_apply();
          // The feedback record, copied out of WASM memory.
          value = length ? new Uint8Array(this.instance.exports.memory.buffer, wasm.sh_audio_graph_result_ptr(), length - 1).slice() : 0;
          break;
        }
        case 'graphClose': wasm.sh_audio_graph_close(); value = 1; break;
        case 'stats': value = {frames:this.frames,active:wasm.sh_audio_metric(1),clipBytes:wasm.sh_audio_metric(2),effectiveLimit:wasm.sh_audio_metric(4),capacity:wasm.sh_audio_metric(5),virtualized:wasm.sh_audio_metric(6),suppressed:wasm.sh_audio_metric(7),virtualizationEvents:wasm.sh_audio_metric(8),clippedSamples:wasm.sh_audio_metric(9),finishedVoices:wasm.sh_audio_metric(10),replacedVoices:wasm.sh_audio_metric(11),timingClock:this.clockKind,renderedBlocks:wasm.sh_audio_metric(13),overloadedBlocks:wasm.sh_audio_metric(14),underruns:wasm.sh_audio_metric(15),peakRenderNanos:wasm.sh_audio_metric(18)?wasm.sh_audio_metric(16):null,autoRecommendation:wasm.sh_audio_metric(17),auditEnabled:!!wasm.sh_audio_audit_enabled(),auditOps:this.auditOps,fault:this.fault}; break;
        default: throw new Error('Unknown audio operation');
      }
      this.refreshViews();
      if (!value) throw new Error(`Audio ${message.type} rejected`);
      this.port.postMessage({id,value});
    } catch(error) {
      this.refreshViews(); this.port.postMessage({id,error:String(error.message || error).slice(0,512)});
    }
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels) return !this.closed;
    const frames = channels[0]?.length || 0;
    let success = false;
    if (this.ready && !this.fault && channels.length === this.channels && frames <= 4096) {
      try {
        const started=this.clockTime();
        success = this.instance.exports.sh_audio_render(frames) === 1;
        const ended=this.clockTime();
        let nanos=-1;
        if(started!==null&&ended!==null&&ended>=started){const elapsed=Math.round((ended-started)*1000000);if(Number.isSafeInteger(elapsed)&&elapsed>=0)nanos=elapsed;}
        else if(started!==null&&ended!==null&&ended<started){this.clock=null;this.clockKind=0;}
        if(success&&frames>0)success=this.instance.exports.sh_audio_observe(frames,nanos)===1;
        this.auditOps += this.instance.exports.sh_audio_audit_ops();
        if (success) this.frames += frames; else this.fault = 2;
        // Outside the audited render: queued graph commands apply (a bounded
        // step per quantum), released nodes are freed and the basic
        // waveforms' tables are built ahead, which may grow the memory.
        if (success) {this.instance.exports.sh_audio_graph_maintain(frames); this.refreshViews();}
      } catch {this.fault = 3;}
    }
    for(let channel=0;channel<channels.length;channel++) {
      const target = channels[channel];
      for(let frame=0;frame<target.length;frame++) target[frame] = success ? this.output[frame*this.channels+channel] : 0;
    }
    return !this.closed;
  }
  clockTime(){if(!this.clock)return null;try{const value=this.clock();if(Number.isFinite(value)&&value>=0)return value;}catch{}this.clock=null;this.clockKind=0;return null;}
}
registerProcessor('starhermit-mixer', MixerProcessor);
