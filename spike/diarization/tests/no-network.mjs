// Test-only preload: any WebSocket to a non-loopback host throws, so no test (even with a broken guard) can reach Meta.
const Real = globalThis.WebSocket;
globalThis.WebSocket = class extends Real {
  constructor(url, ...rest) {
    const host = new URL(url).hostname;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
      throw new Error(`network blocked in tests: ${host}`);
    super(url, ...rest);
  }
};
