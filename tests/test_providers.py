"""Tests for the provider registry and base classes."""

from __future__ import annotations

import pytest

from boxflow.providers.base import (
    Classification,
    Detection,
    ModelSpec,
    ProviderInfo,
)
from boxflow.providers.registry import (
    _import_class,
    get_classifier,
    get_detector,
)


class TestDataclasses:
    """Verify that provider dataclasses are frozen and well-formed."""

    def test_detection_is_frozen(self) -> None:
        d = Detection(bbox=(0, 0, 10, 10), confidence=0.9, class_name="obj")
        with pytest.raises(AttributeError):
            d.confidence = 0.5  # type: ignore[misc]

    def test_classification_is_frozen(self) -> None:
        c = Classification(label="cat", confidence=0.85)
        with pytest.raises(AttributeError):
            c.label = "dog"  # type: ignore[misc]

    def test_model_spec_is_frozen(self) -> None:
        m = ModelSpec(name="test.pt", size_mb=10)
        with pytest.raises(AttributeError):
            m.name = "other.pt"  # type: ignore[misc]

    def test_provider_info_is_frozen(self) -> None:
        p = ProviderInfo(name="test", description="desc")
        with pytest.raises(AttributeError):
            p.name = "other"  # type: ignore[misc]


class TestRegistry:
    """Verify provider resolution logic."""

    def test_import_class_valid(self) -> None:
        cls = _import_class("boxflow.providers.base:Detection")
        assert cls is Detection

    def test_import_class_invalid_format(self) -> None:
        with pytest.raises(ValueError, match="Invalid provider path"):
            _import_class("no_colon_here")

    def test_import_class_missing_class(self) -> None:
        with pytest.raises(ImportError, match="not found"):
            _import_class("boxflow.providers.base:NonExistent")

    def test_get_classifier_none(self) -> None:
        result = get_classifier("none")
        assert result is None

    def test_get_detector_unknown(self) -> None:
        with pytest.raises(RuntimeError, match="Unknown detection provider"):
            get_detector("totally_unknown_provider")

    def test_get_classifier_unknown(self) -> None:
        with pytest.raises(RuntimeError, match="Unknown classifier provider"):
            get_classifier("totally_unknown_provider")
