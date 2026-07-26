#!/usr/bin/env python3

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def parse_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            f"Invalid UUID: {value!r}"
        ) from error


def generate_folder_names(pattern: str, count: int) -> list[str]:
    """
    Supported placeholders:
        {i}       - zero-based folder index
        {number}  - one-based folder number
        {n}       - total number of folders
    """
    names: list[str] = []

    for index in range(count):
        try:
            name = pattern.format(
                i=index,
                number=index + 1,
                n=count,
            ).strip()
        except (KeyError, IndexError, ValueError) as error:
            raise ValueError(f"Invalid folder name pattern: {error}") from error

        if not name:
            raise ValueError("The pattern produced an empty folder name.")

        if len(name) > 500:
            raise ValueError(
                f"The pattern produced a folder name longer than 500 characters: {name!r}"
            )

        if "/" in name or "\\" in name:
            raise ValueError(
                f"The folder name must not contain '/' or '\\\\': {name!r}"
            )

        names.append(name)

    if len(set(names)) != len(names):
        raise ValueError(
            "The pattern produced duplicate folder names. "
            "Include {i} or {number} in the pattern."
        )

    return names


def execute_json_request(
    request: Request,
    expected_status: int,
    timeout: float,
) -> dict[str, object]:
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")

            if response.status != expected_status:
                raise RuntimeError(
                    f"Unexpected HTTP status {response.status}; "
                    f"expected {expected_status}."
                )

    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")

        try:
            details = json.loads(body)
        except json.JSONDecodeError:
            details = body or error.reason

        raise RuntimeError(
            f"HTTP {error.code} from {request.full_url}: {details}"
        ) from error

    except URLError as error:
        raise RuntimeError(
            f"Request to {request.full_url} failed: {error.reason}"
        ) from error

    try:
        result = json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Server returned invalid JSON from {request.full_url}."
        ) from error

    if not isinstance(result, dict):
        raise RuntimeError(
            f"Server returned an unexpected response from {request.full_url}."
        )

    return result


def obtain_access_token(
    issuer_url: str,
    client_id: str,
    username: str,
    password: str,
    timeout: float,
) -> str:
    token_url = (
        f"{issuer_url.rstrip('/')}/protocol/openid-connect/token"
    )

    body = urlencode(
        {
            "grant_type": "password",
            "client_id": client_id,
            "username": username,
            "password": password,
            "scope": "openid",
        }
    ).encode("utf-8")

    request = Request(
        token_url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )

    response = execute_json_request(request, 200, timeout)
    access_token = response.get("access_token")

    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError("Keycloak response does not contain an access token.")

    return access_token


def create_folder(
    api_url: str,
    access_token: str,
    name: str,
    parent_id: str | None,
    timeout: float,
) -> dict[str, object]:
    body = json.dumps(
        {
            "name": name,
            "parentId": parent_id,
        }
    ).encode("utf-8")

    request = Request(
        f"{api_url.rstrip('/')}/api/folders",
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )

    return execute_json_request(request, 201, timeout)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create multiple empty folders through the Zero Vault API."
    )

    parser.add_argument(
        "count",
        type=int,
        help="Number of folders to create.",
    )
    parser.add_argument(
        "pattern",
        help=(
            "Folder name pattern, for example 'test-{number:04d}'. "
            "Available placeholders: {i}, {number}, and {n}."
        ),
    )
    parser.add_argument(
        "--parent-id",
        type=parse_uuid,
        default=None,
        help="Destination folder UUID. Omit to create folders in root.",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("ZERO_VAULT_API_URL", "http://localhost:3000"),
        help="Zero Vault backend URL.",
    )
    parser.add_argument(
        "--issuer-url",
        default=os.getenv(
            "ZERO_VAULT_ISSUER_URL",
            "http://localhost:8080/realms/zero-vault",
        ),
        help="Keycloak realm issuer URL.",
    )
    parser.add_argument(
        "--client-id",
        default=os.getenv("ZERO_VAULT_CLIENT_ID", "zero-vault-cli"),
        help="Keycloak direct access grant client.",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("ZERO_VAULT_USERNAME"),
        help="Keycloak username. Can also use ZERO_VAULT_USERNAME.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15,
        help="HTTP request timeout in seconds.",
    )

    args = parser.parse_args()

    if args.count <= 0:
        parser.error("count must be greater than zero")

    if args.timeout <= 0:
        parser.error("timeout must be greater than zero")

    username = args.username

    if not username:
        parser.error(
            "--username or the ZERO_VAULT_USERNAME environment variable is required"
        )

    password = os.getenv("ZERO_VAULT_PASSWORD")

    if password is None:
        password = getpass.getpass("Keycloak password: ")

    try:
        names = generate_folder_names(args.pattern, args.count)

        print("Obtaining access token...")
        access_token = obtain_access_token(
            issuer_url=args.issuer_url,
            client_id=args.client_id,
            username=username,
            password=password,
            timeout=args.timeout,
        )

        destination = args.parent_id or "root"
        print(f"Creating {args.count} folders in {destination}")

        for position, name in enumerate(names, start=1):
            folder = create_folder(
                api_url=args.api_url,
                access_token=access_token,
                name=name,
                parent_id=args.parent_id,
                timeout=args.timeout,
            )

            print(
                f"[{position}/{args.count}] "
                f"Created {folder.get('name')} ({folder.get('id')})"
            )

    except (RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())