from __future__ import annotations

from pathlib import Path

import pytest

from src.saenggibu import datastore
from src.saenggibu.config import DATA_DIR
from src.saenggibu.models import StudentInput


class FakeRedis:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}

    def run(self, command: list[str]) -> object:
        op, *args = command
        if op == "GET":
            return self.kv.get(args[0])
        if op == "MGET":
            return [self.kv.get(key) for key in args]
        if op == "SET":
            self.kv[args[0]] = args[1]
            return "OK"
        if op == "EXISTS":
            return int(args[0] in self.kv)
        if op == "DEL":
            existed = args[0] in self.kv or args[0] in self.sets
            self.kv.pop(args[0], None)
            self.sets.pop(args[0], None)
            return int(existed)
        if op == "SADD":
            self.sets.setdefault(args[0], set()).add(args[1])
            return 1
        if op == "SREM":
            self.sets.get(args[0], set()).discard(args[1])
            return 1
        if op == "SMEMBERS":
            return sorted(self.sets.get(args[0], set()))
        raise AssertionError(f"unexpected command {op}")


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    fake = FakeRedis()
    monkeypatch.setenv("KV_REST_API_URL", "https://example.upstash.io")
    monkeypatch.setenv("KV_REST_API_TOKEN", "token")
    monkeypatch.setattr(datastore, "_pipeline", lambda *commands: [fake.run(c) for c in commands])
    return fake


def test_redis_roundtrip_and_listing(fake_redis: FakeRedis) -> None:
    students = DATA_DIR / "students"
    datastore.write_text(students / "s1.json", "{}")
    datastore.write_text(students / "s2.json", "[]")

    assert fake_redis.kv["sgb:students/s1.json"] == "{}"
    assert datastore.exists(students / "s1.json")
    assert datastore.read_text(students / "s2.json") == "[]"
    assert [p.name for p in datastore.list_files(students, "*.json")] == ["s1.json", "s2.json"]
    assert datastore.read_many([students / "s1.json", students / "nope.json"]) == {
        students / "s1.json": "{}",
        students / "nope.json": None,
    }

    datastore.delete(students / "s1.json")
    assert not datastore.exists(students / "s1.json")
    assert [p.name for p in datastore.list_files(students)] == ["s2.json"]
    with pytest.raises(FileNotFoundError):
        datastore.read_text(students / "s1.json")


def test_redis_delete_tree(fake_redis: FakeRedis) -> None:
    out = DATA_DIR / "outputs" / "s1"
    datastore.write_text(out / "a.json", "1")
    datastore.write_text(out / "b.json", "2")
    datastore.delete_tree(out)
    assert datastore.list_files(out) == []
    assert not fake_redis.kv


def test_student_store_on_redis(fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch) -> None:
    from src.saenggibu import student_store

    monkeypatch.setenv("SGB_ENCRYPT_DATA", "0")
    student_store.add_student(StudentInput(id="s1", name="김민수", grade=2, class_num=1, number=1))
    student_store.add_student(StudentInput(id="s2", name="", grade=1, class_num=1, number=2))

    names = [s.name for s in student_store.list_students()]
    assert names == ["김민수"]
    assert "sgb:students/s2.json" not in fake_redis.kv
    assert student_store.delete_student("s1") is True
    assert student_store.list_students() == []


def test_local_backend_without_credentials(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KV_REST_API_URL", raising=False)
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    path = tmp_path / "x" / "a.json"
    datastore.write_text(path, "hi")
    assert path.read_text(encoding="utf-8") == "hi"
    assert datastore.list_files(tmp_path / "x") == [path]
