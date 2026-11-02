// Voice taps: the AudioWorklet half of voice.mjs. Each node takes one mono
// input (a microphone or a remote participant's stream), gathers 10 ms
// blocks and posts them to the main thread, which queues them for the
// game's WebAssembly. The output is silence, kept only so the node is pulled.
// The main thread sends consumed blocks back, so steady capture allocates
// nothing on the audio thread.
class VoiceTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.blockFrames = Math.max(128, Math.round(sampleRate / 100));
    this.block = new Float32Array(this.blockFrames);
    this.filled = 0;
    this.open = true;
    this.free = [];
    this.port.onmessage = event => {
      if (event.data === 'close') this.open = false;
      else if (event.data instanceof Float32Array && event.data.length === this.blockFrames && this.free.length < 64) this.free.push(event.data);
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const count = Math.min(channel.length - offset, this.blockFrames - this.filled);
        this.block.set(channel.subarray(offset, offset + count), this.filled);
        this.filled += count; offset += count;
        if (this.filled === this.blockFrames) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = this.free.pop() ?? new Float32Array(this.blockFrames); this.filled = 0;
        }
      }
    }
    return this.open;
  }
}
registerProcessor('starhermit-voice-tap', VoiceTap);
