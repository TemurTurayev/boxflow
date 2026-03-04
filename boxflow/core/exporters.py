"""Export labeled data in YOLO, COCO, Pascal VOC, and CSV formats."""

from __future__ import annotations

import csv
import json
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)


def _load_all_metadata(meta_dir: Path) -> list[dict[str, Any]]:
    """Read all JSON metadata files from a directory."""
    results: list[dict[str, Any]] = []
    if not meta_dir.exists():
        return results
    for f in sorted(meta_dir.iterdir()):
        if f.suffix != ".json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            results = [*results, data]
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Skipping invalid metadata %s: %s", f.name, exc)
    return results


def _build_class_list(records: list[dict[str, Any]]) -> list[str]:
    """Extract a sorted, deduplicated list of class names."""
    names: set[str] = set()
    for rec in records:
        for box in rec.get("boxes", []):
            names.add(box.get("label", "unknown"))
    return sorted(names)


class YOLOExporter:
    """Export to YOLO txt format (already saved, just bundles them)."""

    @staticmethod
    def export(
        meta_dir: Path,
        labels_dir: Path,
        images_dir: Path,
        output_path: Path,
    ) -> dict[str, Any]:
        """Create a YOLO dataset directory with classes.txt."""
        output_path.mkdir(parents=True, exist_ok=True)

        records = _load_all_metadata(meta_dir)

        categories_file = meta_dir.parent / "categories.json"
        if categories_file.exists():
            try:
                cat_map = json.loads(categories_file.read_text(encoding="utf-8"))
                max_id = max(cat_map.values(), default=-1)
                classes = [""] * (max_id + 1)
                for name, idx in cat_map.items():
                    classes[idx] = name
            except (json.JSONDecodeError, ValueError):
                classes = _build_class_list(records)
        else:
            classes = _build_class_list(records)

        # Write classes.txt
        classes_file = output_path / "classes.txt"
        classes_file.write_text(
            "\n".join(classes) + "\n", encoding="utf-8"
        )

        images_count = 0
        labels_count = 0

        img_out = output_path / "images"
        lbl_out = output_path / "labels"
        img_out.mkdir(exist_ok=True)
        lbl_out.mkdir(exist_ok=True)

        for rec in records:
            image_id = rec.get("image_id", "")
            filename = rec.get("filename", "")

            # Find source image
            src_img = _find_file(images_dir, image_id)
            if src_img is None:
                continue

            # Copy image
            dst_img = img_out / (src_img.stem + src_img.suffix)
            if not dst_img.exists():
                dst_img.write_bytes(src_img.read_bytes())
            images_count += 1

            # Copy label
            src_lbl = labels_dir / f"{image_id}.txt"
            if src_lbl.exists():
                dst_lbl = lbl_out / f"{image_id}.txt"
                dst_lbl.write_bytes(src_lbl.read_bytes())
                line_count = len(
                    src_lbl.read_text(encoding="utf-8").strip().splitlines()
                )
                labels_count += line_count

        return {
            "format": "yolo",
            "file_path": str(output_path),
            "images_count": images_count,
            "labels_count": labels_count,
        }


class COCOExporter:
    """Export to COCO JSON format."""

    @staticmethod
    def export(
        meta_dir: Path,
        images_dir: Path,
        output_path: Path,
    ) -> dict[str, Any]:
        """Write a single COCO-format annotations.json."""
        output_path.mkdir(parents=True, exist_ok=True)

        records = _load_all_metadata(meta_dir)
        classes = _build_class_list(records)
        class_to_id = {name: idx + 1 for idx, name in enumerate(classes)}

        coco = _build_coco_structure(records, images_dir, classes, class_to_id)

        out_file = output_path / "annotations.json"
        out_file.write_text(
            json.dumps(coco, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        return {
            "format": "coco",
            "file_path": str(out_file),
            "images_count": len(coco["images"]),
            "labels_count": len(coco["annotations"]),
        }


def _build_coco_structure(
    records: list[dict[str, Any]],
    images_dir: Path,
    classes: list[str],
    class_to_id: dict[str, int],
) -> dict[str, Any]:
    """Assemble the COCO JSON structure."""
    images_list: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []
    ann_id = 1

    for img_idx, rec in enumerate(records, start=1):
        image_id = rec.get("image_id", "")
        src_img = _find_file(images_dir, image_id)
        if src_img is None:
            continue

        with Image.open(src_img) as img:
            w, h = img.size

        images_list = [
            *images_list,
            {
                "id": img_idx,
                "file_name": rec.get("filename", src_img.name),
                "width": w,
                "height": h,
            },
        ]

        for box in rec.get("boxes", []):
            bbox_xyxy = box.get("bbox", [0, 0, 0, 0])
            x1, y1, x2, y2 = bbox_xyxy
            coco_bbox = [x1, y1, x2 - x1, y2 - y1]
            area = (x2 - x1) * (y2 - y1)
            cat_id = class_to_id.get(box.get("label", ""), 1)
            annotations = [
                *annotations,
                {
                    "id": ann_id,
                    "image_id": img_idx,
                    "category_id": cat_id,
                    "bbox": coco_bbox,
                    "area": area,
                    "iscrowd": 0,
                },
            ]
            ann_id += 1

    categories_list = [
        {"id": idx, "name": name, "supercategory": "object"}
        for name, idx in class_to_id.items()
    ]

    return {
        "info": {
            "description": "BoxFlow export",
            "date_created": datetime.now(timezone.utc).isoformat(),
        },
        "images": images_list,
        "annotations": annotations,
        "categories": categories_list,
    }


class VOCExporter:
    """Export to Pascal VOC XML format (one XML per image)."""

    @staticmethod
    def export(
        meta_dir: Path,
        images_dir: Path,
        output_path: Path,
    ) -> dict[str, Any]:
        """Write one XML annotation file per labeled image."""
        output_path.mkdir(parents=True, exist_ok=True)
        records = _load_all_metadata(meta_dir)

        images_count = 0
        labels_count = 0

        for rec in records:
            image_id = rec.get("image_id", "")
            src_img = _find_file(images_dir, image_id)
            if src_img is None:
                continue

            n_labels = _write_voc_xml(rec, src_img, output_path)
            images_count += 1
            labels_count += n_labels

        return {
            "format": "voc",
            "file_path": str(output_path),
            "images_count": images_count,
            "labels_count": labels_count,
        }


def _write_voc_xml(
    rec: dict[str, Any],
    src_img: Path,
    output_dir: Path,
) -> int:
    """Write a single Pascal VOC XML file and return the box count."""
    with Image.open(src_img) as img:
        w, h = img.size

    root = ET.Element("annotation")
    ET.SubElement(root, "filename").text = rec.get("filename", src_img.name)

    size_el = ET.SubElement(root, "size")
    ET.SubElement(size_el, "width").text = str(w)
    ET.SubElement(size_el, "height").text = str(h)
    ET.SubElement(size_el, "depth").text = "3"

    box_count = 0
    for box in rec.get("boxes", []):
        obj = ET.SubElement(root, "object")
        ET.SubElement(obj, "name").text = box.get("label", "unknown")
        ET.SubElement(obj, "difficult").text = "0"

        bndbox = ET.SubElement(obj, "bndbox")
        bbox = box.get("bbox", [0, 0, 0, 0])
        ET.SubElement(bndbox, "xmin").text = str(int(bbox[0]))
        ET.SubElement(bndbox, "ymin").text = str(int(bbox[1]))
        ET.SubElement(bndbox, "xmax").text = str(int(bbox[2]))
        ET.SubElement(bndbox, "ymax").text = str(int(bbox[3]))
        box_count += 1

    tree = ET.ElementTree(root)
    image_id = rec.get("image_id", "unknown")
    xml_path = output_dir / f"{image_id}.xml"
    tree.write(str(xml_path), encoding="unicode", xml_declaration=True)
    return box_count


class CSVExporter:
    """Export to a flat CSV file."""

    @staticmethod
    def export(
        meta_dir: Path,
        output_path: Path,
    ) -> dict[str, Any]:
        """Write all labels as CSV rows."""
        output_path.mkdir(parents=True, exist_ok=True)
        records = _load_all_metadata(meta_dir)

        csv_file = output_path / "labels.csv"
        images_count = 0
        labels_count = 0

        with csv_file.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["image", "x1", "y1", "x2", "y2", "label"])

            for rec in records:
                filename = rec.get("filename", "")
                boxes = rec.get("boxes", [])
                if boxes:
                    images_count += 1
                for box in boxes:
                    bbox = box.get("bbox", [0, 0, 0, 0])
                    writer.writerow([
                        filename,
                        int(bbox[0]),
                        int(bbox[1]),
                        int(bbox[2]),
                        int(bbox[3]),
                        box.get("label", "unknown"),
                    ])
                    labels_count += 1

        return {
            "format": "csv",
            "file_path": str(csv_file),
            "images_count": images_count,
            "labels_count": labels_count,
        }


def _find_file(directory: Path, stem: str) -> Path | None:
    """Find a file in *directory* whose stem matches."""
    if not directory.exists():
        return None
    for candidate in directory.iterdir():
        if candidate.is_file() and candidate.stem == stem:
            return candidate
    return None
