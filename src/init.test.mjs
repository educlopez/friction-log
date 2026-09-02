import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AGENTS_MARKER,
  ignoredPaths,
  initRepo,
  mergeAgentsSection,
  parseRepoFromRemote,
  readRegularFile,
  renderTemplate,
} from "./init.mjs";

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
    assert.equal(result.written.length, 6);
    assert.equal(skill.includes("educlopez/smoothui"), true);
    assert.equal(skill.includes("@educlopez"), true);
    assert.equal(workflow.includes("educlopez/friction-log@v1"), true);
  });

  it("writes the same skill to every harness convention", async () => {
    const dest = await mkdtemp(join(tmpdir(), "friction-log-init-"));
    await initRepo("educlopez/smoothui", dest);
    const claude = await readFile(
      join(dest, ".claude/skills/friction-log/SKILL.md"),
      "utf8"
    );
    const cursor = await readFile(
      join(dest, ".cursor/skills/friction-log/SKILL.md"),
      "utf8"
    );

    assert.equal(claude, cursor);
    assert.equal(claude.includes("{{REPO}}"), false);
  });

  it("creates AGENTS.md when the repo has none", async () => {
    const dest = await mkdtemp(join(tmpdir(), "friction-log-init-"));
    const result = await initRepo("educlopez/smoothui", dest);
    const agents = await readFile(join(dest, "AGENTS.md"), "utf8");

    assert.equal(result.written.includes("AGENTS.md"), true);
    assert.equal(agents.includes(AGENTS_MARKER), true);
    assert.equal(agents.includes("educlopez/smoothui"), true);
  });

  it("appends to an existing AGENTS.md without touching it, then stops", async () => {
    const dest = await mkdtemp(join(tmpdir(), "friction-log-init-"));
    await writeFile(join(dest, "AGENTS.md"), "# Repo\n\nRun `pnpm test`.\n");
    await initRepo("educlopez/smoothui", dest);
    const first = await readFile(join(dest, "AGENTS.md"), "utf8");

    assert.equal(first.startsWith("# Repo\n\nRun `pnpm test`.\n"), true);
    assert.equal(first.includes(AGENTS_MARKER), true);

    const second = await initRepo("educlopez/smoothui", dest);

    assert.equal(await readFile(join(dest, "AGENTS.md"), "utf8"), first);
    assert.equal(second.written.includes("AGENTS.md"), false);
  });
});

describe("readRegularFile", () => {
  it("returns null for an absent path and refuses to follow a symlink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "friction-symlink-"));
    const outside = join(dir, "outside.md");
    await writeFile(outside, "sentinel\n");
    await symlink(outside, join(dir, "AGENTS.md"));

    assert.equal(await readRegularFile(join(dir, "nope.md")), null);
    await assert.rejects(() => readRegularFile(join(dir, "AGENTS.md")), {
      message: /symbolic link/,
    });
    assert.equal(await readFile(outside, "utf8"), "sentinel\n");
  });

  it("leaves a linked file untouched when init runs", async () => {
    const dest = await mkdtemp(join(tmpdir(), "friction-symlink-init-"));
    const outside = join(dest, "outside.md");
    await writeFile(outside, "sentinel\n");
    await symlink(outside, join(dest, "AGENTS.md"));

    await assert.rejects(() => initRepo("educlopez/smoothui", dest), {
      message: /symbolic link/,
    });
    assert.equal(await readFile(outside, "utf8"), "sentinel\n");
  });
});

describe("mergeAgentsSection", () => {
  const section = `${AGENTS_MARKER}\n\n## Friction log\n`;

  it("creates, appends once, and then reports the section present", () => {
    assert.deepEqual(mergeAgentsSection(null, section), {
      action: "created",
      text: `${AGENTS_MARKER}\n\n## Friction log\n`,
    });
    assert.deepEqual(mergeAgentsSection("# Repo\n", section), {
      action: "appended",
      text: `# Repo\n\n${AGENTS_MARKER}\n\n## Friction log\n`,
    });
    assert.equal(
      mergeAgentsSection(`# Repo\n\n${section}`, section).action,
      "present"
    );
  });

  it("treats a blank AGENTS.md as absent rather than appending to nothing", () => {
    assert.deepEqual(mergeAgentsSection("\n  \n", section), {
      action: "created",
      text: `${AGENTS_MARKER}\n\n## Friction log\n`,
    });
  });
});

describe("ignoredPaths", () => {
  it("reports paths a gitignore would swallow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "friction-ignore-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".gitignore"), ".cursor/\n");
    await mkdir(join(dir, ".cursor", "skills"), { recursive: true });
    await writeFile(join(dir, ".cursor", "skills", "SKILL.md"), "x");
    await writeFile(join(dir, "kept.md"), "x");

    assert.deepEqual(
      ignoredPaths([".cursor/skills/SKILL.md", "kept.md"], dir),
      [".cursor/skills/SKILL.md"]
    );
  });

  it("returns nothing when the directory is not a repo", () => {
    assert.deepEqual(ignoredPaths(["anything.md"], tmpdir()), []);
  });

  it("returns nothing for an empty list", () => {
    assert.deepEqual(ignoredPaths([], tmpdir()), []);
  });
});
