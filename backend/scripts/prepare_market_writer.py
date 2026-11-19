"""Create private deployment credential files; never print a password or URL.

The SQL contains only PostgreSQL's salted SCRAM verifier. The clear credential
stays in a 0600 local file for direct upload to GitHub Secrets, outside Git.
"""
import argparse
import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
from urllib.parse import quote, urlsplit, urlunsplit


def prepare(env_path, output):
    values = {}
    for line in Path(env_path).read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    source = urlsplit(values["SUPABASE_DB_URL"])
    username = source.username or ""
    if not username.startswith("signalgen_api.") or source.scheme not in ("postgres", "postgresql"):
        raise ValueError("requires the existing restricted session-pooler URL")
    project = username.split(".", 1)[1]
    password = secrets.token_hex(32)
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096)
    stored = hashlib.sha256(hmac.digest(salted, b"Client Key", "sha256")).digest()
    server = hmac.digest(salted, b"Server Key", "sha256")
    b64 = lambda value: base64.b64encode(value).decode()
    verifier = f"SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}"
    user = quote("signalgen_market_writer." + project, safe="")
    host = source.hostname
    if ":" in host:
        host = "[" + host + "]"
    port = f":{source.port}" if source.port else ""
    url = urlunsplit((source.scheme, f"{user}:{password}@{host}{port}", source.path, source.query, ""))
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, value in {
        "writer-url": url,
        "enroll.sql": "select set_config('signalgen.market_writer_scram','" + verifier + "',true);\n",
    }.items():
        target = output / name
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(value)
    print("Private credential files prepared; contents withheld.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    prepare(args.env, args.output)
