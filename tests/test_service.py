"""Tests for the LabelerService."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from boxflow.core.service import LabelerService


class TestUpload:
    """Verify image upload flow."""

    def test_upload_creates_file(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        result = service.upload_image("photo.jpg", sample_image_bytes)
        assert "image_id" in result
        assert result["filename"] == "photo.jpg"
        assert result["width"] == 400
        assert result["height"] == 300

    def test_uploaded_file_exists_on_disk(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        result = service.upload_image("photo.jpg", sample_image_bytes)
        path = service.get_image_path(result["image_id"])
        assert path is not None
        assert path.exists()


class TestDetection:
    """Verify detection delegation."""

    def test_detect_returns_boxes(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("img.jpg", sample_image_bytes)
        result = service.detect(upload["image_id"])
        assert result["image_id"] == upload["image_id"]
        assert len(result["boxes"]) == 2

    def test_detect_missing_image_raises(self, service: LabelerService) -> None:
        with pytest.raises(FileNotFoundError):
            service.detect("no_such_image")


class TestSaveLabels:
    """Verify label saving with YOLO format, crops, and metadata."""

    def test_save_creates_label_file(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("test.jpg", sample_image_bytes)
        image_id = upload["image_id"]

        boxes = [
            {"bbox": (10.0, 20.0, 100.0, 120.0), "label": "cat"},
            {"bbox": (200.0, 50.0, 350.0, 200.0), "label": "dog"},
        ]
        result = service.save_labels(image_id, boxes)
        assert result["crops_count"] == 2
        assert result["label_file"].endswith(".txt")

    def test_save_writes_yolo_format(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("test.jpg", sample_image_bytes)
        image_id = upload["image_id"]

        boxes = [{"bbox": (10.0, 20.0, 100.0, 120.0), "label": "cat"}]
        service.save_labels(image_id, boxes)

        label_path = service.storage.labels_dir / f"{image_id}.txt"
        assert label_path.exists()
        lines = label_path.read_text().strip().splitlines()
        assert len(lines) == 1
        parts = lines[0].split()
        assert len(parts) == 5  # class_id cx cy w h

    def test_save_creates_metadata_json(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("test.jpg", sample_image_bytes)
        image_id = upload["image_id"]

        boxes = [{"bbox": (10.0, 20.0, 100.0, 120.0), "label": "cat"}]
        service.save_labels(image_id, boxes)

        meta_path = service.storage.meta_dir / f"{image_id}.json"
        assert meta_path.exists()
        meta = json.loads(meta_path.read_text())
        assert meta["image_id"] == image_id
        assert len(meta["boxes"]) == 1

    def test_save_creates_crop_files(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("test.jpg", sample_image_bytes)
        image_id = upload["image_id"]

        boxes = [{"bbox": (10.0, 20.0, 100.0, 120.0), "label": "cat"}]
        service.save_labels(image_id, boxes)

        cat_dir = service.storage.crops_dir / "cat"
        assert cat_dir.is_dir()
        crops = list(cat_dir.iterdir())
        assert len(crops) == 1


class TestCategories:
    """Verify category management."""

    def test_create_category(self, service: LabelerService) -> None:
        result = service.create_category("vehicle")
        assert result["name"] == "vehicle"
        assert result["created"] is True

    def test_create_duplicate_category(self, service: LabelerService) -> None:
        service.create_category("vehicle")
        result = service.create_category("vehicle")
        assert result["created"] is False

    def test_get_categories_empty(self, service: LabelerService) -> None:
        assert service.get_categories() == []

    def test_get_categories_after_save(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("test.jpg", sample_image_bytes)
        boxes = [{"bbox": (10.0, 20.0, 100.0, 120.0), "label": "animal"}]
        service.save_labels(upload["image_id"], boxes)

        cats = service.get_categories()
        assert len(cats) == 1
        assert cats[0]["name"] == "animal"


class TestQueue:
    """Verify the unlabeled image queue."""

    def test_queue_includes_unlabeled(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        service.upload_image("a.jpg", sample_image_bytes)
        service.upload_image("b.jpg", sample_image_bytes)
        queue = service.get_queue()
        assert len(queue) == 2

    def test_queue_excludes_labeled(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("a.jpg", sample_image_bytes)
        service.save_labels(
            upload["image_id"],
            [{"bbox": (0, 0, 50, 50), "label": "x"}],
        )
        queue = service.get_queue()
        assert len(queue) == 0


class TestStats:
    """Verify statistics aggregation."""

    def test_empty_stats(self, service: LabelerService) -> None:
        stats = service.get_stats()
        assert stats["total_images"] == 0
        assert stats["labeled_images"] == 0
        assert stats["total_labels"] == 0

    def test_stats_after_labeling(
        self, service: LabelerService, sample_image_bytes: bytes
    ) -> None:
        upload = service.upload_image("a.jpg", sample_image_bytes)
        service.save_labels(
            upload["image_id"],
            [
                {"bbox": (10, 20, 100, 120), "label": "cat"},
                {"bbox": (200, 50, 350, 200), "label": "dog"},
            ],
        )
        stats = service.get_stats()
        assert stats["total_images"] == 1
        assert stats["labeled_images"] == 1
        assert stats["total_labels"] == 2
