import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexExecArgs } from "./codex-args.js";

describe("buildCodexExecArgs", () => {
  it("enables Codex fast mode overrides for GPT-5.4", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.4",
      search: true,
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(true);
    expect(result.fastModeIgnoredReason).toBeNull();
    expect(result.args).toEqual([
      "--search",
      "exec",
      "--json",
      "--model",
      "gpt-5.4",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-",
    ]);
  });

  it("ignores fast mode for unsupported models", () => {
    const result = buildCodexExecArgs({
      model: "gpt-5.3-codex",
      fastMode: true,
    });

    expect(result.fastModeRequested).toBe(true);
    expect(result.fastModeApplied).toBe(false);
    expect(result.fastModeIgnoredReason).toContain("currently only supported on gpt-5.4");
    expect(result.args).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.3-codex",
      "-",
    ]);
  });

  it("adds --skip-git-repo-check when cwd is outside a git repo", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-nongit-"));

    try {
      const result = buildCodexExecArgs({
        cwd,
        model: "gpt-5.3-codex",
      });

      expect(result.args).toEqual([
        "exec",
        "--json",
        "--model",
        "gpt-5.3-codex",
        "--skip-git-repo-check",
        "-",
      ]);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not add --skip-git-repo-check inside a git repo", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-git-"));
    const cwd = path.join(root, "workspace", "nested");

    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.mkdir(cwd, { recursive: true });

    try {
      const result = buildCodexExecArgs({
        cwd,
        model: "gpt-5.3-codex",
      });

      expect(result.args).toEqual([
        "exec",
        "--json",
        "--model",
        "gpt-5.3-codex",
        "-",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
