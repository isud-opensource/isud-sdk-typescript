/** 测试基础设施：构造 mock fetch，记录请求。 */

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export function makeFetch(
  responder: (url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> } | Promise<{ status: number; body: unknown; headers?: Record<string, string> }>
): { fetch: typeof globalThis.fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const r = await responder(url, init ?? {});
    const headers = new Headers({ "Content-Type": "application/json", ...(r.headers ?? {}) });
    return new Response(
      typeof r.body === "string" ? r.body : JSON.stringify(r.body),
      { status: r.status, headers }
    );
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export const env = (data: unknown, extra: Record<string, unknown> = {}) => ({
  code: "0000", msg: "成功", data, ...extra,
});
