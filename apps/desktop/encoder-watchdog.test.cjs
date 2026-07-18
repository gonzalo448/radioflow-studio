"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldScheduleEncoderRestart,
  encoderRestartDelayMs,
  onEncoderStartSuccess,
  onEncoderStoppedByUser,
  onEncoderExited,
  ENCODER_WATCHDOG_MAX_ATTEMPTS,
} = require("./encoder-watchdog.cjs");

describe("encoder-watchdog", () => {
  it("no reinicia si el usuario lo apagó", () => {
    const s = onEncoderStoppedByUser({
      wantRunning: true,
      running: true,
      restartAttempts: 0,
      lastExitAtMs: null,
    });
    assert.equal(s.wantRunning, false);
    assert.equal(shouldScheduleEncoderRestart(s), false);
  });

  it("reinicia tras exit inesperado con backoff", () => {
    let s = onEncoderStartSuccess({
      wantRunning: false,
      running: false,
      restartAttempts: 0,
      lastExitAtMs: null,
    });
    assert.equal(s.wantRunning, true);
    s = onEncoderExited(s);
    assert.equal(s.running, false);
    assert.equal(s.restartAttempts, 1);
    assert.equal(shouldScheduleEncoderRestart(s), true);
    assert.equal(encoderRestartDelayMs(0), 2000);
    assert.equal(encoderRestartDelayMs(1), 4000);
    assert.equal(encoderRestartDelayMs(5), 64000 > 60000 ? 60000 : 64000);
    assert.equal(encoderRestartDelayMs(5), 60000);
  });

  it("deja de reiniciar tras demasiados intentos", () => {
    const s = {
      wantRunning: true,
      running: false,
      restartAttempts: ENCODER_WATCHDOG_MAX_ATTEMPTS,
      lastExitAtMs: Date.now(),
    };
    assert.equal(shouldScheduleEncoderRestart(s), false);
  });
});
