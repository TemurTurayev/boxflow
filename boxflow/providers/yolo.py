"""YOLO-based object detection provider."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from boxflow.providers.base import (
    Detection,
    DetectionProvider,
    ModelSpec,
    ProviderInfo,
)

logger = logging.getLogger(__name__)

_YOLO_MODELS: list[ModelSpec] = [
    ModelSpec(name="yolov8n.pt", size_mb=6, description="YOLOv8 Nano — fastest"),
    ModelSpec(name="yolov8s.pt", size_mb=22, description="YOLOv8 Small"),
    ModelSpec(name="yolov8m.pt", size_mb=50, description="YOLOv8 Medium"),
    ModelSpec(name="yolov8l.pt", size_mb=87, description="YOLOv8 Large"),
    ModelSpec(name="yolov8x.pt", size_mb=130, description="YOLOv8 Extra-Large — most accurate"),
    ModelSpec(name="yolo11n.pt", size_mb=5, description="YOLO11 Nano — fastest"),
    ModelSpec(name="yolo11s.pt", size_mb=18, description="YOLO11 Small"),
    ModelSpec(name="yolo11m.pt", size_mb=39, description="YOLO11 Medium"),
    ModelSpec(name="yolo11l.pt", size_mb=73, description="YOLO11 Large"),
    ModelSpec(name="yolo11x.pt", size_mb=110, description="YOLO11 Extra-Large — most accurate"),
]


def _ensure_ultralytics() -> Any:
    """Import ultralytics or raise a helpful error."""
    try:
        import ultralytics  # noqa: F811
        return ultralytics
    except ImportError as exc:
        raise ImportError(
            "ultralytics is required for YOLO detection. "
            "Install with: pip install boxflow[yolo]"
        ) from exc


class YOLOProvider(DetectionProvider):
    """Detection via Ultralytics YOLO models."""

    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        confidence: float = 0.25,
        imgsz: int = 640,
        iou: float = 0.45,
        **_kwargs: Any,
    ) -> None:
        self._model_path = model_path
        self._confidence = confidence
        self._imgsz = imgsz
        self._iou = iou
        self._model: Any = None

    def _load_model(self) -> Any:
        """Lazy-load the YOLO model on first use."""
        if self._model is not None:
            return self._model
        ultralytics = _ensure_ultralytics()
        self._model = ultralytics.YOLO(self._model_path)
        return self._model

    def detect(self, image_path: Path) -> list[Detection]:
        """Run YOLO inference and return detections."""
        model = self._load_model()
        results = model(
            str(image_path),
            conf=self._confidence,
            imgsz=self._imgsz,
            iou=self._iou,
            verbose=False,
        )
        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].tolist()
                conf = float(boxes.conf[i])
                cls_id = int(boxes.cls[i])
                class_name = result.names.get(cls_id, str(cls_id))
                detections = [
                    *detections,
                    Detection(
                        bbox=(xyxy[0], xyxy[1], xyxy[2], xyxy[3]),
                        confidence=conf,
                        class_name=class_name,
                    ),
                ]
        return detections

    def is_ready(self) -> bool:
        """Check if the model can be loaded."""
        try:
            self._load_model()
            return True
        except Exception:
            return False

    @classmethod
    def info(cls) -> ProviderInfo:
        return ProviderInfo(
            name="yolo",
            description="Ultralytics YOLO object detection",
            models=list(_YOLO_MODELS),
        )

    @staticmethod
    def get_image_size(path: Path) -> tuple[int, int]:
        """Return (width, height) of an image file."""
        from PIL import Image

        with Image.open(path) as img:
            return img.size
