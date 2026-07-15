export const JINGLE_SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export type JingleSlotKey = (typeof JINGLE_SLOT_KEYS)[number];
