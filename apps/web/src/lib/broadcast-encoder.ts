import type { RadioflowEncoderLocalStatus, RadioflowEncoderStartPayload } from "../desktop-bridge";
import { apiOrigin } from "./api-base";

export function hasDesktopEncoderBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.radioflow?.encoder);
}

export async function getLocalEncoderStatus(): Promise<RadioflowEncoderLocalStatus | null> {
  const enc = window.radioflow?.encoder;
  if (!enc) return null;
  return enc.status();
}

export async function startLocalEncoder(
  token: string,
  opts?: Omit<RadioflowEncoderStartPayload, "token" | "apiOrigin">,
): Promise<RadioflowEncoderLocalStatus> {
  const enc = window.radioflow?.encoder;
  if (!enc) {
    return { running: false, pid: null, error: "Encoder integrado solo en la app de escritorio." };
  }
  return enc.start({
    token,
    apiOrigin: apiOrigin(),
    icecastAdminPassword: opts?.icecastAdminPassword,
    icecastAdminUser: opts?.icecastAdminUser,
  });
}

export async function stopLocalEncoder(): Promise<RadioflowEncoderLocalStatus> {
  const enc = window.radioflow?.encoder;
  if (!enc) {
    return { running: false, pid: null, error: "Encoder integrado solo en la app de escritorio." };
  }
  return enc.stop();
}
