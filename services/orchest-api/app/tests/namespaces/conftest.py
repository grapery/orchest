import copy
import os
import uuid

import pytest
from config import CONFIG_CLASS
from sqlalchemy_utils import drop_database
from tests.test_utils import (
    EnvironmentBuild,
    InteractiveRun,
    InteractiveSession,
    Job,
    Pipeline,
    Project,
)

import app.core.sessions
from _orchest.internals.test_utils import AbortableAsyncResultMock, CeleryMock, uuid4
from app import create_app
from app.apis import (
    namespace_environment_builds,
    namespace_environment_images,
    namespace_jobs,
    namespace_runs,
)
from app.connections import db


@pytest.fixture()
def celery(monkeypatch):
    celery = CeleryMock()
    for module in [namespace_environment_builds, namespace_runs, namespace_jobs]:
        monkeypatch.setattr(module, "make_celery", lambda *args, **kwargs: celery)
    return celery


@pytest.fixture()
def abortable_async_res(monkeypatch):

    aresult = AbortableAsyncResultMock("uuid")
    for module in [namespace_environment_builds, namespace_runs, namespace_jobs]:
        monkeypatch.setattr(
            module, "AbortableAsyncResult", lambda *args, **kwargs: aresult
        )
    return aresult


@pytest.fixture()
def monkeypatch_image_utils(monkeypatch):
    monkeypatch.setattr(
        namespace_environment_images, "remove_if_dangling", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        namespace_environment_images,
        "docker_images_list_safe",
        lambda *args, **kwargs: [],
    )
    monkeypatch.setattr(
        namespace_environment_images,
        "docker_images_rm_safe",
        lambda *args, **kwargs: None,
    )


@pytest.fixture(scope="module")
def test_app():

    config = copy.deepcopy(CONFIG_CLASS)

    # Setup the DB URI.
    db_host = os.environ.get("ORCHEST_TEST_DATABASE_HOST", "localhost")
    db_port = os.environ.get("ORCHEST_TEST_DATABASE_PORT", "5432")
    # Postgres does not accept "-" as part of a name.
    db_name = str(uuid.uuid4()).replace("-", "_")
    db_name = "test_db"
    SQLALCHEMY_DATABASE_URI = f"postgresql://postgres@{db_host}:{db_port}/{db_name}"
    config.SQLALCHEMY_DATABASE_URI = SQLALCHEMY_DATABASE_URI

    config.TESTING = True
    app = create_app(config, use_db=True, be_scheduler=False)
    yield app

    drop_database(app.config["SQLALCHEMY_DATABASE_URI"])


@pytest.fixture()
def client(test_app):
    with test_app.test_client() as client:
        yield client

    # Remove all data, so that every test has access to a clean slate.
    with test_app.app_context():
        tables = db.engine.table_names()
        tables = [t for t in tables if t != "alembic_version"]
        tables = ",".join(tables)

        # RESTART IDENTITY is to reset sequence generators.
        cmd = f"TRUNCATE {tables} RESTART IDENTITY;"
        db.engine.execute(cmd)
        db.session.commit()


@pytest.fixture()
def project(client):
    return Project(client, uuid4())


@pytest.fixture()
def pipeline(client, project):
    return Pipeline(client, project, uuid4())


@pytest.fixture()
def monkeypatch_interactive_session(monkeypatch):
    monkeypatch.setattr(
        app.core.sessions.InteractiveSession, "launch", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        app.core.sessions.InteractiveSession,
        "get_containers_IP",
        lambda *args, **kwargs: app.core.sessions.IP("ip1", "ip2"),
    )


@pytest.fixture()
def interactive_session(client, pipeline, monkeypatch_interactive_session, monkeypatch):
    return InteractiveSession(client, pipeline)


@pytest.fixture()
def interactive_run(client, pipeline, celery, monkeypatch):
    monkeypatch.setattr(
        namespace_runs, "lock_environment_images_for_run", lambda *args, **kwargs: {}
    )
    return InteractiveRun(client, pipeline)


@pytest.fixture()
def job(client, pipeline):
    return Job(client, pipeline)


@pytest.fixture()
def environment_build(client, celery, project):
    return EnvironmentBuild(client, project)


@pytest.fixture()
def monkeypatch_lock_environment_images(monkeypatch):
    monkeypatch.setattr(
        namespace_runs, "lock_environment_images_for_run", lambda *args, **kwargs: {}
    )
    monkeypatch.setattr(
        namespace_jobs, "lock_environment_images_for_run", lambda *args, **kwargs: {}
    )