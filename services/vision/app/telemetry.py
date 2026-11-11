"""OpenTelemetry for the image-analysis service (traces + metrics over OTLP, e.g. Grafana Cloud).

Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Endpoint/auth/resource come from the standard
OTEL_* variables (OTEL_EXPORTER_OTLP_HEADERS is a secret). Incoming requests continue the caller's
trace (the web app's fetch instrumentation sends `traceparent`), so one analysis is one trace across
both services. Request bodies (photos) are never recorded; paths carry no personal data.
"""
from __future__ import annotations
import os
from contextlib import contextmanager

_tracer = None


def enabled() -> bool:
    return bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")) and os.environ.get("OTEL_SDK_DISABLED", "").lower() != "true"


def setup(app) -> None:
    global _tracer
    if not enabled():
        return
    from opentelemetry import metrics, trace
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    attrs = {"service.name": os.environ.get("OTEL_SERVICE_NAME", "slabsentry-vision")}
    if os.environ.get("FLY_MACHINE_ID"):
        attrs["service.instance.id"] = os.environ["FLY_MACHINE_ID"]  # one series per Machine
    resource = Resource.create(attrs)  # merges OTEL_RESOURCE_ATTRIBUTES (e.g. service.namespace=staging)
    tp = TracerProvider(resource=resource)
    tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tp)
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())]))
    _tracer = trace.get_tracer("slabsentry.vision")
    # Health probes excluded; receive/send sub-spans add noise without information.
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health", exclude_spans=["receive", "send"])


@contextmanager
def span(name: str, **attributes):
    """Child span for a unit of analysis work (no-op when telemetry is off)."""
    if _tracer is None:
        yield None
        return
    with _tracer.start_as_current_span(name, attributes=attributes) as s:
        yield s
