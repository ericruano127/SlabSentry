"""Single source of truth for vision tool versions (bump when a tool's behaviour changes).
Reported by /health and recorded in every release and report."""
TOOL_VERSIONS = {
    "quality": "vision/quality@0.2.0",       # + motion blur, label sharpness (Phase D)
    "compare": "vision/compare@0.2.0",
    "holder": "vision/holder@0.1.0",
    "forensics": "vision/forensics@0.1.1",   # copy-move tolerance/min-size tuning (Phase C)
    "template": "vision/template@0.1.1",     # colour thresholds (Phase C)
    "uv": "vision/uv@0.1.0",
    "microprint": "vision/microprint@0.1.1", # power-spectrum resolvability (Phase C)
    "video": "vision/video@0.1.0",
    "seam": "vision/seam@0.1.0",
}
