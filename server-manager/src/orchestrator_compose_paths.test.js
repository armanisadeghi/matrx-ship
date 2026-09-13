import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("hosted orchestrator compose commands resolve bind sources on the host", () => {
  assert.match(source, /const ORCH_HOST_COMPOSE_DIR = "\/srv\/apps\/sandbox-orchestrator"/);
  assert.match(
    source,
    /docker compose --project-directory \$\{ORCH_HOST_COMPOSE_DIR\} \$\{files\.join\(" "\)\}/,
  );

  const unsafeRecreates = source.match(
    /exec\("docker compose up -d --force-recreate", \{ cwd: ORCH_COMPOSE_DIR/g,
  ) || [];
  assert.equal(unsafeRecreates.length, 0);
});

test("every hosted orchestrator build stamps the exact source SHA", () => {
  assert.match(source, /git -C \$\{SANDBOX_PROJECT\} rev-parse HEAD/);
  assert.match(source, /docker build --build-arg MATRX_SOURCE_SHA=\$\{sourceSha\}/);
  assert.match(source, /"--build-arg", `MATRX_SOURCE_SHA=\$\{sourceSha\}`/);

  const unstampedOneShotBuilds = source.match(
    /docker build -t \$\{ORCH_IMAGE_TAG\} \$\{context\}/g,
  ) || [];
  assert.equal(unstampedOneShotBuilds.length, 0);
});
