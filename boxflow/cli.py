"""Command-line interface for BoxFlow server."""

from __future__ import annotations

import argparse
import sys

from boxflow import __version__


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="boxflow",
        description="BoxFlow — AI-assisted image labeling for object detection.",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=None,
        help="Bind host (default: 0.0.0.0, overrides BOXFLOW_HOST)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Bind port (default: 8001, overrides BOXFLOW_PORT)",
    )
    parser.add_argument(
        "--data",
        type=str,
        default=None,
        help="Data directory path (default: ./data, overrides BOXFLOW_DATA_DIR)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        default=False,
        help="Enable auto-reload for development",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"boxflow {__version__}",
    )
    return parser


def _apply_cli_overrides(args: argparse.Namespace) -> None:
    """Push CLI flags into environment so Settings picks them up."""
    import os

    if args.host is not None:
        os.environ["BOXFLOW_HOST"] = args.host
    if args.port is not None:
        os.environ["BOXFLOW_PORT"] = str(args.port)
    if args.data is not None:
        os.environ["BOXFLOW_DATA_DIR"] = args.data


def main() -> None:
    """Entry point for the ``boxflow`` command."""
    parser = _build_parser()
    args = parser.parse_args()

    _apply_cli_overrides(args)

    try:
        import uvicorn
    except ImportError:
        sys.stderr.write(
            "uvicorn is required to run BoxFlow. Install with: pip install boxflow\n"
        )
        sys.exit(1)

    uvicorn.run(
        "boxflow.app:create_app",
        factory=True,
        host=args.host or "0.0.0.0",
        port=args.port or 8001,
        reload=args.reload,
    )
