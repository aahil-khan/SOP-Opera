import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveWsUrl } from "./wsUrl";

describe("resolveWsUrl", () => {
  it("derives wss from an https API base with no override", () => {
    assert.equal(
      resolveWsUrl("https://sop-opera-api.aahil-khan.xyz"),
      "wss://sop-opera-api.aahil-khan.xyz/ws",
    );
  });

  it("derives ws from the local http API base", () => {
    assert.equal(
      resolveWsUrl("http://127.0.0.1:8000"),
      "ws://127.0.0.1:8000/ws",
    );
  });

  it("repairs the override that shipped to production", () => {
    // The deployed build set NEXT_PUBLIC_WS_URL to the API base verbatim, so
    // the handshake hit the domain root and was refused with 403.
    assert.equal(
      resolveWsUrl(
        "https://sop-opera-api.aahil-khan.xyz",
        "https://sop-opera-api.aahil-khan.xyz",
      ),
      "wss://sop-opera-api.aahil-khan.xyz/ws",
    );
  });

  it("passes a correct override through unchanged", () => {
    assert.equal(
      resolveWsUrl(
        "https://sop-opera-api.aahil-khan.xyz",
        "wss://sop-opera-api.aahil-khan.xyz/ws",
      ),
      "wss://sop-opera-api.aahil-khan.xyz/ws",
    );
  });

  it("keeps an explicit non-root path", () => {
    assert.equal(
      resolveWsUrl("https://example.test", "wss://example.test/api/socket"),
      "wss://example.test/api/socket",
    );
  });

  it("preserves a non-default port", () => {
    assert.equal(
      resolveWsUrl("http://192.168.1.10:8000"),
      "ws://192.168.1.10:8000/ws",
    );
  });

  it("ignores a blank override", () => {
    assert.equal(
      resolveWsUrl("https://example.test", "   "),
      "wss://example.test/ws",
    );
    assert.equal(
      resolveWsUrl("https://example.test", null),
      "wss://example.test/ws",
    );
  });

  it("falls back to the API base when the override is malformed", () => {
    assert.equal(
      resolveWsUrl("https://example.test", "not a url"),
      "wss://example.test/ws",
    );
  });

  it("falls back to localhost when both inputs are unusable", () => {
    assert.equal(resolveWsUrl("", "also not a url"), "ws://127.0.0.1:8000/ws");
  });

  it("rejects a non-http scheme rather than handing it to WebSocket", () => {
    assert.equal(
      resolveWsUrl("https://example.test", "ftp://example.test/ws"),
      "ws://127.0.0.1:8000/ws",
    );
  });
});
