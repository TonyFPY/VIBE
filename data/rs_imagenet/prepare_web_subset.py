"""Copy Object Matching stimuli used by data_100.csv into a deployable subset."""

from __future__ import annotations

import argparse
import csv
import shutil
from pathlib import Path

from tqdm import tqdm


DATA_DIR = Path(__file__).parent
DEFAULT_CSV_PATH = DATA_DIR / "data_100.csv"
DEFAULT_SOURCE_ROOT = DATA_DIR
DEFAULT_OUTPUT_ROOT = DATA_DIR.parent / "rs_imagenet_100"
DEFAULT_OUTPUT_CSV_PATH = DEFAULT_OUTPUT_ROOT / "data_web_100.csv"
PUBLIC_ASSET_PREFIX = "/data/rs_imagenet_100"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV_PATH)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Validate sources without copying files.")
    return parser.parse_args()


def validate_relative_path(value: str) -> Path:
    path = Path(value)
    if not value or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe image path: {value!r}")
    return path


def read_csv_rows(csv_path: Path) -> tuple[list[str], list[dict[str, str]], tuple[str, ...]]:
    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        if not reader.fieldnames or "reference" not in reader.fieldnames:
            raise ValueError("CSV must contain a reference column")
        candidate_columns = tuple(
            column for column in reader.fieldnames if column.startswith("candidate_")
        )
        if len(candidate_columns) != 8:
            raise ValueError("CSV must contain candidate_0 through candidate_7")
        path_columns = ("reference", *candidate_columns)
        rows = list(reader)
        for row in rows:
            for column in path_columns:
                validate_relative_path(row[column])
        return list(reader.fieldnames), rows, path_columns


def unique_image_paths(rows: list[dict[str, str]], path_columns: tuple[str, ...]) -> list[Path]:
    return sorted({validate_relative_path(row[column]) for row in rows for column in path_columns})


def copy_images(
    rows: list[dict[str, str]],
    path_columns: tuple[str, ...],
    source_root: Path,
    output_root: Path,
) -> int:
    copied = 0
    for relative_path in tqdm(unique_image_paths(rows, path_columns), desc="Copying images", unit="image"):
        source_path = source_root / relative_path
        destination_path = output_root / relative_path
        if destination_path.is_file():
            continue
        if not source_path.is_file():
            raise FileNotFoundError(f"Referenced image is missing: {source_path}")
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)
        copied += 1
    return copied


def write_rewritten_csv(
    fieldnames: list[str],
    rows: list[dict[str, str]],
    path_columns: tuple[str, ...],
    output_csv_path: Path,
) -> None:
    output_csv_path.parent.mkdir(parents=True, exist_ok=True)
    with output_csv_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            rewritten_row = row.copy()
            for column in path_columns:
                rewritten_row[column] = (
                    f"{PUBLIC_ASSET_PREFIX}/{validate_relative_path(row[column]).as_posix()}"
                )
            writer.writerow(rewritten_row)


def main() -> None:
    arguments = parse_arguments()
    fieldnames, rows, path_columns = read_csv_rows(arguments.csv)
    image_paths = unique_image_paths(rows, path_columns)
    if arguments.dry_run:
        for relative_path in tqdm(image_paths, desc="Validating images", unit="image"):
            if not (arguments.source_root / relative_path).is_file():
                raise FileNotFoundError(
                    f"Referenced image is missing: {arguments.source_root / relative_path}"
                )
        print(f"Validated {len(image_paths)} unique images; no files copied.")
        return

    copied = copy_images(rows, path_columns, arguments.source_root, arguments.output_root)
    write_rewritten_csv(fieldnames, rows, path_columns, arguments.output_csv)
    print(f"Copied {copied} images to {arguments.output_root}")
    print(f"Wrote rewritten CSV to {arguments.output_csv}")


if __name__ == "__main__":
    main()
