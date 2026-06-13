import { describe, expect, it } from "vitest";
import { AuthioError, AuthioErrorCode } from "../errors";

describe("AuthioError", () => {
  it("carries code/message/status/requestId", () => {
    const e = new AuthioError({
      code: AuthioErrorCode.NetworkError,
      message: "boom",
      status: 502,
      requestId: "req_123",
      details: { retryable: true },
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AuthioError");
    expect(e.code).toBe("network_error");
    expect(e.status).toBe(502);
    expect(e.requestId).toBe("req_123");
    expect((e.details as { retryable: boolean }).retryable).toBe(true);
  });

  it("serializes to JSON", () => {
    const e = new AuthioError({
      code: "x_y",
      message: "m",
      status: 400,
    });
    const j = e.toJSON();
    expect(j).toMatchObject({
      name: "AuthioError",
      code: "x_y",
      message: "m",
      status: 400,
    });
  });

  it("instanceof works after throw/catch (prototype preserved)", () => {
    try {
      throw new AuthioError({ code: "c", message: "m" });
    } catch (e) {
      expect(e).toBeInstanceOf(AuthioError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
