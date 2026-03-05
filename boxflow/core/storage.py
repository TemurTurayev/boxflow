"""File storage management for uploads, labels, crops, and metadata."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class Storage:
    """Manages the data directory tree.

    Layout::

        data/
            uploads/         # raw uploaded images
            labeled/
                images/      # copies of images that have labels
                labels/      # YOLO-format .txt per image
            crops/           # per-category crop directories
            meta/            # per-image JSON metadata
            reference/       # reference images for categories
            categories.json  # category registry
    """

    def __init__(self, data_dir: Path) -> None:
        self._root = data_dir

    @property
    def root(self) -> Path:
        return self._root

    @property
    def uploads_dir(self) -> Path:
        return self._root / "uploads"

    @property
    def labeled_dir(self) -> Path:
        return self._root / "labeled"

    @property
    def images_dir(self) -> Path:
        return self._root / "labeled" / "images"

    @property
    def labels_dir(self) -> Path:
        return self._root / "labeled" / "labels"

    @property
    def crops_dir(self) -> Path:
        return self._root / "crops"

    @property
    def meta_dir(self) -> Path:
        return self._root / "meta"

    @property
    def reference_dir(self) -> Path:
        return self._root / "reference"

    @property
    def categories_file(self) -> Path:
        return self._root / "categories.json"

    def ensure_directories(self) -> None:
        """Create the full directory tree if it does not exist."""
        for directory in (
            self.uploads_dir,
            self.images_dir,
            self.labels_dir,
            self.crops_dir,
            self.meta_dir,
            self.reference_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        logger.info("Data directories ensured at %s", self._root)

    def _is_within(self, path: Path, parent: Path) -> bool:
        """Verify that *path* is a child of *parent* (prevents traversal)."""
        try:
            path.resolve().relative_to(parent.resolve())
            return True
        except ValueError:
            return False

    def resolve_image(self, image_id: str) -> Path | None:
        """Find an uploaded image by its ID (stem).

        Searches the uploads directory for any file whose stem matches
        *image_id*. Returns ``None`` if not found.
        """
        if not self.uploads_dir.exists():
            return None
        for candidate in self.uploads_dir.iterdir():
            if candidate.is_file() and candidate.stem == image_id:
                if not self._is_within(candidate, self.uploads_dir):
                    logger.warning("Path traversal blocked: %s", candidate)
                    return None
                return candidate
        return None

    def resolve_labeled_image(self, image_id: str) -> Path | None:
        """Find a labeled image by its ID (stem)."""
        if not self.images_dir.exists():
            return None
        for candidate in self.images_dir.iterdir():
            if candidate.is_file() and candidate.stem == image_id:
                if not self._is_within(candidate, self.images_dir):
                    logger.warning("Path traversal blocked: %s", candidate)
                    return None
                return candidate
        return None

    def list_uploads(self) -> list[Path]:
        """Return all uploaded image files sorted by modification time."""
        if not self.uploads_dir.exists():
            return []
        files = [
            f for f in self.uploads_dir.iterdir()
            if f.is_file() and not f.name.startswith(".")
        ]
        return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)

    def list_labeled(self) -> list[Path]:
        """Return all label files sorted by modification time."""
        if not self.labels_dir.exists():
            return []
        files = [f for f in self.labels_dir.iterdir() if f.suffix == ".txt"]
        return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)

    def list_categories(self) -> list[str]:
        """Return category names from the crops directory."""
        if not self.crops_dir.exists():
            return []
        return sorted(
            d.name for d in self.crops_dir.iterdir() if d.is_dir()
        )
