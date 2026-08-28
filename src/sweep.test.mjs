import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractAgentUrl,
  parseArgs,
  resolveOwnerLogins,
  resolveRepo,
} from "./sweep.mjs";

describe("parseArgs", () => {
  it("defaults to a dry scan", () => {
    assert.deepEqual(parseArgs(["node", "sweep.mjs"]), {
      command: "scan",
      dryRun: true,
      force: false,
    });
  });

  it("sweep without flags is a live run", () => {
    assert.deepEqual(parseArgs(["node", "sweep.mjs", "sweep"]), {
      command: "sweep",
      dryRun: false,
      force: false,
    });
  });

  it("honors --dry-run and --force on sweep", () => {
    assert.deepEqual(
      parseArgs(["node", "sweep.mjs", "sweep", "--dry-run", "--force"]),
      { command: "sweep", dryRun: true, force: true }
    );
  });
});

describe("extractAgentUrl", () => {
  it("reads the v1 agent.url field", () => {
    assert.equal(
      extractAgentUrl({
        agent: {
          id: "bc-1",
          url: "https://cursor.com/agents/bc-1",
        },
      }),
      "https://cursor.com/agents/bc-1"
    );
  });
});

describe("resolveRepo", () => {
  it("prefers FRICTION_LOG_REPO over GITHUB_REPOSITORY", () => {
    assert.equal(
      resolveRepo({
        FRICTION_LOG_REPO: "educlopez/smoothui",
        GITHUB_REPOSITORY: "educlopez/other",
      }),
      "educlopez/smoothui"
    );
  });

  it("throws when no repo is configured", () => {
    assert.throws(() => resolveRepo({}), /FRICTION_LOG_REPO/);
  });
});

describe("resolveOwnerLogins", () => {
  it("uses the repo owner when FRICTION_LOG_OWNER is unset", () => {
    assert.deepEqual(resolveOwnerLogins({}, "acme/widgets"), ["acme"]);
  });

  it("splits a comma-separated owner list", () => {
    assert.deepEqual(
      resolveOwnerLogins({ FRICTION_LOG_OWNER: "educlopez, teammate" }, "x/y"),
      ["educlopez", "teammate"]
    );
  });
});
