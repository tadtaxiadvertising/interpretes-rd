/* global AudioWorkletProcessor, registerProcessor */

/**
 * Free Interpreters Live — same-origin AudioWorklet.
 * Streams mono Float32 PCM to the owning browser tab only.
 * No microphone audio is emitted to the speaker graph or network.
 */
class FreeInterpretersPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.active = true;
    // A bounded packet-credit window also bounds the browser MessagePort queue.
    this.creditLimit = Math.max(1, Math.min(256, options.processorOptions?.packetCredits ?? 16));
    this.credits = this.creditLimit;
    this.packet = new Float32Array(1024);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'stop') {
        this.active = false;
        this.packet = null;
        this.offset = 0;
      } else if (this.active && event.data?.type === 'credit') {
        this.credits = Math.min(this.creditLimit, this.credits + 1);
      }
    };
  }

  process(inputs, outputs) {
    // The node must be connected to the graph to keep receiving callbacks.
    // Always emit silence, never an audible microphone loopback.
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    if (!this.active) return false;

    const channels = inputs[0];
    if (!channels?.length) return true;
    const sampleCount = channels[0]?.length ?? 0;
    for (let i = 0; i < sampleCount; i += 1) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[i] ?? 0;
      this.packet[this.offset] = mixed / channels.length;
      this.offset += 1;
      if (this.offset === this.packet.length) {
        // The consumer has stopped keeping pace. Never silently skip audio.
        if (this.credits === 0) {
          this.active = false;
          this.port.postMessage({ type: 'overflow' });
          this.packet = null;
          this.offset = 0;
          return false;
        }
        this.credits -= 1;
        const complete = this.packet;
        this.port.postMessage({ type: 'pcm', samples: complete }, [complete.buffer]);
        this.packet = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('free-interpreters-live-pcm', FreeInterpretersPcmProcessor);
