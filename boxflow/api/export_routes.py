"""Export API routes."""

from __future__ import annotations

import asyncio
import logging
import tempfile

from fastapi import APIRouter, HTTPException, Request

from boxflow.core.exporters import (
    COCOExporter,
    CSVExporter,
    VOCExporter,
    YOLOExporter,
)
from boxflow.core.models import ExportRequest, ExportResponse
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


@router.post("/export", response_model=ExportResponse)
async def export_labels(request: Request, body: ExportRequest) -> ExportResponse:
    """Export all labels in the specified format."""
    service = _get_service(request)
    try:
        result = await asyncio.to_thread(_run_export, service, body.format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Export failed: %s", exc)
        raise HTTPException(status_code=500, detail="Export failed")
    return ExportResponse(**result)
