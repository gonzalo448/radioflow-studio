/** Decodifica un blob de audio para edición (waveform / trim). */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    const ab = await blob.arrayBuffer();
    return await ctx.decodeAudioData(ab.slice(0));
  } finally {
    void ctx.close();
  }
}

/** Picos normalizados 0..1 para dibujar waveform (downsample por bloques). */
export async function computeWaveformPeaks(blob: Blob, bars = 120): Promise<number[]> {
  const buffer = await decodeAudioBlob(blob);
  const ch = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(ch.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * block;
    const end = Math.min(ch.length, start + block);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const top = Math.max(0.001, ...peaks);
  return peaks.map((p) => p / top);
}

/** Recorta un blob entre startSec y endSec (Web Audio → re-encode vía MediaRecorder si hace falta). */
export async function trimAudioBlob(blob: Blob, mime: string, startSec: number, endSec: number): Promise<Blob> {
  const buffer = await decodeAudioBlob(blob);
  const duration = buffer.duration;
  const start = Math.max(0, Math.min(startSec, duration));
  const end = Math.max(start + 0.05, Math.min(endSec, duration));
  if (start <= 0.01 && end >= duration - 0.01) return blob;

  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(start * sampleRate);
  const endSample = Math.min(buffer.length, Math.ceil(end * sampleRate));
  const length = endSample - startSample;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, length, sampleRate);
  const src = ctx.createBufferSource();
  const trimmed = ctx.createBuffer(buffer.numberOfChannels, length, sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    trimmed.copyToChannel(buffer.getChannelData(c).subarray(startSample, endSample), c);
  }
  src.buffer = trimmed;
  src.connect(ctx.destination);
  src.start(0);
  const rendered = await ctx.startRendering();

  const destCtx = new AudioContext();
  try {
    const dest = destCtx.createMediaStreamDestination();
    const play = destCtx.createBufferSource();
    play.buffer = rendered;
    play.connect(dest);
    const recMime = mime && MediaRecorder.isTypeSupported(mime) ? mime : pickExportMime();
    const recorder = recMime
      ? new MediaRecorder(dest.stream, { mimeType: recMime })
      : new MediaRecorder(dest.stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || recMime || "audio/webm" }));
      };
      recorder.onerror = () => reject(new Error("No se pudo exportar el recorte"));
    });
    recorder.start(100);
    play.start(0);
    play.onended = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    return await done;
  } finally {
    void destCtx.close();
  }
}

function pickExportMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}
