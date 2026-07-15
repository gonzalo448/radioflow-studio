/** Mitades temporales del buffer (aprox. “L/R” en mono codificado como estéreo). */
export function splitWaveformHalfPeaks(buf: Float32Array): { peakL: number; peakR: number } {
 let maxL = 0;
 let maxR = 0;
 const half = Math.max(1, Math.floor(buf.length / 2));
 for (let i = 0; i < half; i++) {
 const a = Math.abs(buf[i]);
 if (a > maxL) maxL = a;
 }
 for (let i = half; i < buf.length; i++) {
 const a = Math.abs(buf[i]);
 if (a > maxR) maxR = a;
 }
 return { peakL: maxL, peakR: maxR };
}
