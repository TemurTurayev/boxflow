"""FastAPI application factory."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from boxflow import __version__
from boxflow.api.export_routes import router as export_router
from boxflow.api.routes import router as labeling_router
from boxflow.api.settings_api import router as settings_router
from boxflow.config import Settings
from boxflow.core.service import LabelerService
from boxflow.core.storage import Storage
from boxflow.providers.registry import get_classifier, get_detector

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Build and configure the BoxFlow FastAPI application."""
    settings = Settings()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    storage = Storage(settings.data_path)

    detector = _create_detector(settings)
    classifier = _create_classifier(settings)

    service = LabelerService(
        settings=settings,
        detector=detector,
        classifier=classifier,
        storage=storage,
    )

    app = FastAPI(
        title="BoxFlow",
        version=__version__,
        description="AI-assisted image labeling for object detection",
    )

    app.state.service = service
    app.state.settings = settings

    _add_cors(app, settings)
    _include_routers(app)

    logger.info(
        "BoxFlow %s started — data_dir=%s, detector=%s, classifier=%s",
        __version__,
        settings.data_path,
        settings.detection_provider,
        settings.classifier_provider,
    )

    return app


def _create_detector(settings: Settings):
    """Instantiate the configured detection provider."""
    try:
        return get_detector(
            settings.detection_provider,
            model_path=settings.detection_model,
            confidence=settings.detection_confidence,
            imgsz=settings.detection_imgsz,
        )
    except RuntimeError as exc:
        logger.warning("Detection provider unavailable: %s", exc)
        return _FallbackDetector()


def _create_classifier(settings: Settings):
    """Instantiate the configured classifier provider (or None)."""
    try:
        return get_classifier(
            settings.classifier_provider,
            model_name=settings.classifier_model,
        )
    except RuntimeError as exc:
        logger.warning("Classifier provider unavailable: %s", exc)
        return None


def _add_cors(app: FastAPI, settings: Settings) -> None:
    """Configure CORS middleware."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _include_routers(app: FastAPI) -> None:
    """Register all API routers."""
    app.include_router(labeling_router)
    app.include_router(export_router)
    app.include_router(settings_router)


class _FallbackDetector:
    """No-op detector used when the real provider cannot be loaded.

    This allows the server to start even without ultralytics installed,
    returning empty results for detection requests.
    """

    def detect(self, image_path):
        return []

    def is_ready(self) -> bool:
        return False

    @classmethod
    def info(cls):
        from boxflow.providers.base import ProviderInfo
        return ProviderInfo(
            name="fallback",
            description="No detection provider available",
            models=[],
        )

    @staticmethod
    def get_image_size(path):
        from PIL import Image
        with Image.open(path) as img:
            return img.size
