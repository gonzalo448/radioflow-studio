"use strict";

/** @typedef {{ wantRunning: boolean, running: boolean, restartAttempts: number, lastExitAtMs: number | null }} EncoderWatchdogState */

const ENCODER_WATCHDOG_MAX_ATTEMPTS = 20;
const ENCODER_WATCHDOG_BASE_DELAY_MS = 2_000;
const ENCODER_WATCHDOG_MAX_DELAY_MS = 60_000;

/** ¿Debe programarse un reinicio tras un exit inesperado? */
function shouldScheduleEncoderRestart(state) {
  if (!state.wantRunning) return false;
  if (state.running) return false;
  if (state.restartAttempts >= ENCODER_WATCHDOG_MAX_ATTEMPTS) return false;
  return true;
}

/** Backoff exponencial acotado: 2s, 4s, 8s… hasta 60s. */
function encoderRestartDelayMs(attemptIndex) {
  const n = Math.max(0, attemptIndex);
  const delay = ENCODER_WATCHDOG_BASE_DELAY_MS * Math.pow(2, Math.min(n, 5));
  return Math.min(ENCODER_WATCHDOG_MAX_DELAY_MS, delay);
}

function onEncoderStartSuccess(state) {
  return { ...state, wantRunning: true, running: true, restartAttempts: 0 };
}

function onEncoderStoppedByUser(state) {
  return {
    ...state,
    wantRunning: false,
    running: false,
    restartAttempts: 0,
    lastExitAtMs: Date.now(),
  };
}

function onEncoderExited(state) {
  return {
    ...state,
    running: false,
    lastExitAtMs: Date.now(),
    restartAttempts: state.wantRunning ? state.restartAttempts + 1 : state.restartAttempts,
  };
}

module.exports = {
  ENCODER_WATCHDOG_MAX_ATTEMPTS,
  ENCODER_WATCHDOG_BASE_DELAY_MS,
  ENCODER_WATCHDOG_MAX_DELAY_MS,
  shouldScheduleEncoderRestart,
  encoderRestartDelayMs,
  onEncoderStartSuccess,
  onEncoderStoppedByUser,
  onEncoderExited,
};
