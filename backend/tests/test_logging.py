"""configure_logging must render exceptions (type, message, traceback) in JSON logs."""

import json

import pytest
import structlog

from app.core.logging import configure_logging


def test_exception_logs_include_type_message_and_traceback(
    capsys: pytest.CaptureFixture[str],
) -> None:
    try:
        configure_logging("INFO")
        try:
            raise RuntimeError("traceback-marker")
        except RuntimeError:
            structlog.get_logger().exception("unhandled_error", path="/x")

        line = capsys.readouterr().out.strip().splitlines()[-1]
        body = json.loads(line)

        assert body["event"] == "unhandled_error"
        assert body["path"] == "/x"
        exception = body.get("exception", "")
        assert "RuntimeError" in exception
        assert "traceback-marker" in exception
        assert "Traceback (most recent call last)" in exception
    finally:
        structlog.reset_defaults()
