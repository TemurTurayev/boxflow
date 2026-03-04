"""Settings and model management API routes."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from boxflow.core.models import (
    DownloadModelRequest,
    ModelInfoItem,
    ProviderModelsResponse,
    SettingsResponse,
)
from boxflow.providers.base import ModelDownloadStatus
from boxflow.providers.registry import list_classifier_models, list_detector_models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])

# In-memory download status tracking (keyed by "provider:model_name")
_download_status: dict[str, ModelDownloadStatus] = {}


@router.get("/settings", response_model=SettingsResponse)
async def get_settings(request: Request) -> SettingsResponse:
    """Return the current application settings."""
    settings = request.app.state.settings
    return SettingsResponse(
        host=settings.host,
        port=settings.port,
        data_dir=settings.data_dir,
        detection_provider=settings.detection_provider,
        detection_model=settings.detection_model,
        detection_confidence=settings.detection_confidence,
        detection_imgsz=settings.detection_imgsz,
        classifier_provider=settings.classifier_provider,
        classifier_model=settings.classifier_model,
        export_format=settings.export_format,
        max_upload_size_mb=settings.max_upload_size_mb,
    )


@router.get("/models/detection", response_model=list[ProviderModelsResponse])
async def list_detection_models(
    request: Request,
) -> list[ProviderModelsResponse]:
    """List available detection models and their install status."""
    providers = await asyncio.to_thread(list_detector_models)
    result: list[ProviderModelsResponse] = []
    for provider in providers:
        models = [
            ModelInfoItem(
                name=m.name,
                size_mb=m.size_mb,
                description=m.description,
                installed=_check_model_installed(m.name),
            )
            for m in provider.models
        ]
        result = [
            *result,
            ProviderModelsResponse(
                provider=provider.name,
                description=provider.description,
                models=models,
            ),
        ]
    return result


@router.get("/models/classification", response_model=list[ProviderModelsResponse])
async def list_classification_models(
    request: Request,
) -> list[ProviderModelsResponse]:
    """List available classification models and their install status."""
    providers = await asyncio.to_thread(list_classifier_models)
    result: list[ProviderModelsResponse] = []
    for provider in providers:
        models = [
            ModelInfoItem(
                name=m.name,
                size_mb=m.size_mb,
                description=m.description,
                installed=_check_model_installed(m.name),
            )
            for m in provider.models
        ]
        result = [
            *result,
            ProviderModelsResponse(
                provider=provider.name,
                description=provider.description,
                models=models,
            ),
        ]
    return result


@router.post("/models/download")
async def download_model(
    request: Request, body: DownloadModelRequest
) -> dict[str, str]:
    """Start downloading a model (asynchronous)."""
    key = f"{body.provider}:{body.model_name}"
    existing = _download_status.get(key)
    if existing and existing.status == "downloading":
        return {"status": "already_downloading", "model": body.model_name}

    _download_status[key] = ModelDownloadStatus(
        model_name=body.model_name,
        progress_pct=0.0,
        total_mb=0.0,
        status="downloading",
    )

    # Launch background download
    asyncio.get_event_loop().run_in_executor(
        None, _do_download, body.provider, body.model_name, key
    )
    return {"status": "started", "model": body.model_name}


@router.get("/models/download/status")
async def download_status(request: Request) -> dict[str, Any]:
    """Return the status of all model downloads."""
    return {
        key: {
            "model_name": s.model_name,
            "progress_pct": s.progress_pct,
            "total_mb": s.total_mb,
            "status": s.status,
        }
        for key, s in _download_status.items()
    }


def _check_model_installed(model_name: str) -> bool:
    """Heuristic check whether a model file is available locally."""
    # Check common locations
    candidates = [
        Path(model_name),
        Path.home() / ".cache" / "ultralytics" / model_name,
        Path.home() / ".cache" / "torch" / "hub" / model_name,
    ]
    return any(c.exists() for c in candidates)


def _do_download(provider: str, model_name: str, key: str) -> None:
    """Synchronously download a model, updating status along the way."""
    try:
        if provider in ("yolo", "ultralytics"):
            _download_yolo_model(model_name, key)
        else:
            _download_status[key] = ModelDownloadStatus(
                model_name=model_name,
                progress_pct=0.0,
                total_mb=0.0,
                status="error",
            )
    except Exception as exc:
        logger.error("Model download failed for %s: %s", model_name, exc)
        _download_status[key] = ModelDownloadStatus(
            model_name=model_name,
            progress_pct=0.0,
            total_mb=0.0,
            status="error",
        )


def _download_yolo_model(model_name: str, key: str) -> None:
    """Trigger YOLO model download via ultralytics."""
    try:
        from ultralytics import YOLO

        _download_status[key] = ModelDownloadStatus(
            model_name=model_name,
            progress_pct=50.0,
            total_mb=0.0,
            status="downloading",
        )
        YOLO(model_name)
        _download_status[key] = ModelDownloadStatus(
            model_name=model_name,
            progress_pct=100.0,
            total_mb=0.0,
            status="complete",
        )
    except ImportError:
        _download_status[key] = ModelDownloadStatus(
            model_name=model_name,
            progress_pct=0.0,
            total_mb=0.0,
            status="error",
        )
