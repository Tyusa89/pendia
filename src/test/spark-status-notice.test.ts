// @vitest-environment node
// What the dev page tells each kind of user when the tool is not enabled. Uses the REAL server status function.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPARK_NOT_ENABLED, sparkDisabledNotice } from "@/lib/spark/spark-status-notice";
import { sparkStatus, type SparkEnv } from "@/server/spark-synthetic.server";

const LISTED = "11111111-1111-4111-8111-111111111111";
const OUTSIDER = "22222222-2222-4222-8222-222222222222";
const KEY = "sk-test-NEVER-SHOWN-123";
const ON: SparkEnv = { SPARK_LIVE_ENABLED: "true", SPARK_LIVE_USER_IDS: LISTED, META_API_KEY: KEY };

describe("the not-enabled notice", () => {
  it("says nothing when the tool is enabled", () => {
    expect(sparkDisabledNotice(sparkStatus(ON, LISTED))).toBeNull();
  });
  it("tells a listed user the flag is off, or that the key is missing", () => {
    expect(sparkDisabledNotice(sparkStatus({ ...ON, SPARK_LIVE_ENABLED: "TRUE" }, LISTED))).toMatch(
      /feature flag is not set/,
    );
    expect(sparkDisabledNotice(sparkStatus({ ...ON, META_API_KEY: "" }, LISTED))).toMatch(
      /no Meta API key/,
    );
  });
  it("gives a user outside the allow-list only the generic line, in every configuration", () => {
    const configs: SparkEnv[] = [
      ON,
      {},
      { ...ON, SPARK_LIVE_ENABLED: "false" },
      { ...ON, META_API_KEY: "" },
      { ...ON, SPARK_LIVE_USER_IDS: "" },
      { ...ON, SPARK_LIVE_USER_IDS: "someone-else" },
    ];
    for (const env of configs) {
      const notice = sparkDisabledNotice(sparkStatus(env, OUTSIDER));
      expect(notice).toBe(SPARK_NOT_ENABLED);
    }
  });
  it("never contains an id, the key or a variable name", () => {
    const all = [
      sparkDisabledNotice(sparkStatus({ ...ON, SPARK_LIVE_ENABLED: "x" }, LISTED)),
      sparkDisabledNotice(sparkStatus({ ...ON, META_API_KEY: "" }, LISTED)),
      sparkDisabledNotice(sparkStatus(ON, OUTSIDER)),
    ].join("\n");
    for (const bad of [LISTED, OUTSIDER, KEY, "SPARK_LIVE", "META_API_KEY", "allow-list"])
      expect(all).not.toContain(bad);
  });
  it("ignores unknown reasons rather than echoing them", () => {
    expect(sparkDisabledNotice({ enabled: false, reason: "not_allowlisted" })).toBe(
      SPARK_NOT_ENABLED,
    );
    expect(sparkDisabledNotice({ enabled: false, reason: `leak ${KEY}` })).toBe(SPARK_NOT_ENABLED);
  });
});

describe("the page", () => {
  const page = readFileSync(join(process.cwd(), "src/routes/_authenticated/dev-spark.tsx"), "utf8");
  it("renders the notice from the server's status, and still shows the run button only when enabled", () => {
    expect(page).toMatch(/sparkDisabledNotice\(status\.data\)/);
    expect(page).toMatch(/status\.data\?\.enabled/);
  });
  it("does not read the user id or any allow-list information", () => {
    expect(page).not.toMatch(/yourUserId|SPARK_LIVE_USER_IDS|allowlist/i);
  });
});
