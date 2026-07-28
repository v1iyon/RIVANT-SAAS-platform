import { runSync } from "./sync-stripe-core.mjs";

runSync()
  .then((result) => {
    console.log("Sync finished:", result);
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exitCode = 1;
  });