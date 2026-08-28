#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { initRepo, parseRepoFromRemote } from "./init.mjs";
import { parseArgs, runSweep } from "./sweep.mjs";

/**
 * @param {string[]} argv
 * @param {string} cwd
 */
export async function main(argv, cwd = process.cwd()) {
  const command = argv[2];

  if (command === "init") {
    const force = argv.includes("--force");
    let repo = process.env.FRICTION_LOG_REPO ?? "";

    if (!repo) {
      try {
        const remote = execFileSync("git", ["remote", "get-url", "origin"], {
          cwd,
          encoding: "utf8",
        });
        repo = parseRepoFromRemote(remote) ?? "";
      } catch {
        repo = "";
      }
    }

    if (!repo) {
      throw new Error(
        "Could not detect owner/name. Set FRICTION_LOG_REPO or run from a GitHub checkout."
      );
    }

    const result = await initRepo(repo, cwd, { force });
    console.log(`
Next:
1. Create the friction label (color #D4A017) if it does not exist
2. Add repository secret CURSOR_API_KEY (Cursor Dashboard → API Keys)
3. Optional kill switch: repo variable FRICTION_LOG_PAUSED=true
4. Commit the files written for ${result.repo}
`);
    return result;
  }

  const args = parseArgs(argv);
  return await runSweep(args);
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
