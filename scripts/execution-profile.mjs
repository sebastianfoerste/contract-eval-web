import { readFileSync } from "node:fs";

export function readExecutionProfile() {
  let settings;
  try {
    settings = JSON.parse(readFileSync(new URL("../.sites-runtime/execution-profile.json", import.meta.url), "utf8"));
  } catch (error) {
    // Clean clones and remote builds have no checkout-local selection.
    if (error.code === "ENOENT") return "portable";
    throw error;
  }
  if (!["managed-linux", "portable"].includes(settings?.executionProfile)) {
    throw new Error(
      'Invalid local execution profile in .sites-runtime/execution-profile.json: set "executionProfile" to "managed-linux" or "portable", or delete the file to use "portable".',
    );
  }
  return settings.executionProfile;
}
