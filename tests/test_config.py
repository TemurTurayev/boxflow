"""Tests for the Settings configuration."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from boxflow.config import Settings


class TestSettings:
    def test_defaults(self) -> None:
        settings = Settings()
        assert settings.host == "0.0.0.0"
        assert settings.port == 8001
        assert settings.detection_provider == "yolo"
        assert settings.detection_model == "yolov8n.pt"
        assert settings.detection_confidence == 0.25
        assert settings.classifier_provider == "none"
        assert settings.export_format == "yolo"

    def test_data_path_property(self, tmp_path: Path) -> None:
        test_dir = str(tmp_path / "test-data")
        settings = Settings(data_dir=test_dir)
        assert settings.data_path == Path(test_dir).resolve()
        assert settings.data_path.is_absolute()

    def test_max_upload_bytes(self) -> None:
        settings = Settings(max_upload_size_mb=10)
        assert settings.max_upload_bytes == 10 * 1024 * 1024

    def test_env_override(self) -> None:
        with patch.dict("os.environ", {"BOXFLOW_PORT": "9999"}):
            settings = Settings()
            assert settings.port == 9999

    def test_frozen(self) -> None:
        settings = Settings()
        try:
            settings.port = 1234  # type: ignore[misc]
            raised = False
        except Exception:
            raised = True
        assert raised, "Settings should be frozen (immutable)"
