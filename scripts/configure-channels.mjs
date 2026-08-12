import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import {
  formatRedactedPreview,
  parseChannelConfig,
  sanitizeError,
  validateEnvironment,
} from "./lib/channel-config.mjs";
import { applyChangePlan, runDryRun } from "./lib/channel-config-db.mjs";

const USAGE = "usage: node scripts/configure-channels.mjs <config.json> [--apply]\n";

function defaultPrompt(stdin, stdout, question) {
  const readline = createInterface({ input: stdin, output: stdout });
  return readline.question(question).finally(() => readline.close());
}

function defaults(stdin, stdout) {
  return {
    readFile,
    parseChannelConfig,
    validateEnvironment,
    formatRedactedPreview,
    runDryRun,
    applyChangePlan,
    createClient: (environment) => new pg.Client({
      connectionString: environment.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }),
    prompt: (question) => defaultPrompt(stdin, stdout, question),
  };
}

export async function runCli({ argv, env, stdin, stdout, stderr, dependencies = {} }) {
  const deps = { ...defaults(stdin, stdout), ...dependencies };
  if (argv.length < 1 || argv.length > 2 || (argv[1] && argv[1] !== "--apply") || !argv[0].toLowerCase().endsWith(".json")) {
    stderr.write(USAGE);
    return 2;
  }
  const apply = argv[1] === "--apply";
  if (apply && !stdin.isTTY) {
    stderr.write("--apply requires an interactive terminal\n");
    return 2;
  }

  let config;
  let context;
  let client;
  try {
    config = deps.parseChannelConfig(JSON.parse(await deps.readFile(argv[0], "utf8")));
    context = deps.validateEnvironment(config, env);
    client = deps.createClient(env);
    await client.connect();
    const preview = await deps.runDryRun(client, config, context);
    stdout.write(`${deps.formatRedactedPreview(preview)}\n`);
    if (!apply) return 0;
    const answer = await deps.prompt(`Type project reference ${config.projectRef} to apply these changes: `);
    if (answer !== config.projectRef) {
      stderr.write("Confirmation rejected; no changes applied.\n");
      return 3;
    }
    await deps.applyChangePlan(client, config, context);
    stdout.write("Channel configuration applied atomically.\n");
    return 0;
  } catch (error) {
    stderr.write(`${sanitizeError(error, context?.sensitiveValues ?? [])}\n`);
    return 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
