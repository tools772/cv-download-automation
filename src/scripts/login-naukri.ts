import { assertConfig } from "../config.js";
import { connectNaukri } from "../providers/naukriLogin.js";

const url = process.argv[2];

async function main(): Promise<void> {
  assertConfig();
  await connectNaukri(url);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
