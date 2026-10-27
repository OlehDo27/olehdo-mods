"""Выбрать пункты каталога для профилей.

python select.py --list-profiles
python select.py --profiles desktop-tool,ai-feature [--areas data,text] [--format md|json|ids]
"""
import argparse
import json
import sys

from catalog import SEVERITY_RU, load_profiles, parse_list, select


ap = argparse.ArgumentParser()
ap.add_argument("--profiles")
ap.add_argument("--areas")
ap.add_argument("--format", choices=["md", "json", "ids"], default="md")
ap.add_argument("--list-profiles", action="store_true")
args = ap.parse_args()

conf = load_profiles()

if args.list_profiles:
    for name, p in conf["profiles"].items():
        print(f"{name} [{p['status']}] — {p['description']}")
        for hint in p.get("detect", []):
            print(f"    признак: {hint}")
    sys.exit(0)

if not args.profiles:
    ap.error("нужен --profiles или --list-profiles")

profiles = parse_list(args.profiles)
for p in profiles:
    if conf["profiles"].get(p, {}).get("status") == "planned":
        print(f"# внимание: профиль {p} ещё не наполнен пунктами", file=sys.stderr)
items = select(profiles, parse_list(args.areas))

if args.format == "json":
    print(json.dumps(items, ensure_ascii=False, indent=1))
elif args.format == "ids":
    print("\n".join(i["id"] for i in items))
else:
    print(f"# {len(items)} пунктов: профили {', '.join(profiles)}, каталог {conf['catalog_version']}\n")
    area = None
    for i in items:
        if i["area"] != area:
            area = i["area"]
            print(f"## {conf['areas'][area]} ({area})\n")
        print(f"### {i['id']} — {i['title']}")
        print(f"важность: {SEVERITY_RU[i['severity']]}; проверка: {i['check']}")
        if i.get("applies_if"):
            print(f"применим, если: {i['applies_if']}")
        print(f"зачем: {i['why']}")
        print("искать:")
        for x in i.get("look_for", []):
            print(f"  - {x}")
        if i.get("red_flags"):
            print("тревожные признаки:")
            for x in i["red_flags"]:
                print(f"  - {x}")
        print(f"доказательство: {i['evidence']}\n")
