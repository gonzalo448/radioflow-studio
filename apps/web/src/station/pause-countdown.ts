/** Estado de cuenta regresiva mientras suena un comando de pausa en cola. */
export type PauseCountdown = {
 queueItemId: string;
 totalSec: number;
 remainingSec: number;
 label: string;
};

export function formatPauseRemaining(sec: number): string {
 const safe = Math.max(0, Math.floor(sec));
 const m = Math.floor(safe / 60);
 const s = safe % 60;
 return `${m}:${String(s).padStart(2, "0")}`;
}

export function pauseCountdownProgress(countdown: PauseCountdown): number {
 if (countdown.totalSec <= 0) return 0;
 const elapsed = countdown.totalSec - countdown.remainingSec;
 return Math.min(100, Math.max(0, (elapsed / countdown.totalSec) * 100));
}
