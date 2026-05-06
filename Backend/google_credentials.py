import json
import os
import tempfile
from pathlib import Path


def resolve_google_credentials_path(base_dir: Path) -> str:
    """
    Resolve Google service-account credentials with robust fallbacks.

    Priority:
    1) GOOGLE_CREDENTIALS_FILE / GA4_CREDENTIALS file path
    2) common local/container filenames
    3) GOOGLE_CREDENTIALS_JSON / GOOGLE_SERVICE_ACCOUNT_JSON inline JSON
    """
    env_path = (
        (os.environ.get("GOOGLE_CREDENTIALS_FILE") or "").strip()
        or (os.environ.get("GA4_CREDENTIALS") or "").strip()
        or "ga4-credentials.json"
    )
    p = Path(env_path)

    candidates: list[Path] = []
    if p.is_absolute():
        candidates.append(p)
        if not p.is_file():
            candidates.append(base_dir / p.name)
    else:
        candidates.append(base_dir / p)

    candidates.extend(
        [
            base_dir / "ga4-credentials.json",
            base_dir / "credentials.json",
            Path("/app/ga4-credentials.json"),
            Path("/app/credentials.json"),
            Path("/app/secrets/ga4-credentials.json"),
            Path("/app/secrets/credentials.json"),
        ]
    )

    checked: list[str] = []
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        checked.append(str(resolved))
        if resolved.is_file():
            return str(resolved)

    inline_json = (
        (os.environ.get("GOOGLE_CREDENTIALS_JSON") or "").strip()
        or (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
    )
    if inline_json:
        try:
            parsed = json.loads(inline_json)
            if not isinstance(parsed, dict) or not parsed.get("client_email"):
                raise ValueError("JSON must be a valid service account object.")
        except Exception as e:
            raise RuntimeError(f"Invalid GOOGLE_CREDENTIALS_JSON / GOOGLE_SERVICE_ACCOUNT_JSON: {e}") from e

        temp_path = Path(tempfile.gettempdir()) / "wheeler-google-credentials.json"
        temp_path.write_text(json.dumps(parsed), encoding="utf-8")
        return str(temp_path)

    raise FileNotFoundError(
        "Google credentials not found. Checked paths: "
        + ", ".join(checked)
        + ". Also checked env JSON vars: GOOGLE_CREDENTIALS_JSON / GOOGLE_SERVICE_ACCOUNT_JSON."
    )
