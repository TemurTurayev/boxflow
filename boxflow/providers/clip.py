"""CLIP-based image classification provider."""

from __future__ import annotations

import logging
from typing import Any

from boxflow.providers.base import (
    Classification,
    ClassifierProvider,
    ModelSpec,
    ProviderInfo,
)

logger = logging.getLogger(__name__)

_CLIP_MODELS: list[ModelSpec] = [
    ModelSpec(
        name="ViT-B-32",
        size_mb=350,
        description="CLIP ViT-B/32 (openai) — fast, good quality",
        url="openai",
    ),
    ModelSpec(
        name="ViT-B-16",
        size_mb=600,
        description="CLIP ViT-B/16 (openai) — better quality",
        url="openai",
    ),
    ModelSpec(
        name="ViT-L-14",
        size_mb=900,
        description="CLIP ViT-L/14 (datacomp_xl) — highest quality",
        url="datacomp_xl_s13b_b90k",
    ),
]

_MODEL_PRETRAINED: dict[str, str] = {
    "ViT-B-32": "openai",
    "ViT-B-16": "openai",
    "ViT-L-14": "datacomp_xl_s13b_b90k",
}


def _ensure_open_clip() -> Any:
    """Import open_clip or raise a helpful error."""
    try:
        import open_clip
        return open_clip
    except ImportError as exc:
        raise ImportError(
            "open_clip_torch is required for CLIP classification. "
            "Install with: pip install boxflow[clip]"
        ) from exc


class CLIPProvider(ClassifierProvider):
    """Zero-shot image classification via OpenCLIP."""

    def __init__(
        self,
        model_name: str = "ViT-B-32",
        pretrained: str | None = None,
        **_kwargs: Any,
    ) -> None:
        self._model_name = model_name
        self._pretrained = pretrained or _MODEL_PRETRAINED.get(model_name, "openai")
        self._model: Any = None
        self._preprocess: Any = None
        self._tokenizer: Any = None

    def _load_model(self) -> None:
        """Lazy-load the CLIP model, preprocessor, and tokenizer."""
        if self._model is not None:
            return
        open_clip = _ensure_open_clip()
        import torch

        model, _, preprocess = open_clip.create_model_and_transforms(
            self._model_name,
            pretrained=self._pretrained,
        )
        # Set model to inference mode
        model.requires_grad_(False)
        self._model = model
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer(self._model_name)
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model = self._model.to(self._device)

    def classify(
        self,
        crops: list[Any],
        categories: list[str],
    ) -> list[Classification]:
        """Classify each crop against the category list."""
        if not crops or not categories:
            return []

        self._load_model()
        import torch

        prompts = [f"a photo of {cat}" for cat in categories]
        text_tokens = self._tokenizer(prompts).to(self._device)

        with torch.no_grad():
            text_features = self._model.encode_text(text_tokens)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)

        results: list[Classification] = []
        for crop in crops:
            result = self._classify_single(crop, categories, text_features)
            results = [*results, result]
        return results

    def _classify_single(
        self,
        crop: Any,
        categories: list[str],
        text_features: Any,
    ) -> Classification:
        """Classify a single PIL Image crop."""
        import torch

        image_tensor = self._preprocess(crop).unsqueeze(0).to(self._device)
        with torch.no_grad():
            image_features = self._model.encode_image(image_tensor)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)

        similarity = (image_features @ text_features.T).squeeze(0)
        probabilities = torch.softmax(similarity * 100.0, dim=0)

        best_idx = int(probabilities.argmax())
        return Classification(
            label=categories[best_idx],
            confidence=float(probabilities[best_idx]),
        )

    def is_ready(self) -> bool:
        """Check if the model can be loaded."""
        try:
            self._load_model()
            return True
        except Exception:
            return False

    @classmethod
    def info(cls) -> ProviderInfo:
        return ProviderInfo(
            name="clip",
            description="OpenCLIP zero-shot image classification",
            models=list(_CLIP_MODELS),
        )
