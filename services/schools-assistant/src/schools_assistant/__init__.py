"""Grounded Schools assistant service."""

import os

# The Pydantic AI console banner is noise in service logs.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
