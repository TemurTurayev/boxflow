"""Abstract base classes for detection and classification providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from PIL import Image


@dataclass(frozen=True)
class Detection:
    """Single detected object bounding box."""

    bbox: tuple[float, float, float, float]  # (x1, y1, x2, y2) in pixels
    confidence: float
    class_name: str


@dataclass(frozen=True)
class Classification:
    """Single classification result for a crop."""

    label: str
    confidence: float


@dataclass(frozen=True)
class ModelSpec:
    """Describes one available model variant."""

    name: str
    size_mb: float
    description: str = ""
    url: str = ""


@dataclass(frozen=True)
class ProviderInfo:
    """Metadata about a provider and its available models."""

    name: str
    description: str
    models: list[ModelSpec] = field(default_factory=list)


@dataclass(frozen=True)
class ModelDownloadStatus:
    """Progress of an ongoing model download."""

    model_name: str
    progress_pct: float
    total_mb: float
    status: str  # "downloading" | "complete" | "error"


class DetectionProvider(ABC):
    """Interface that all detection backends must implement."""

    @abstractmethod
    def detect(self, image_path: Path) -> list[Detection]:
        """Run detection on an image and return bounding boxes."""

    @abstractmethod
    def is_ready(self) -> bool:
        """Return True when the model is loaded and can serve requests."""

    @classmethod
    @abstractmethod
    def info(cls) -> ProviderInfo:
        """Return metadata about this provider and its models."""

    @staticmethod
    def get_image_size(path: Path) -> tuple[int, int]:
        """Return (width, height) of an image file."""
        from PIL import Image as PILImage

        with PILImage.open(path) as img:
            return img.size


class ClassifierProvider(ABC):
    """Interface that all classification backends must implement."""

    @abstractmethod
    def classify(
        self,
        crops: list[Image.Image],
        categories: list[str],
    ) -> list[Classification]:
        """Classify a list of image crops against the given category names."""

    @abstractmethod
    def is_ready(self) -> bool:
        """Return True when the model is loaded and can serve requests."""

    @classmethod
    @abstractmethod
    def info(cls) -> ProviderInfo:
        """Return metadata about this provider and its models."""
