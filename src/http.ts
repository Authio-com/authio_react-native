// Tiny fetch wrapper. Centralises:
//  - Authorization header injection (Bearer access token + project pk)
//  - JSON encode/decode
//  - Error normalisation into AuthioError (with code/status/requestId)
//
// Kept dependency-free so tests can mock global fetch trivially.

import { AuthioError, AuthioErrorCode } from "./errors";

const USER_AGENT = "authio-react-native/0.2.0";

export interface HTTPClientOptions {
  baseURL: string;
  publishableKey: string;
  fetchImpl?: typeof fetch;
}

export interface SendOptions<B> {
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  path: string;
  body?: B;
  bearer?: string | null;
  /** Extra headers (merged on top of defaults). */
  headers?: Record<string, string>;
  /** Query string parameters appended to the URL. */
  query?: Record<string, string | undefined>;
  /** If set, send Accept: application/json on the request. Defaults true. */
  acceptJSON?: boolean;
}

export class HTTPClient {
  readonly baseURL: string;
  readonly publishableKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HTTPClientOptions) {
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.publishableKey = opts.publishableKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  buildURL(path: string, query?: SendOptions<unknown>["query"]): string {
    const url = `${this.baseURL}${path.startsWith("/") ? path : `/${path}`}`;
    if (!query) return url;
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return qs ? `${url}?${qs}` : url;
  }

  async send<R, B = unknown>(opts: SendOptions<B>): Promise<R> {
    const url = this.buildURL(opts.path, opts.query);
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      "x-authio-publishable-key": this.publishableKey,
      ...(opts.acceptJSON !== false ? { accept: "application/json" } : {}),
      ...opts.headers,
    };
    let body: string | undefined;
    if (opts.body !== undefined && opts.body !== null) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body);
    }
    if (opts.bearer) {
      headers["authorization"] = `Bearer ${opts.bearer}`;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: opts.method,
        headers,
        body,
      });
    } catch (e) {
      throw new AuthioError({
        code: AuthioErrorCode.NetworkError,
        message: `fetch ${opts.method} ${url} failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }

    const requestId =
      res.headers.get("x-request-id") ??
      res.headers.get("x-authio-request-id") ??
      undefined;

    // Read body once. Some endpoints (204) return nothing.
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* empty body */
    }

    if (!res.ok) {
      let code = AuthioErrorCode.ServerError as string;
      let message = `HTTP ${res.status} ${res.statusText}`;
      let details: unknown;
      if (text) {
        try {
          const parsed = JSON.parse(text) as {
            error?: { code?: string; message?: string };
            code?: string;
            message?: string;
          };
          code = parsed.error?.code ?? parsed.code ?? code;
          message = parsed.error?.message ?? parsed.message ?? message;
          details = parsed;
        } catch {
          details = text;
        }
      }
      throw new AuthioError({
        code,
        message,
        status: res.status,
        requestId,
        details,
      });
    }

    if (!text) {
      // 204 No Content — return whatever the caller wanted as undefined.
      return undefined as unknown as R;
    }
    try {
      return JSON.parse(text) as R;
    } catch (e) {
      throw new AuthioError({
        code: AuthioErrorCode.ServerError,
        message: `invalid JSON in response: ${
          e instanceof Error ? e.message : String(e)
        }`,
        status: res.status,
        requestId,
      });
    }
  }
}
