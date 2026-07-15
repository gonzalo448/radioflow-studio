import "dotenv/config";
import { runStandaloneMigrationsSync } from "./lib/run-standalone-migrate.js";

runStandaloneMigrationsSync();

await import("./server.js");
