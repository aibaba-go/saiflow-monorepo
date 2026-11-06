"""The review notice email (FR-SYS-126), in English like the reminder emails."""

LEVELS = {1: "level-1 review", 2: "level-2 review"}


def render(data: dict, org_name: str) -> tuple[str, str]:
    """(subject, body) for one review notice."""
    template = data.get("template_name") or "Generic result"
    level = LEVELS.get(data.get("level"), "review")
    body = "\n".join(
        [
            f"A document in {org_name} is waiting for your {level}.",
            "",
            f"File: {data.get('file_name') or '-'}",
            f"Template: {template}",
            f"Confirmed by: {data.get('confirmer_name') or '-'}",
            "",
            "Open SaiFlow and go to Reviews to approve or return it.",
        ]
    )
    return "SaiFlow: a document is waiting for your review", body
