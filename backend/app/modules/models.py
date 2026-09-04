"""Import every ORM model module so SQLAlchemy's shared ``Base.metadata`` is complete.

String-based ``ForeignKey``s (e.g. ``properties.assigned_agent_id`` → ``"users.id"``) are
resolved lazily, at mapper-configuration time, against whatever tables are registered in the
one shared metadata. An entry point that imports only *some* model modules therefore fails on
the first flush with "could not find table 'users'". The API resolves this transitively through
its routers, but the worker and CLI build the ORM directly — so they must import this module
(side-effect only) before using a session. Mirrors the block in ``tests/conftest.py``.
"""

import app.modules.availability.models  # noqa: F401
import app.modules.contacts.models  # noqa: F401
import app.modules.dedupe.models  # noqa: F401
import app.modules.identity.models  # noqa: F401
import app.modules.listings.models  # noqa: F401
import app.modules.outreach.models  # noqa: F401
import app.modules.properties.models  # noqa: F401
import app.worker.models  # noqa: F401
