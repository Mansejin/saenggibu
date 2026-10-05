from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.web.app import app


@pytest.mark.parametrize("path", ["/", "/admin", "/admin/"])
def test_root_paths_redirect_to_admin(path: str) -> None:
    response = TestClient(app).get(path, follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/admin/saenggibu"
