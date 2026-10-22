// Test-only preload for child processes: any fetch throws, so even a broken guard could not reach Meta from a test.
globalThis.fetch = () => {
  throw new Error("network blocked in tests");
};
