import { prisma } from "../db.js";

export async function getOrCreateSettings() {
  return prisma.appSettings.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      stationName: "RadioFlow Studio",
      primaryColor: "#38bdf8",
    },
    update: {},
  });
}
