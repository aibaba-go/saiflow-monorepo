from dataclasses import replace
from datetime import UTC, datetime

from app.services.audit_service import AuditEvent, entry_hash

EVENT = AuditEvent("user", "7", "user.register", "user", "7", "success")
AT = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
ZERO = bytes(32)


def test_entry_hash_changes_with_any_field():
    base = entry_hash(ZERO, EVENT, AT)
    variants = [
        entry_hash(bytes([1]) * 32, EVENT, AT),
        entry_hash(ZERO, EVENT, datetime(2026, 11, 3, 12, 0, 1, tzinfo=UTC)),
    ]
    for field, value in [
        ("actor_type", "admin"),
        ("actor_id", "8"),
        ("action", "user.update_profile"),
        ("target_type", "tenant"),
        ("target_id", None),
        ("result", "failure"),
    ]:
        variants.append(entry_hash(ZERO, replace(EVENT, **{field: value}), AT))
    assert len(base) == 32
    assert all(v != base for v in variants)
