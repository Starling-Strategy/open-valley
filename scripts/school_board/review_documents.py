"""Screen local documents in memory; persist counts and locators, never excerpts.

PDF review requires PyMuPDF. Optional OCR uses Tesseract via stdin/stdout.
Keyword hits need contextual review; no automatic content deletion occurs here.
"""
import argparse
import fcntl
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile
from xml.etree import ElementTree

PATTERNS = {
    "closed": r"executive\s+session|closed[-\s]+(?:session|door)|\bcaucus\b",
    "negotiations": r"negotiat\w*|collective\s+bargain\w*|bargaining",
    "confidential": r"confidential|privileg\w*|attorney.client",
    "salary": r"salar\w*|wage\w*|compensation|union",
    "retrospective": r"(?:discussed|said|stated|during|in|at)\s+(?:the\s+)?executive\s+session",
}
# Bump the version when extraction/OCR behavior changes beyond these patterns.
ANALYSIS_ID = hashlib.sha256(json.dumps({"version": 1, "patterns": PATTERNS}, sort_keys=True).encode()).hexdigest()


def ocr_page(page, executable):
    import pymupdf

    scale = min(1.5, (4_000_000 / (page.rect.width * page.rect.height)) ** 0.5)
    image = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY)
    process = subprocess.run(
        [executable, "stdin", "stdout", "--psm", "3"],
        input=image.tobytes("png"), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={**os.environ, "OMP_THREAD_LIMIT": "1"}, timeout=30, check=True,
    )
    return process.stdout.decode(errors="replace")


def scan(job):
    path, root, aliases, digest, tesseract = job
    row = {"path": str(path.relative_to(root)), "aliases": aliases, "sha256": digest, "analysis_id": ANALYSIS_ID,
           "pages": 0, "ocr_enabled": bool(tesseract), "ocr_pages": 0, "low_text_pages": [], "errors": [], "matches": []}

    def screen(text, page, method="native"):
        counts = {name: len(re.findall(pattern, text, re.I)) for name, pattern in PATTERNS.items()}
        if counts["closed"] or counts["confidential"] and counts["negotiations"]:
            row["matches"].append({"page": page, "method": method, "counts": counts})

    try:
        if path.suffix.lower() == ".pdf":
            import pymupdf

            with pymupdf.open(path) as document:
                row["pages"] = len(document)
                for number, page in enumerate(document, 1):
                    text = page.get_text()
                    method = "native"
                    if len(text.strip()) < 40 and tesseract:
                        try:
                            text = ocr_page(page, tesseract)
                            row["ocr_pages"] += 1
                            method = "ocr"
                        except (subprocess.SubprocessError, RuntimeError) as error:
                            row["errors"].append({"page": number, "type": type(error).__name__})
                    if len(text.strip()) < 40:
                        row["low_text_pages"].append(number)
                    screen(text, number, method)
        elif path.suffix.lower() in {".docx", ".xlsx", ".pptx"}:
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    if name.endswith(".xml"):
                        tree = ElementTree.fromstring(archive.read(name))
                        screen(" ".join(tree.itertext()), name)
        else:
            screen(re.sub(r"<[^>]+>", " ", path.read_text(errors="replace")), 1)
    except Exception as error:
        row["errors"].append({"type": type(error).__name__})
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tesseract", help="OCR low-text PDF pages using this executable")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    lock = args.output.with_suffix(args.output.suffix + ".lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("Another review process is writing this report")
    root = args.root.resolve()
    groups = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink() and (
            path.suffix.lower() in {".pdf", ".docx", ".xlsx", ".pptx"}
            or path.suffix.lower() == ".html" and "supplements" in path.parts
        ):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            groups.setdefault(digest, []).append(path)
    previous = {}
    if args.resume and args.output.exists():
        for line in args.output.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # Re-screen an interrupted final record.
            if not row["errors"]:
                previous[row["path"]] = row
    jobs = []
    retained = []
    for digest, paths in groups.items():
        aliases = [str(p.relative_to(root)) for p in paths[1:]]
        old = previous.get(str(paths[0].relative_to(root)))
        if old and old.get("sha256") == digest and old.get("analysis_id") == ANALYSIS_ID and (not args.tesseract or old.get("ocr_enabled") or not old.get("low_text_pages")):
            retained.append({**old, "aliases": aliases})
        else:
            jobs.append((paths[0], root, aliases, digest, args.tesseract))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w") as output, ProcessPoolExecutor(max_workers=args.workers) as pool:
        for row in retained:
            output.write(json.dumps(row) + "\n")
        for future in as_completed([pool.submit(scan, job) for job in jobs]):
            output.write(json.dumps(future.result()) + "\n")
            output.flush()
    print(json.dumps({"unique_documents": len(groups), "physical_documents": sum(map(len, groups.values())),
                      "resumed": len(retained), "screened": len(jobs), "ocr_enabled": bool(args.tesseract)}))


if __name__ == "__main__":
    main()
