#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from pathlib import Path
from typing import BinaryIO


CHUNK_SIZE = 1024 * 1024  # 1 MiB

SIZE_UNITS = {
    "b": 1,
    "kb": 1_000,
    "mb": 1_000_000,
    "gb": 1_000_000_000,
    "kib": 1024,
    "mib": 1024**2,
    "gib": 1024**3,
}


def parse_size(value: str) -> int:
    """
    Convert values such as:
      500
      500B
      10MB
      10MiB
      1.5GB
    into bytes.
    """
    match = re.fullmatch(
        r"\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*",
        value,
    )

    if not match:
        raise argparse.ArgumentTypeError(
            f"Invalid size: {value!r}. Examples: 500B, 10MB, 10MiB, 1GB."
        )

    number_text, unit = match.groups()
    unit = unit.lower() or "b"

    if unit not in SIZE_UNITS:
        valid_units = ", ".join(SIZE_UNITS)
        raise argparse.ArgumentTypeError(
            f"Unsupported size unit {unit!r}. Supported units: {valid_units}."
        )

    size = int(float(number_text) * SIZE_UNITS[unit])

    if size < 0:
        raise argparse.ArgumentTypeError("File size cannot be negative.")

    return size


def generate_filenames(pattern: str, count: int) -> list[str]:
    """
    Supported placeholders:
      {i}       - zero-based file index
      {number}  - one-based file number
      {n}       - total number of files

    Example:
      backup_{number:04d}_of_{n:04d}.bin
    """
    filenames: list[str] = []

    for index in range(count):
        try:
            filename = pattern.format(
                i=index,
                number=index + 1,
                n=count,
            )
        except (KeyError, IndexError, ValueError) as error:
            raise ValueError(f"Invalid filename pattern: {error}") from error

        # Intentionally disallow paths in the pattern. This prevents a pattern
        # from writing outside the selected output directory.
        if not filename or filename in {".", ".."}:
            raise ValueError("The filename pattern produced an invalid filename.")

        if Path(filename).name != filename or "/" in filename or "\\" in filename:
            raise ValueError(
                "The pattern must produce filenames only, not directory paths."
            )

        filenames.append(filename)

    if len(set(filenames)) != len(filenames):
        raise ValueError(
            "The filename pattern produced duplicate names. "
            "Include {i} or {number} in the pattern."
        )

    return filenames


def write_file(
    file: BinaryIO,
    size: int,
    random_data: bool,
) -> None:
    zero_chunk = b"\0" * min(CHUNK_SIZE, max(size, 1))
    remaining = size

    while remaining > 0:
        current_size = min(CHUNK_SIZE, remaining)

        if random_data:
            chunk = os.urandom(current_size)
        else:
            chunk = zero_chunk[:current_size]

        file.write(chunk)
        remaining -= current_size


def create_file(
    target: Path,
    size: int,
    random_data: bool,
    overwrite: bool,
) -> None:
    if target.exists() and not overwrite:
        raise FileExistsError(
            f"{target} already exists. Use --overwrite to replace it."
        )

    temporary = target.with_name(
        f".{target.name}.{uuid.uuid4().hex}.part"
    )

    try:
        with temporary.open("xb") as file:
            write_file(file, size, random_data)

            # Ensure buffered data is handed to the operating system before rename.
            file.flush()
            os.fsync(file.fileno())

        if overwrite:
            os.replace(temporary, target)
        else:
            # Avoid silently replacing a file created by another process while
            # this file was being generated.
            temporary.rename(target)

    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate multiple files with a specified name and size."
    )

    parser.add_argument(
        "directory",
        type=Path,
        help="Directory in which the files will be created.",
    )
    parser.add_argument(
        "count",
        type=int,
        help="Number of files to create.",
    )
    parser.add_argument(
        "pattern",
        help=(
            "Filename pattern, for example 'test_{number:04d}.bin'. "
            "Available placeholders: {i}, {number}, and {n}."
        ),
    )
    parser.add_argument(
        "size",
        type=parse_size,
        help="Size of each file, for example 10MB, 10MiB, or 1GB.",
    )
    parser.add_argument(
        "--random",
        action="store_true",
        help="Write cryptographically random data instead of zero bytes.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing files with matching names.",
    )

    args = parser.parse_args()

    if args.count <= 0:
        parser.error("count must be greater than zero")

    output_directory: Path = args.directory.expanduser().resolve()

    try:
        output_directory.mkdir(parents=True, exist_ok=True)

        if not output_directory.is_dir():
            raise NotADirectoryError(
                f"{output_directory} is not a directory."
            )

        filenames = generate_filenames(args.pattern, args.count)

        total_size = args.size * args.count
        print(
            f"Creating {args.count} files in {output_directory}\n"
            f"Size per file: {args.size:,} bytes\n"
            f"Total data: {total_size:,} bytes"
        )

        for position, filename in enumerate(filenames, start=1):
            target = output_directory / filename

            create_file(
                target=target,
                size=args.size,
                random_data=args.random,
                overwrite=args.overwrite,
            )

            print(f"[{position}/{args.count}] Created {target.name}")

    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())