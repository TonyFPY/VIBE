"""Create 512-pixel JPEG web stimuli and a matching DreamSim CSV manifest."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from tqdm import tqdm


DATA_DIR = Path(__file__).parent
DEFAULT_CSV_PATH = DATA_DIR / "data_100.csv"
DEFAULT_SOURCE_ROOT = DATA_DIR
DEFAULT_OUTPUT_ROOT = DATA_DIR.parent.parent / "public" / "data" / "dreamsim_100"
DEFAULT_OUTPUT_CSV_PATH = DEFAULT_OUTPUT_ROOT / "data_100_web.csv"
PATH_COLUMNS = ("ref_path", "left_path", "right_path")
PUBLIC_ASSET_PREFIX = "/data/dreamsim_100"
MAX_EDGE_PX = 512


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV_PATH)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Validate sources without writing files.")
    return parser.parse_args()


def validate_relative_path(value: str) -> Path:
    path = Path(value)
    if not value or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe image path: {value!r}")
    return path


def output_relative_path(relative_path: Path) -> Path:
    return relative_path.with_suffix(".jpg")


def public_output_path(relative_path: Path) -> str:
    return f"{PUBLIC_ASSET_PREFIX}/{output_relative_path(relative_path).as_posix()}"


def read_csv_rows(csv_path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        if not reader.fieldnames or not set(PATH_COLUMNS).issubset(reader.fieldnames):
            raise ValueError(f"CSV must contain: {', '.join(PATH_COLUMNS)}")
        rows = list(reader)
        for row in rows:
            for column in PATH_COLUMNS:
                validate_relative_path(row[column])
        return list(reader.fieldnames), rows


def unique_image_paths(rows: list[dict[str, str]]) -> list[Path]:
    return sorted({validate_relative_path(row[column]) for row in rows for column in PATH_COLUMNS})


def to_rgb(image: Image.Image) -> Image.Image:
    if image.mode == "RGBA":
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        return background
    if image.mode != "RGB":
        return image.convert("RGB")
    return image.copy()


def convert_image(relative_path: Path, source_root: Path, output_root: Path) -> Path:
    source_path = source_root / relative_path
    if not source_path.is_file():
        raise FileNotFoundError(f"Referenced image is missing: {source_path}")
    destination_relative_path = output_relative_path(relative_path)
    destination_path = output_root / destination_relative_path
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(source_path) as source_image:
            image = to_rgb(source_image)
    except UnidentifiedImageError as error:
        raise ValueError(f"Referenced image is unreadable: {source_path}") from error
    image.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.Resampling.LANCZOS)
    image.save(destination_path, "JPEG", quality=100, optimize=True)
    return destination_relative_path


def write_rewritten_csv(
    fieldnames: list[str], rows: list[dict[str, str]], output_csv_path: Path
) -> None:
    output_csv_path.parent.mkdir(parents=True, exist_ok=True)
    with output_csv_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            rewritten_row = row.copy()
            for column in PATH_COLUMNS:
                rewritten_row[column] = public_output_path(validate_relative_path(row[column]))
            writer.writerow(rewritten_row)


def main() -> None:
    arguments = parse_arguments()
    fieldnames, rows = read_csv_rows(arguments.csv)
    image_paths = unique_image_paths(rows)
    if arguments.dry_run:
        for relative_path in tqdm(image_paths, desc="Validating images", unit="image"):
            source_path = arguments.source_root / relative_path
            if not source_path.is_file():
                raise FileNotFoundError(f"Referenced image is missing: {source_path}")
        print(f"Validated {len(image_paths)} unique images; no files written.")
        return

    for relative_path in tqdm(image_paths, desc="Converting images", unit="image"):
        convert_image(relative_path, arguments.source_root, arguments.output_root)
    write_rewritten_csv(fieldnames, rows, arguments.output_csv)
    print(f"Converted {len(image_paths)} unique images to {arguments.output_root}")
    print(f"Wrote rewritten CSV to {arguments.output_csv}")


if __name__ == "__main__":
    main()
