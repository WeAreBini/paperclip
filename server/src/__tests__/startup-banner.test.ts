import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printStartupBanner } from "../startup-banner.js";

const ORIGINAL_ENV = { ...process.env };
const itPosix = process.platform === "win32" ? it.skip : it;

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("printStartupBanner", () => {
  itPosix("ignores an unreadable optional instance env file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-startup-banner-"));
    const configPath = path.join(tempDir, "instance", "config.json");
    const envPath = path.join(tempDir, "instance", ".env");
    process.env.PAPERCLIP_CONFIG = configPath;
    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({}));
    fs.writeFileSync(envPath, "PAPERCLIP_AGENT_JWT_SECRET=test-secret\n");
    fs.chmodSync(envPath, 0o000);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(() =>
      printStartupBanner({
        bind: "tcp",
        host: "0.0.0.0",
        deploymentMode: "authenticated",
        deploymentExposure: "public",
        authReady: true,
        requestedPort: 3100,
        listenPort: 3100,
        uiMode: "static",
        db: {
          mode: "external-postgres",
          connectionString: "postgres://user:pass@db.example.com:5432/paperclip",
        },
        migrationSummary: "No pending migrations",
        heartbeatSchedulerEnabled: true,
        heartbeatSchedulerIntervalMs: 30_000,
        databaseBackupEnabled: true,
        databaseBackupIntervalMinutes: 60,
        databaseBackupRetentionDays: 7,
        databaseBackupDir: "/paperclip/instances/default/data/backups",
      }),
    ).not.toThrow();

    const banner = logSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(banner).toContain("missing (run `pnpm paperclipai onboard`)");

    fs.chmodSync(envPath, 0o644);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});