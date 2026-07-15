export type WavOptions = {
  sampleRateHz: number;
  durationSec: number;
  freqHz: number;
  volume: number; // 0..1
};

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

export function makeSineWav(opts: WavOptions): Buffer {
  const sampleRate = opts.sampleRateHz;
  const numSamples = Math.max(1, Math.floor(sampleRate * opts.durationSec));
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const riffSize = 36 + dataSize;

  const buf = Buffer.allocUnsafe(44 + dataSize);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, riffSize, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const amp = Math.max(0, Math.min(1, opts.volume)) * 0.9;
  const w = 2 * Math.PI * opts.freqHz;
  let o = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const s = Math.sin(w * t) * amp;
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(o, Math.round(v * 32767), true);
    o += 2;
  }

  return buf;
}

