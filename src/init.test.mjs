import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { initRepo, parseRepoFromRemote, renderTemplate } from "./init.mjs";

describe("parseRepoFromRemote", () => {
  it("parses https, ssh, and token remotes", () => {
    assert.equal(
      parseRepoFromRemote("https://github.com/educlopez/smoothui.git"),
      "educlopez/smoothui"
    );
    assert.equal(
      parseRepoFromRemote("git@github.com:educlopez/smoothui.git"),
      "educlopez/smoothui"
    );
    assert.equal(
      parseRepoFromRemote(
        "https://x-access-token:abc@github.com/educlopez/smoothui.git"
      ),
      "educlopez/smoothui"
    );
  });
});

describe("renderTemplate", () => {
  it("substitutes repo and owner placeholders", () => {
    assert.equal(
      renderTemplate("repo={{REPO}} owner=@{{OWNER}}", {
        owner: "educlopez",
        repo: "educlopez/smoothui",
      }),
      "repo=educlopez/smoothui owner=@educlopez"
    );
  });
});

describe("initRepo", () => {
  it("writes substituted templates into a target tree", async () => {
    const dest = await mkdtemp(join(tmpdir(), "friction-log-init-"));
    const result = await initRepo("educlopez/smoothui", dest);
    const skill = await readFile(
      join(dest, ".cursor/skills/friction-log/SKILL.md"),
      "utf8"
    );
    const workflow = await readFile(
      join(dest, ".github/workflows/friction-log.yml"),
      "utf8"
    );

    assert.equal(result.owner, "educlopez");
    assert.equal(result.written.length, 4);
    assert.equal(skill.includes("educlopez/smoothui"), true);
    assert.equal(skill.includes("@educlopez"), true);
    assert.equal(workflow.includes("educlopez/friction-log@v1"), true);
  });
});
