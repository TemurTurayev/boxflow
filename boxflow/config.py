"""Application settings driven by environment variables."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """BoxFlow configuration.

    Every field can be overridden via an environment variable with the
    ``BOXFLOW_`` prefix, e.g. ``BOXFLOW_PORT=9000``.
    """

    model_config = {"env_prefix": "BOXFLOW_", "frozen": True}

    host: str = "0.0.0.0"
    port: int = 8001
    data_dir: str = "./data"

    detection_provider: str = "yolo"
    detection_model: str = "yolov8n.pt"
    detection_confidence: float = 0.25
    detection_imgsz: int = 640

    classifier_provider: str = "none"
    classifier_model: str = "ViT-B-32"

    export_format: str = "yolo"

    cors_origins: list[str] = ["http://localhost:8001", "http://127.0.0.1:8001"]
    max_upload_size_mb: int = 50

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).resolve()

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024
