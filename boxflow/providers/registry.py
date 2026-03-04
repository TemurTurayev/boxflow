"""Provider registry — resolves names to provider classes."""

from __future__ import annotations

import importlib
import logging
from typing import Any

from boxflow.providers.base import (
    ClassifierProvider,
    DetectionProvider,
    ProviderInfo,
)

logger = logging.getLogger(__name__)

_BUILTIN_DETECTORS: dict[str, str] = {
    "yolo": "boxflow.providers.yolo:YOLOProvider",
}

_BUILTIN_CLASSIFIERS: dict[str, str] = {
    "clip": "boxflow.providers.clip:CLIPProvider",
}


def _import_class(dotted_path: str) -> type:
    """Import a class from a ``module.path:ClassName`` string."""
    if ":" not in dotted_path:
        raise ValueError(
            f"Invalid provider path '{dotted_path}'. "
            "Expected format: 'module.path:ClassName'"
        )
    module_path, class_name = dotted_path.rsplit(":", 1)
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name, None)
    if cls is None:
        raise ImportError(
            f"Class '{class_name}' not found in module '{module_path}'"
        )
    return cls


def get_detector(name: str, **kwargs: Any) -> DetectionProvider:
    """Resolve a detector name to an instantiated provider.

    *name* can be a builtin key like ``"yolo"`` or a fully-qualified dotted
    path like ``"mypackage.det:MyDetector"``.
    """
    dotted = _BUILTIN_DETECTORS.get(name, name)
    try:
        cls = _import_class(dotted)
    except (ImportError, ValueError) as exc:
        raise RuntimeError(
            f"Cannot load detection provider '{name}': {exc}"
        ) from exc
    return cls(**kwargs)


def get_classifier(name: str, **kwargs: Any) -> ClassifierProvider | None:
    """Resolve a classifier name to an instantiated provider.

    Returns ``None`` when *name* is ``"none"`` (classification disabled).
    """
    if name.lower() == "none":
        return None

    dotted = _BUILTIN_CLASSIFIERS.get(name, name)
    try:
        cls = _import_class(dotted)
    except (ImportError, ValueError) as exc:
        raise RuntimeError(
            f"Cannot load classifier provider '{name}': {exc}"
        ) from exc
    return cls(**kwargs)


def list_detector_models() -> list[ProviderInfo]:
    """Return provider info for every registered detector."""
    result: list[ProviderInfo] = []
    for dotted in _BUILTIN_DETECTORS.values():
        try:
            cls = _import_class(dotted)
            result.append(cls.info())
        except Exception:
            logger.warning("Could not load info for %s", dotted, exc_info=True)
    return result


def list_classifier_models() -> list[ProviderInfo]:
    """Return provider info for every registered classifier."""
    result: list[ProviderInfo] = []
    for dotted in _BUILTIN_CLASSIFIERS.values():
        try:
            cls = _import_class(dotted)
            result.append(cls.info())
        except Exception:
            logger.warning("Could not load info for %s", dotted, exc_info=True)
    return result
