import pytest
from starlette.testclient import TestClient

from main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_passes_returns_geojson(client: TestClient) -> None:
    response = client.get("/api/passes")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert isinstance(body["features"], list)


def test_needs_has_features(client: TestClient) -> None:
    response = client.get("/api/needs")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) >= 1
