"""Core labeling API routes."""

from __future__ import annotations

import asyncio
import io
import logging
import re
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

_IMAGE_ID_RE = re.compile(r"^[a-f0-9]{1,32}$")


def _get_service(request: Request) -> LabelerService:
    return request.app.state.service


def _validate_image_id(image_id: str) -> None:
    """Reject image_id values that do not look like hex UUIDs."""
    if not _IMAGE_ID_RE.match(image_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid image ID format",
        )


_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"}


@router.post("/upload", response_model=UploadResponse)
async def upload_image(request: Request, file: UploadFile) -> UploadResponse:
    """Upload an image for labeling."""
    service = _get_service(request)

    filename = file.filename or "image.jpg"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if f".{ext}" not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '.{ext}'. "
            f"Allowed: {', '.join(sorted(_ALLOWED_EXTENSIONS))}",
        )

    max_bytes = request.app.state.settings.max_upload_bytes
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 256)  # 256 KB chunks
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds maximum upload size of "
                f"{request.app.state.settings.max_upload_size_mb}MB",
            )
        chunks = [*chunks, chunk]
    content = b"".join(chunks)

    try:
        result = await asyncio.to_thread(service.upload_image, filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return UploadResponse(**result)


@router.post("/detect/{image_id}", response_model=DetectResponse)
async def detect_objects(request: Request, image_id: str) -> DetectResponse:
    """Run object detection on an uploaded image."""
    _validate_image_id(image_id)
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
    _validate_image_id(image_id)
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
    _validate_image_id(image_id)
    if x1 < 0 or y1 < 0 or x2 < 0 or y2 < 0:
        raise HTTPException(status_code=400, detail="Crop coordinates must be non-negative")
    if x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=400, detail="Invalid crop region: x2 must be > x1 and y2 must be > y1")
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
    _validate_image_id(image_id)
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
    _validate_image_id(image_id)
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


@router.delete("/categories/{name}")
async def delete_category(request: Request, name: str) -> dict[str, Any]:
    service = _get_service(request)
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty")
    deleted = await asyncio.to_thread(service.delete_category, name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Category not found: {name}")
    return {"name": name, "deleted": True}


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


@router.post("/reencode")
async def reencode(request: Request) -> dict[str, Any]:
    return {"status": "ok", "images": 0, "categories": 0, "duration_ms": 0}


@router.get("/stats")
async def get_stats(request: Request) -> dict[str, Any]:
    """Return overall labeling statistics."""
    service = _get_service(request)
    return await asyncio.to_thread(service.get_stats)
