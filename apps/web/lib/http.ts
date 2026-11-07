import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message, ...e.extra }, e.status);
      if (e instanceof ZodError) return json({ error: "invalid_request", issues: e.issues }, 400);
      console.error(e);
      return json({ error: "server_error", message: "Something went wrong. No verification credit was used." }, 500);
    }
  };
}
