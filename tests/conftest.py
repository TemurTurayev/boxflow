"""Shared test fixtures for the BoxFlow test suite."""

from __future__ import annotations

from pathlib import Path
from typing import Generator

import pytest
from PIL import Image

from boxflow.config import Settings
from boxflow.core.service import LabelerService
from boxflow.core.storage import Storage


class StubDetector:
    """Deterministic detector that returns a fixed set of boxes."""

    def __init__(self, boxes: list | None = None) -> None:
        self._boxes = boxes or []

    def detect(self, image_path: Path) -> list:
        from boxflow.providers.base import Detection

        return [
            Detection(
                bbox=(10.0, 20.0, 100.0, 120.0),
                confidence=0.95,
                class_name="object",
            ),
            Detection(
                bbox=(200.0, 50.0, 350.0, 200.0),
                confidence=0.80,
                class_name="object",
            ),
        ]

    def is_ready(self) -> bool:
        return True

    @classmethod
    def info(cls):
        from boxflow.providers.base import ProviderInfo

        return ProviderInfo(name="stub", description="Test stub", models=[])

    @staticmethod
    def get_image_size(path: Path) -> tuple[int, int]:
        with Image.open(path) as img:
            return img.size


@pytest.fixture()
def data_dir(tmp_path: Path) -> Path:
    """Return a temporary data directory."""
    d = tmp_path / "data"
    d.mkdir()
    return d


@pytest.fixture()
def storage(data_dir: Path) -> Storage:
    """Return a Storage instance backed by a temp directory."""
    s = Storage(data_dir)
    s.ensure_directories()
    return s


@pytest.fixture()
def settings(data_dir: Path) -> Settings:
    """Return a Settings instance pointing at the temp data directory."""
    return Settings(data_dir=str(data_dir))


@pytest.fixture()
def detector() -> StubDetector:
    """Return a deterministic stub detector."""
    return StubDetector()


@pytest.fixture()
def service(settings: Settings, detector: StubDetector, storage: Storage) -> LabelerService:
    """Return a LabelerService wired to stubs and temp storage."""
    return LabelerService(
        settings=settings,
        detector=detector,
        classifier=None,
        storage=storage,
    )


@pytest.fixture()
def sample_image_bytes() -> bytes:
    """Return a minimal JPEG image as bytes."""
    import io

    img = Image.new("RGB", (400, 300), color=(128, 128, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()
