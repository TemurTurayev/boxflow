"""Core labeling API routes."""

from __future__ import annotations

import asyncio
import io
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from boxflow.core.models import (
    BboxItem,
    ClassifyRequest,
    ClassifyResponse,
    ClassifySuggestion,
    CreateCategoryRequest,
    DetectResponse,
    SaveRequest,
    SaveResponse,
    UploadResponse,
)
from boxflow.core.service import LabelerService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["labeling"])


def _get_service(request: Request) -> LabelerService:
    return request.app.state.service


@router.post("/upload", response_model=UploadResponse)
async def upload_image(request: Request, file: UploadFile) -> UploadResponse:
    """Upload an image for labeling."""
    service = _get_service(request)
    content = await file.read()

    max_bytes = request.app.state.settings.max_upload_bytes
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum upload size of "
            f"{request.app.state.settings.max_upload_size_mb}MB",
        )

    filename = file.filename or "image.jpg"
    result = await asyncio.to_thread(service.upload_image, filename, content)
    return UploadResponse(**result)


@router.post("/detect/{image_id}", response_model=DetectResponse)
async def detect_objects(request: Request, image_id: str) -> DetectResponse:
    """Run object detection on an uploaded image."""
    service = _get_service(request)
    try:
        result = await asyncio.to_thread(service.detect, image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")
    boxes = [BboxItem(**b) for b in result["boxes"]]
    return DetectResponse(
        image_id=result["image_id"],
        width=result["width"],
        height=result["height"],
        boxes=boxes,
    )


@router.get("/images/{image_id}")
async def get_image(request: Request, image_id: str) -> StreamingResponse:
    """Serve an uploaded image by ID."""
    service = _get_service(request)
    path = service.get_image_path(image_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")

    suffix = path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    media_type = media_types.get(suffix, "application/octet-stream")

    content = await asyncio.to_thread(path.read_bytes)
    return StreamingResponse(io.BytesIO(content), media_type=media_type)


@router.post("/crop/{image_id}")
async def crop_image(
    request: Request,
    image_id: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> StreamingResponse:
    """Return a cropped region of an image."""
    service = _get_service(request)
    try:
        crop = await asyncio.to_thread(
            service.crop_box, image_id, (x1, y1, x2, y2)
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")

    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")


@router.post("/save/{image_id}", response_model=SaveResponse)
async def save_labels(
    request: Request, image_id: str, body: SaveRequest
) -> SaveResponse:
    """Save labels for an image."""
    service = _get_service(request)
    boxes_dicts = [
        {"bbox": tuple(box.bbox), "label": box.label} for box in body.boxes
    ]
    try:
        result = await asyncio.to_thread(
            service.save_labels, image_id, boxes_dicts
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")
    except Exception as exc:
        logger.error("Failed to save labels for %s: %s", image_id, exc)
        raise HTTPException(status_code=500, detail="Failed to save labels")
    return SaveResponse(**result)


@router.post("/classify/{image_id}", response_model=ClassifyResponse)
async def classify_crops(
    request: Request, image_id: str, body: ClassifyRequest
) -> ClassifyResponse:
    """Classify detected objects against known categories."""
    service = _get_service(request)
    boxes_dicts = [
        {"bbox": tuple(b.bbox), "confidence": b.confidence} for b in body.boxes
    ]
    try:
        result = await asyncio.to_thread(
            service.classify_crops, image_id, boxes_dicts
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")

    suggestions = [ClassifySuggestion(**s) for s in result["suggestions"]]
    return ClassifyResponse(suggestions=suggestions, status=result["status"])


@router.get("/categories")
async def list_categories(request: Request) -> list[dict[str, Any]]:
    """List all labeling categories."""
    service = _get_service(request)
    return await asyncio.to_thread(service.get_categories)


@router.post("/categories")
async def create_category(
    request: Request, body: CreateCategoryRequest
) -> dict[str, Any]:
    """Create a new labeling category."""
    service = _get_service(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty")
    return await asyncio.to_thread(service.create_category, name)


@router.get("/queue")
async def get_queue(request: Request) -> list[dict[str, Any]]:
    """Return the queue of unlabeled images."""
    service = _get_service(request)
    return await asyncio.to_thread(service.get_queue)


@router.get("/history")
async def get_history(request: Request) -> list[dict[str, Any]]:
    """Return labeled image history."""
    service = _get_service(request)
    return await asyncio.to_thread(service.get_history)


@router.get("/stats")
async def get_stats(request: Request) -> dict[str, Any]:
    """Return overall labeling statistics."""
    service = _get_service(request)
    return await asyncio.to_thread(service.get_stats)
