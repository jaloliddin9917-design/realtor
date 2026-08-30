"""`python -m app.api` serves the API; `python -m app.api openapi` prints the schema."""

import json
import sys

import uvicorn

from app.api.app import create_app
from app.core.logging import configure_logging
from app.core.settings import get_settings


def main(argv: list[str]) -> int:
    settings = get_settings()
    if argv[:1] == ["openapi"]:
        json.dump(create_app(settings).openapi(), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0
    configure_logging(settings.log_level)
    uvicorn.run(
        create_app(settings), host=settings.api_host, port=settings.api_port, log_config=None
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
