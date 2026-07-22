import { connectInstahyre } from "../providers/instahyreLogin.js";
import { assertConfig } from "../config.js";

const url = process.argv[2];

async function main(): Promise<void> {
  assertConfig();
  await connectInstahyre(url);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
