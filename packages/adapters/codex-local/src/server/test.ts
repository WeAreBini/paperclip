import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  parseObject,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  resolveCommandForLogs,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import path from "node:path";
import { parseCodexJsonl } from "./parse.js";
import { resolveManagedCodexHomeDir, resolveSharedCodexHomeDir } from "./codex-home.js";
import { codexHomeDir, readCodexAuthInfo } from "./quota.js";
import { buildCodexExecArgs } from "./codex-args.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const CODEX_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|invalid(?:\s+or\s+missing)?\s+api(?:[_\s-]?key)?|openai[_\s-]?api[_\s-]?key|api[_\s-]?key.*required|please\s+run\s+`?codex\s+login`?)/i;

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "codex");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "codex_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "codex_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const sharedCodexHome = resolveSharedCodexHomeDir(runtimeEnv);
  const managedCodexHome = resolveManagedCodexHomeDir(runtimeEnv, ctx.companyId);
  const sharedAuthPath = path.join(sharedCodexHome, "auth.json");
  const probeEnv = {
    ...runtimeEnv,
    CODEX_HOME: sharedCodexHome,
  };

  checks.push({
    code: "codex_home_paths",
    level: "info",
    message: "Codex home paths resolved for Paperclip.",
    detail: `shared=${sharedCodexHome}; managed=${managedCodexHome}`,
  });

  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
    checks.push({
      code: "codex_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
      detail: `Resolved path: ${resolvedCommand}`,
    });
  } catch (err) {
    checks.push({
      code: "codex_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const configOpenAiKey = env.OPENAI_API_KEY;
  const hostOpenAiKey = process.env.OPENAI_API_KEY;
  let hasAuthConfigured = false;
  if (isNonEmpty(configOpenAiKey) || isNonEmpty(hostOpenAiKey)) {
    const source = isNonEmpty(configOpenAiKey) ? "adapter config env" : "server environment";
    hasAuthConfigured = true;
    checks.push({
      code: "codex_openai_api_key_present",
      level: "info",
      message: "OPENAI_API_KEY is set for Codex authentication.",
      detail: `Detected in ${source}.`,
    });
  } else {
    const codexAuth = await readCodexAuthInfo(sharedCodexHome).catch(() => null);
    if (codexAuth) {
      hasAuthConfigured = true;
      checks.push({
        code: "codex_native_auth_present",
        level: "info",
        message: "Codex is authenticated via its own auth configuration.",
        detail: codexAuth.email ? `Logged in as ${codexAuth.email}.` : `Credentials found in ${sharedAuthPath}.`,
      });
    } else {
      checks.push({
        code: "codex_openai_api_key_missing",
        level: "warn",
        message: "OPENAI_API_KEY is not set. Codex runs may fail until authentication is configured.",
        detail: `Paperclip looked for Codex auth at ${sharedAuthPath}. Service HOME is ${runtimeEnv.HOME ?? process.env.HOME ?? codexHomeDir()}. PAPERCLIP_HOME is ${runtimeEnv.PAPERCLIP_HOME ?? process.env.PAPERCLIP_HOME ?? "(unset)"}.`,
        hint: `Set OPENAI_API_KEY in adapter env, shell environment, or run \`codex auth\` so credentials are available at ${sharedAuthPath}.`,
      });
    }
  }

  const canRunProbe =
    checks.every((check) => check.code !== "codex_cwd_invalid" && check.code !== "codex_command_unresolvable");
  if (canRunProbe) {
    if (!commandLooksLike(command, "codex")) {
      checks.push({
        code: "codex_hello_probe_skipped_custom_command",
        level: "info",
        message: "Skipped hello probe because command is not `codex`.",
        detail: command,
        hint: "Use the `codex` CLI command to run the automatic login and installation probe.",
      });
    } else {
      const execArgs = buildCodexExecArgs({ ...config, fastMode: false });
      const args = execArgs.args;
      if (execArgs.fastModeIgnoredReason) {
        checks.push({
          code: "codex_fast_mode_unsupported_model",
          level: "warn",
          message: execArgs.fastModeIgnoredReason,
          hint: "Switch the agent model to GPT-5.4 to enable Codex Fast mode.",
        });
      }

      const probe = await runChildProcess(
        `codex-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        {
          cwd,
          env: probeEnv,
          timeoutSec: 45,
          graceSec: 5,
          stdin: "Respond with hello.",
          onLog: async () => {},
        },
      );
      const parsed = parseCodexJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

      if (probe.timedOut) {
        checks.push({
          code: "codex_hello_probe_timed_out",
          level: "warn",
          message: "Codex hello probe timed out.",
          hint: "Retry the probe. If this persists, verify Codex can run `Respond with hello` from this directory manually.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "codex_hello_probe_passed" : "codex_hello_probe_unexpected_output",
          level: hasHello ? "info" : "warn",
          message: hasHello
            ? "Codex hello probe succeeded."
            : "Codex probe ran but did not return `hello` as expected.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
          ...(hasHello
            ? {}
            : {
                hint: "Try the probe manually (`codex exec --json -` then prompt: Respond with hello) to inspect full output.",
              }),
        });
      } else if (CODEX_AUTH_REQUIRED_RE.test(authEvidence)) {
        checks.push({
          code: "codex_hello_probe_auth_required",
          level: "warn",
          message: "Codex CLI is installed, but authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Configure OPENAI_API_KEY in adapter env/shell or run `codex login`, then retry the probe.",
        });
      } else if (!hasAuthConfigured) {
        checks.push({
          code: "codex_hello_probe_auth_unavailable",
          level: "warn",
          message: "Codex hello probe could not complete because Paperclip has no usable authentication.",
          ...(detail ? { detail } : {}),
          hint: `Authenticate Codex for the Paperclip service user or provide OPENAI_API_KEY. Expected auth file: ${sharedAuthPath}`,
        });
      } else {
        checks.push({
          code: "codex_hello_probe_failed",
          level: "error",
          message: "Codex hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: "Run `codex exec --json -` manually in this working directory and prompt `Respond with hello` to debug.",
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
