import { queryScope } from "./db";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log, reportError } from "./log";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    const req = a[0] instanceof Request ? a[0] : null;
    const requestId = req?.headers.get("x-request-id") ?? crypto.randomUUID();
    const started = Date.now();
    const route = req ? new URL(req.url).pathname.replace(/[0-9a-f-]{36}/g, ":id") : "?";
    let res: Response;
    const scope = { n: 0 };
    try {
      res = await queryScope.run(scope, () => fn(...a));
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.code, message: e.message, ...e.extra }, e.status);
      else if (e instanceof ZodError) res = json({ error: "invalid_request", issues: e.issues }, 400);
      else {
        reportError(e, { route, requestId });
        res = json({ error: "server_error", message: "Something went wrong. No verification credit was used.", requestId }, 500);
      }
    }
    res.headers.set("x-request-id", requestId);
    httpStats.record(route, res.status, Date.now() - started, scope.n);
    if (process.env.NODE_ENV !== "production" || process.env.EXPOSE_QUERY_COUNT === "1") res.headers.set("x-db-queries", String(scope.n));
    if (res.status >= 500 || Date.now() - started > 2000) log(res.status >= 500 ? "error" : "warn", "slow or failed request", { route, status: res.status, ms: Date.now() - started, dbQueries: scope.n, requestId });
    return res;
  };
}

/** In-process request counters for /api/metrics (per instance; aggregated by Prometheus). */
export const httpStats = {
  byStatus: new Map<string, number>(),
  latency: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5].map((le) => ({ le, n: 0 })),
  count: 0,
  sum: 0,
  dbQueries: 0,
  record(route: string, status: number, ms: number, queries = 0) {
    this.dbQueries += queries;
    const k = `${Math.floor(status / 100)}xx`;
    this.byStatus.set(k, (this.byStatus.get(k) ?? 0) + 1);
    this.count++;
    this.sum += ms / 1000;
    for (const b of this.latency) if (ms / 1000 <= b.le) b.n++;
  },
};
