"""Main labeling service — orchestrates detection, classification, and storage."""

from __future__ import annotations

import json
import logging
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from boxflow.config import Settings
from boxflow.core.storage import Storage
from boxflow.providers.base import ClassifierProvider, DetectionProvider

logger = logging.getLogger(__name__)

_SAFE_LABEL_RE = re.compile(r"^[\w\s.\-]+$", re.UNICODE)
_ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"}


class LabelerService:
    """Coordinates upload, detection, labeling, and export workflows."""

    def __init__(
        self,
        settings: Settings,
        detector: DetectionProvider,
        classifier: ClassifierProvider | None,
        storage: Storage,
    ) -> None:
        self._settings = settings
        self._detector = detector
        self._classifier = classifier
        self._storage = storage
        self._categories_lock = threading.Lock()
        self._storage.ensure_directories()

    @property
    def storage(self) -> Storage:
        return self._storage

    @property
    def detector(self) -> DetectionProvider:
        return self._detector

    @property
    def classifier(self) -> ClassifierProvider | None:
        return self._classifier

    def upload_image(self, filename: str, content: bytes) -> dict[str, Any]:
        """Save an uploaded image and return its metadata."""
        import io as _io

        image_id = uuid.uuid4().hex[:12]
        suffix = Path(filename).suffix.lower() or ".jpg"
        if suffix not in _ALLOWED_IMAGE_SUFFIXES:
            suffix = ".jpg"

        try:
            with Image.open(_io.BytesIO(content)) as img:
                img.verify()
            with Image.open(_io.BytesIO(content)) as img:
                width, height = img.size
        except Exception:
            raise ValueError("Uploaded file is not a valid image")

        dest = self._storage.uploads_dir / f"{image_id}{suffix}"
        dest.write_bytes(content)

        return {
            "image_id": image_id,
            "filename": filename,
            "width": width,
            "height": height,
        }

    def detect(self, image_id: str) -> dict[str, Any]:
        """Run detection on an uploaded image."""
        image_path = self._storage.resolve_image(image_id)
        if image_path is None:
            raise FileNotFoundError(f"Image not found: {image_id}")

        detections = self._detector.detect(image_path)
        width, height = DetectionProvider.get_image_size(image_path)

        boxes = [
            {
                "bbox": det.bbox,
                "confidence": round(det.confidence, 4),
                "class_name": det.class_name,
            }
            for det in detections
        ]
        return {
            "image_id": image_id,
            "width": width,
            "height": height,
            "boxes": boxes,
        }

    def get_image_path(self, image_id: str) -> Path | None:
        """Resolve an image ID to its file path."""
        return self._storage.resolve_image(image_id)

    def crop_box(self, image_id: str, bbox: tuple[float, ...]) -> Image.Image:
        """Crop a region from an uploaded image."""
        image_path = self._storage.resolve_image(image_id)
        if image_path is None:
            raise FileNotFoundError(f"Image not found: {image_id}")

        with Image.open(image_path) as img:
            x1, y1, x2, y2 = bbox
            return img.crop((int(x1), int(y1), int(x2), int(y2))).copy()

    def save_labels(
        self, image_id: str, boxes_with_labels: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Persist labels in YOLO format plus crops and metadata.

        Performs a best-effort rollback if any step fails.
        """
        image_path = self._storage.resolve_image(image_id)
        if image_path is None:
            raise FileNotFoundError(f"Image not found: {image_id}")

        created_files: list[Path] = []
        created_dirs: list[Path] = []

        try:
            result = self._write_labels(
                image_id, image_path, boxes_with_labels, created_files, created_dirs,
            )
        except Exception:
            self._rollback(created_files, created_dirs)
            raise
        return result

    def _write_labels(
        self,
        image_id: str,
        image_path: Path,
        boxes_with_labels: list[dict[str, Any]],
        created_files: list[Path],
        created_dirs: list[Path],
    ) -> dict[str, Any]:
        """Write label file, crops, and metadata. Tracks created artifacts."""
        with Image.open(image_path) as img:
            img_w, img_h = img.size

        # Build category -> id mapping from existing + new categories
        categories = self._build_category_map(boxes_with_labels)

        # Write YOLO label file
        label_path = self._write_yolo_label(
            image_id, boxes_with_labels, categories, img_w, img_h, created_files,
        )

        # Copy image to labeled/images/
        labeled_img = self._storage.images_dir / image_path.name
        if not labeled_img.exists():
            shutil.copy2(image_path, labeled_img)
            created_files.append(labeled_img)

        # Save crops
        crops_count = self._save_crops(
            image_id, image_path, boxes_with_labels, created_files, created_dirs,
        )

        # Write metadata JSON
        meta_path = self._write_metadata(
            image_id, image_path.name, boxes_with_labels, categories, created_files,
        )

        return {
            "label_file": str(label_path.name),
            "crops_count": crops_count,
            "meta_file": str(meta_path.name),
        }

    def _build_category_map(
        self, boxes_with_labels: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Create a stable category -> class_id mapping."""
        with self._categories_lock:
            existing = self._load_categories_json()
            all_labels = {box["label"] for box in boxes_with_labels}

            next_id = max(existing.values(), default=-1) + 1
            result = dict(existing)
            for label in sorted(all_labels):
                if label not in result:
                    result[label] = next_id
                    next_id += 1

            if result != existing:
                self._save_categories_json(result)
            return result

    def _load_categories_json(self) -> dict[str, int]:
        """Load the category mapping from disk."""
        path = self._storage.categories_file
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return {str(k): int(v) for k, v in data.items()}
        except (json.JSONDecodeError, ValueError):
            return {}

    def _save_categories_json(self, mapping: dict[str, int]) -> None:
        """Persist the category mapping to disk."""
        path = self._storage.categories_file
        path.write_text(
            json.dumps(mapping, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def _write_yolo_label(
        self,
        image_id: str,
        boxes: list[dict[str, Any]],
        categories: dict[str, int],
        img_w: int,
        img_h: int,
        created_files: list[Path],
    ) -> Path:
        """Write a YOLO-format label .txt file."""
        label_path = self._storage.labels_dir / f"{image_id}.txt"
        lines: list[str] = []
        for box in boxes:
            class_id = categories[box["label"]]
            x1, y1, x2, y2 = box["bbox"]
            cx = ((x1 + x2) / 2) / img_w
            cy = ((y1 + y2) / 2) / img_h
            bw = (x2 - x1) / img_w
            bh = (y2 - y1) / img_h
            lines = [*lines, f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"]

        label_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        created_files.append(label_path)
        return label_path

    @staticmethod
    def _validate_label_safe(label: str) -> None:
        """Defense-in-depth: reject labels that could escape the crops tree."""
        if not label or not _SAFE_LABEL_RE.match(label) or ".." in label:
            raise ValueError(f"Unsafe label rejected: {label!r}")

    def _save_crops(
        self,
        image_id: str,
        image_path: Path,
        boxes: list[dict[str, Any]],
        created_files: list[Path],
        created_dirs: list[Path],
    ) -> int:
        """Save cropped regions organised by category."""
        count = 0
        with Image.open(image_path) as img:
            for idx, box in enumerate(boxes):
                label = box["label"]
                self._validate_label_safe(label)
                x1, y1, x2, y2 = box["bbox"]
                crop = img.crop((int(x1), int(y1), int(x2), int(y2)))

                cat_dir = self._storage.crops_dir / label
                if not self._storage._is_within(cat_dir, self._storage.crops_dir):
                    raise ValueError(f"Category directory escapes data tree: {label!r}")
                if not cat_dir.exists():
                    cat_dir.mkdir(parents=True, exist_ok=True)
                    created_dirs.append(cat_dir)

                crop_path = cat_dir / f"{image_id}_{idx}.jpg"
                crop.save(crop_path, "JPEG", quality=95)
                created_files.append(crop_path)
                count += 1
        return count

    def _write_metadata(
        self,
        image_id: str,
        filename: str,
        boxes: list[dict[str, Any]],
        categories: dict[str, int],
        created_files: list[Path],
    ) -> Path:
        """Write a per-image JSON metadata file."""
        meta_path = self._storage.meta_dir / f"{image_id}.json"
        meta = {
            "image_id": image_id,
            "filename": filename,
            "labeled_at": datetime.now(timezone.utc).isoformat(),
            "categories_map": categories,
            "boxes": [
                {
                    "bbox": list(box["bbox"]),
                    "label": box["label"],
                    "class_id": categories[box["label"]],
                }
                for box in boxes
            ],
        }
        meta_path.write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        created_files.append(meta_path)
        return meta_path

    @staticmethod
    def _rollback(files: list[Path], dirs: list[Path]) -> None:
        """Best-effort cleanup of created artifacts."""
        for f in reversed(files):
            try:
                if f.exists():
                    f.unlink()
            except OSError:
                logger.warning("Rollback failed for file %s", f)
        for d in reversed(dirs):
            try:
                if d.exists() and not any(d.iterdir()):
                    d.rmdir()
            except OSError:
                logger.warning("Rollback failed for dir %s", d)

    def get_queue(self) -> list[dict[str, Any]]:
        """Return unlabeled images as a queue."""
        labeled_stems = {
            p.stem for p in self._storage.list_labeled()
        }
        queue: list[dict[str, Any]] = []
        for upload in self._storage.list_uploads():
            if upload.stem not in labeled_stems:
                queue = [
                    *queue,
                    {
                        "filename": upload.name,
                        "image_id": upload.stem,
                        "thumbnail_url": f"/api/images/{upload.stem}",
                    },
                ]
        return queue

    def classify_crops(
        self, image_id: str, boxes: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Classify cropped regions using the configured classifier."""
        if self._classifier is None:
            return {"suggestions": [], "status": "no_classifier"}

        categories = self.get_category_names()
        if not categories:
            return {"suggestions": [], "status": "no_categories"}

        crops: list[Image.Image] = []
        for box in boxes:
            crop = self.crop_box(image_id, tuple(box["bbox"]))
            crops = [*crops, crop]

        results = self._classifier.classify(crops, categories)

        suggestions = [
            {
                "bbox": tuple(box["bbox"]),
                "label": cls.label,
                "confidence": round(cls.confidence, 4),
            }
            for box, cls in zip(boxes, results)
        ]
        return {"suggestions": suggestions, "status": "ok"}

    def get_categories(self) -> list[dict[str, Any]]:
        """Return all known categories with their crop counts."""
        cat_map = self._load_categories_json()
        result: list[dict[str, Any]] = []
        for name in sorted(cat_map.keys()):
            cat_dir = self._storage.crops_dir / name
            count = len(list(cat_dir.iterdir())) if cat_dir.exists() else 0
            result = [
                *result,
                {"name": name, "count": count, "icon_url": ""},
            ]
        return result

    def get_category_names(self) -> list[str]:
        """Return a sorted list of category names."""
        return sorted(self._load_categories_json().keys())

    def create_category(self, name: str) -> dict[str, Any]:
        """Register a new category."""
        self._validate_label_safe(name)
        cat_dir = self._storage.crops_dir / name
        if not self._storage._is_within(cat_dir, self._storage.crops_dir):
            raise ValueError(f"Category name escapes data tree: {name!r}")

        with self._categories_lock:
            cat_map = self._load_categories_json()
            if name in cat_map:
                return {"name": name, "count": 0, "icon_url": "", "created": False}

            next_id = max(cat_map.values(), default=-1) + 1
            new_map = {**cat_map, name: next_id}
            self._save_categories_json(new_map)

        cat_dir.mkdir(parents=True, exist_ok=True)

        return {"name": name, "count": 0, "icon_url": "", "created": True}

    def delete_category(self, name: str) -> bool:
        self._validate_label_safe(name)
        with self._categories_lock:
            cat_map = self._load_categories_json()
            if name not in cat_map:
                return False
            new_map = {k: v for k, v in cat_map.items() if k != name}
            self._save_categories_json(new_map)
        return True

    def get_history(self) -> list[dict[str, Any]]:
        """Return labeled images with summary info."""
        history: list[dict[str, Any]] = []
        for meta_file in sorted(self._storage.meta_dir.iterdir(), reverse=True):
            if meta_file.suffix != ".json":
                continue
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue

            boxes = meta.get("boxes", [])
            category_summary: dict[str, int] = {}
            for box in boxes:
                label = box.get("label", "unknown")
                category_summary[label] = category_summary.get(label, 0) + 1

            history = [
                *history,
                {
                    "image_id": meta.get("image_id", meta_file.stem),
                    "source_file": meta.get("filename", ""),
                    "filename": meta.get("filename", ""),
                    "boxes_count": len(boxes),
                    "labels_count": len(boxes),
                    "categories": sorted(category_summary.keys()),
                    "category_summary": category_summary,
                    "labeled_at": meta.get("labeled_at", ""),
                },
            ]
        return history

    def get_stats(self) -> dict[str, Any]:
        """Return overall labeling statistics."""
        total_images = len(self._storage.list_uploads())
        labeled = self._storage.list_labeled()
        labeled_count = len(labeled)

        total_labels = 0
        for lf in labeled:
            try:
                lines = lf.read_text(encoding="utf-8").strip().splitlines()
                total_labels += len(lines)
            except OSError:
                continue

        categories = self.get_categories()

        total_crops = sum(c["count"] for c in categories)

        crops_per_category = {c["name"]: c["count"] for c in categories}

        ref_dir = self._storage.reference_dir
        total_refs = 0
        refs_per_category: dict[str, int] = {}
        if ref_dir.exists():
            for d in ref_dir.iterdir():
                if d.is_dir():
                    count = len([f for f in d.iterdir() if f.is_file()])
                    refs_per_category[d.name] = count
                    total_refs += count

        detection: dict[str, Any] = {}
        try:
            det_info = self._detector.info()
            detection = {
                "weight_file": self._settings.detection_model,
                "input_size": self._settings.detection_imgsz,
                "classes": len(det_info.models) if det_info.models else 0,
            }
        except Exception:
            detection = {"weight_file": self._settings.detection_model}

        classification = {
            "ready": self._classifier is not None,
            "model": self._settings.classifier_model if self._classifier else "none",
        }

        return {
            "total_images": total_images,
            "labeled_images": labeled_count,
            "total_labels": total_labels,
            "total_crops": total_crops,
            "total_refs": total_refs,
            "categories": categories,
            "crops_per_category": crops_per_category,
            "refs_per_category": refs_per_category,
            "detection": detection,
            "classification": classification,
        }
