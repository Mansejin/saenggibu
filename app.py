"""Vercel entrypoint. Local/NAS runs use server.py."""

from src.web.app import app

__all__ = ["app"]
