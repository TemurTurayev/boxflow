"""Tests for the export functionality."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest
from PIL import Image

from boxflow.core.exporters import (
    COCOExporter,
    CSVExporter,
    VOCExporter,
    YOLOExporter,
)


@pytest.fixture()
def labeled_data(tmp_path: Path) -> dict[str, Path]:
    """Create a minimal labeled dataset and return directory paths."""
    meta_dir = tmp_path / "meta"
    labels_dir = tmp_path / "labels"
    images_dir = tmp_path / "images"
    output_dir = tmp_path / "output"

    meta_dir.mkdir()
    labels_dir.mkdir()
    images_dir.mkdir()

    # Create a test image
    img = Image.new("RGB", (640, 480), color=(100, 150, 200))
    img.save(images_dir / "img001.jpg", "JPEG")

    # Create YOLO label
    labels_dir.joinpath("img001.txt").write_text(
        "0 0.250000 0.300000 0.200000 0.400000\n"
        "1 0.700000 0.500000 0.150000 0.250000\n"
    )

    # Create metadata
    meta = {
        "image_id": "img001",
        "filename": "img001.jpg",
        "labeled_at": "2024-01-15T12:00:00+00:00",
        "categories_map": {"cat": 0, "dog": 1},
        "boxes": [
            {"bbox": [96, 48, 224, 240], "label": "cat", "class_id": 0},
            {"bbox": [400, 180, 496, 300], "label": "dog", "class_id": 1},
        ],
    }
    meta_dir.joinpath("img001.json").write_text(json.dumps(meta))

    return {
        "meta_dir": meta_dir,
        "labels_dir": labels_dir,
        "images_dir": images_dir,
        "output_dir": output_dir,
    }


class TestYOLOExporter:
    def test_export_creates_classes_txt(self, labeled_data: dict[str, Path]) -> None:
        output = labeled_data["output_dir"] / "yolo"
        result = YOLOExporter.export(
            meta_dir=labeled_data["meta_dir"],
            labels_dir=labeled_data["labels_dir"],
            images_dir=labeled_data["images_dir"],
            output_path=output,
        )
        assert result["format"] == "yolo"
        assert result["images_count"] == 1
        classes_file = output / "classes.txt"
        assert classes_file.exists()
        classes = classes_file.read_text().strip().splitlines()
        assert "cat" in classes
        assert "dog" in classes

    def test_export_copies_labels_and_images(
        self, labeled_data: dict[str, Path]
    ) -> None:
        output = labeled_data["output_dir"] / "yolo"
        YOLOExporter.export(
            meta_dir=labeled_data["meta_dir"],
            labels_dir=labeled_data["labels_dir"],
            images_dir=labeled_data["images_dir"],
            output_path=output,
        )
        assert (output / "images" / "img001.jpg").exists()
        assert (output / "labels" / "img001.txt").exists()


class TestCOCOExporter:
    def test_export_creates_annotations_json(
        self, labeled_data: dict[str, Path]
    ) -> None:
        output = labeled_data["output_dir"] / "coco"
        result = COCOExporter.export(
            meta_dir=labeled_data["meta_dir"],
            images_dir=labeled_data["images_dir"],
            output_path=output,
        )
        assert result["format"] == "coco"
        ann_file = output / "annotations.json"
        assert ann_file.exists()
        data = json.loads(ann_file.read_text())
        assert len(data["images"]) == 1
        assert len(data["annotations"]) == 2
        assert len(data["categories"]) == 2

    def test_coco_bbox_is_xywh(self, labeled_data: dict[str, Path]) -> None:
        output = labeled_data["output_dir"] / "coco"
        COCOExporter.export(
            meta_dir=labeled_data["meta_dir"],
            images_dir=labeled_data["images_dir"],
            output_path=output,
        )
        data = json.loads((output / "annotations.json").read_text())
        ann = data["annotations"][0]
        bbox = ann["bbox"]
        # COCO format: [x, y, width, height]
        assert len(bbox) == 4
        assert bbox[2] > 0  # width > 0
        assert bbox[3] > 0  # height > 0


class TestVOCExporter:
    def test_export_creates_xml_files(
        self, labeled_data: dict[str, Path]
    ) -> None:
        output = labeled_data["output_dir"] / "voc"
        result = VOCExporter.export(
            meta_dir=labeled_data["meta_dir"],
            images_dir=labeled_data["images_dir"],
            output_path=output,
        )
        assert result["format"] == "voc"
        assert result["images_count"] == 1
        assert (output / "img001.xml").exists()


class TestCSVExporter:
    def test_export_creates_csv(self, labeled_data: dict[str, Path]) -> None:
        output = labeled_data["output_dir"] / "csv"
        result = CSVExporter.export(
            meta_dir=labeled_data["meta_dir"],
            output_path=output,
        )
        assert result["format"] == "csv"
        csv_file = output / "labels.csv"
        assert csv_file.exists()

    def test_csv_has_correct_rows(self, labeled_data: dict[str, Path]) -> None:
        output = labeled_data["output_dir"] / "csv"
        CSVExporter.export(
            meta_dir=labeled_data["meta_dir"],
            output_path=output,
        )
        csv_file = output / "labels.csv"
        with csv_file.open(newline="") as fh:
            reader = csv.reader(fh)
            rows = list(reader)
        # Header + 2 data rows
        assert len(rows) == 3
        assert rows[0] == ["image", "x1", "y1", "x2", "y2", "label"]
