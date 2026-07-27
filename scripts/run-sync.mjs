import { runSync } from "./sync-stripe-core.mjs";

runSync()
  .then((result) => {
    console.log("Sync finished:", result);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });