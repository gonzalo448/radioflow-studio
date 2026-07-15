import "dotenv/config";
import { regenerateAllLiquidsoapM3u } from "../lib/liquidsoap-m3u-generator.js";

async function main() {
  const r = await regenerateAllLiquidsoapM3u();
  console.log(
    `Listo: ${r.written} archivos en ${r.outDir} · cola=${r.stationQueueTracks} · eventos=${r.eventoTracks}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
