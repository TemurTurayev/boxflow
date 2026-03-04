"""Export API routes."""

from __future__ import annotations

import asyncio
import io
import logging
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from boxflow.core.exporters import (
    COCOExporter,
    CSVExporter,
    VOCExporter,
    YOLOExporter,
)
from boxflow.core.models import ExportRequest
from boxflow.core.service import LabelerService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["export"])


def _get_service(request: Request) -> LabelerService:
    return request.app.state.service


def _run_export(service: LabelerService, fmt: str) -> dict:
    """Execute the appropriate exporter synchronously."""
    storage = service.storage
    output_base = storage.root / "exports" / fmt
    output_base.mkdir(parents=True, exist_ok=True)

    if fmt == "yolo":
        return YOLOExporter.export(
            meta_dir=storage.meta_dir,
            labels_dir=storage.labels_dir,
            images_dir=storage.images_dir,
            output_path=output_base,
        )
    if fmt == "coco":
        return COCOExporter.export(
            meta_dir=storage.meta_dir,
            images_dir=storage.images_dir,
            output_path=output_base,
        )
    if fmt == "voc":
        return VOCExporter.export(
            meta_dir=storage.meta_dir,
            images_dir=storage.images_dir,
            output_path=output_base,
        )
    if fmt == "csv":
        return CSVExporter.export(
            meta_dir=storage.meta_dir,
            output_path=output_base,
        )
    raise ValueError(f"Unknown export format: {fmt}")


@router.post("/export")
async def export_labels(request: Request, body: ExportRequest) -> StreamingResponse:
    service = _get_service(request)
    try:
        result = await asyncio.to_thread(_run_export, service, body.format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Export failed: %s", exc)
        raise HTTPException(status_code=500, detail="Export failed")

    file_path = Path(result["file_path"])
    fmt = result["format"]

    if fmt == "csv":
        csv_file = file_path if file_path.suffix == ".csv" else file_path / "labels.csv"
        if csv_file.exists():
            content = csv_file.read_bytes()
            return StreamingResponse(
                io.BytesIO(content),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=labels.csv"},
            )

    if fmt == "coco":
        json_file = file_path if file_path.suffix == ".json" else file_path / "annotations.json"
        if json_file.exists():
            content = json_file.read_bytes()
            return StreamingResponse(
                io.BytesIO(content),
                media_type="application/json",
                headers={"Content-Disposition": "attachment; filename=annotations.json"},
            )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in file_path.rglob("*"):
            if f.is_file():
                arcname = f.relative_to(file_path)
                zf.write(f, arcname)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=labels-{fmt}.zip"},
    )
