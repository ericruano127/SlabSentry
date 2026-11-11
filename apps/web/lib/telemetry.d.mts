/** Types for lib/telemetry.mjs (plain JS so it can be preloaded with `node --import`). */
export declare function redactText(s: string): string;
export declare function redactAttributes<T extends Record<string, unknown> | undefined>(attrs: T): T;
export declare class RedactingSpanProcessor {
  onStart(): void; onEnding(span: unknown): void; onEnd(): void; forceFlush(): Promise<void>; shutdown(): Promise<void>;
}
export declare class RedactingLogProcessor {
  onEmit(record: unknown): void; forceFlush(): Promise<void>; shutdown(): Promise<void>;
}
export declare function telemetryEnabled(): boolean;
export declare function startTelemetry(defaultServiceName: string): Promise<{ shutdown(): Promise<void> } | null>;
export declare function traceIds(): { trace_id?: string; span_id?: string };
export declare class ProbeFilterSampler { constructor(inner: unknown); shouldSample(...args: unknown[]): unknown; }
