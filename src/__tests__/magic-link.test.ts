import { describe, expect, it } from "vitest";
import { extractQueryParam, extractTokenFromUrl } from "../magic-link";

describe("URL parsing", () => {
  it("extractTokenFromUrl pulls `token` param", () => {
    expect(
      extractTokenFromUrl("myapp://auth?token=abc&foo=bar"),
    ).toBe("abc");
  });

  it("returns null when no query", () => {
    expect(extractTokenFromUrl("myapp://auth")).toBeNull();
  });

  it("returns null when key missing", () => {
    expect(extractQueryParam("myapp://auth?foo=bar", "token")).toBeNull();
  });

  it("decodes URI-encoded values", () => {
    expect(
      extractQueryParam("myapp://auth?email=user%40example.com", "email"),
    ).toBe("user@example.com");
  });

  it("strips fragments", () => {
    expect(
      extractQueryParam("myapp://auth?token=ok#fragment=ignored", "token"),
    ).toBe("ok");
  });
});
