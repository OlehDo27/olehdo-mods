"""Крупнейшие исходные файлы репозитория (только отслеживаемые git).

python big_files.py --root <repo> [--min 800] [--top 20]
"""
import argparse
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

SOURCE = {".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".cs", ".go", ".java", ".kt",
          ".swift", ".cpp", ".cc", ".c", ".h", ".hpp", ".gd", ".vue", ".svelte", ".css", ".scss"}
SKIP_PARTS = {"node_modules", "target", "dist", "build", "vendor", "third_party", "Library", "Packages"}

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=".")
ap.add_argument("--min", type=int, default=800)
ap.add_argument("--top", type=int, default=20)
args = ap.parse_args()

root = Path(args.root).resolve()
files = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True,
                       encoding="utf-8", check=True).stdout.splitlines()
sizes = []
for rel in files:
    p = Path(rel)
    if p.suffix not in SOURCE or SKIP_PARTS & set(p.parts) or ".min." in p.name:
        continue
    try:
        n = len((root / p).read_text(encoding="utf-8", errors="replace").splitlines())
    except OSError:
        continue
    if n >= args.min:
        sizes.append((n, rel))

sizes.sort(reverse=True)
print(f"файлов длиннее {args.min} строк: {len(sizes)}")
for n, rel in sizes[: args.top]:
    print(f"{n:6d}  {rel}")
