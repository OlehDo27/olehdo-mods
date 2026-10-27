"""Проверить отчёт READINESS.md против каталога и файлов репозитория.

python validate.py --root <repo> [--report docs/READINESS.md] [--summary] [--fill-summary]

Проверяет: все пункты профилей на месте и по одному разу; статусы из списка;
«есть»/«частично» подкреплены ссылкой `путь:строка` (для пунктов check: ask —
ответом «Владелец: ...»); каждая ссылка указывает на существующий файл и строку
(в коммите commit= из заголовка, если он указан, иначе в рабочем дереве);
у «нет», «вопрос», «не проверено» и N/A заполнено пояснение.
Код выхода 1, если есть ошибки.
"""
import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

from catalog import SEVERITIES, SEVERITY_RU, STATUSES, load_items, parse_list, select


ap = argparse.ArgumentParser()
ap.add_argument("--root", default=".")
ap.add_argument("--report", default="docs/READINESS.md")
ap.add_argument("--summary", action="store_true", help="напечатать таблицу итогов в markdown")
ap.add_argument("--fill-summary", action="store_true", help="записать таблицу итогов в раздел «## Итоги» отчёта")
args = ap.parse_args()

root = Path(args.root).resolve()
report = (root / args.report) if not Path(args.report).is_absolute() else Path(args.report)
text = report.read_text(encoding="utf-8")

header = re.search(r"<!--\s*readiness-audit\b(.*?)-->", text, re.S)
if not header:
    sys.exit("нет заголовка <!-- readiness-audit profiles=... --> в отчёте")
meta = dict(re.findall(r"(\w+)=(\S+)", header.group(1)))
profiles = parse_list(meta.get("profiles"))
expected = {i["id"]: i for i in select(profiles)}
catalog = {i["id"]: i for i in load_items()}

REF = re.compile(r"`([^`]+):(\d+)(?:-(\d+))?`")
errors = []
rows = {}
line_counts = {}


commit = meta.get("commit")


def git(*a):
    return subprocess.run(["git", "-C", str(root), *a], capture_output=True, encoding="utf-8", errors="replace")


def file_lines(rel):
    """Число строк файла в коммите аудита (commit= в заголовке), иначе в рабочем дереве."""
    if rel not in line_counts:
        if commit:
            r = git("show", f"{commit}:{rel}")
            line_counts[rel] = len(r.stdout.splitlines()) if r.returncode == 0 else None
        else:
            p = root / rel
            line_counts[rel] = len(p.read_text(encoding="utf-8", errors="replace").splitlines()) if p.is_file() else None
    return line_counts[rel]


for n, line in enumerate(text.splitlines(), 1):
    if not line.startswith("|"):
        continue
    cells = [c.strip() for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
    item_id = cells[0].strip("` ")
    if item_id not in catalog:
        continue
    where = f"строка {n} ({item_id})"
    if len(cells) != 6:
        errors.append(f"{where}: ожидалось 6 колонок, найдено {len(cells)}")
        continue
    if item_id not in expected:
        errors.append(f"{where}: пункт не входит в профили {','.join(profiles)}")
        continue
    if item_id in rows:
        errors.append(f"{where}: пункт уже был в строке {rows[item_id]['line']}")
        continue
    _, _, _, status, evidence, todo = cells
    rows[item_id] = {"line": n, "status": status}
    if status not in STATUSES:
        errors.append(f"{where}: статус «{status}» не из {STATUSES}")
        continue

    refs = REF.findall(evidence)
    good_refs = 0
    for rel, a, b in refs:
        rel = rel.replace("\\", "/")
        count = file_lines(rel)
        if count is None:
            errors.append(f"{where}: файла нет: {rel}")
        elif int(a) < 1 or int(b or a) > count or int(b or a) < int(a):
            errors.append(f"{where}: {rel}:{a}{'-' + b if b else ''} вне файла ({count} строк)")
        else:
            good_refs += 1

    owner = "Владелец:" in evidence
    if status in ("есть", "частично"):
        if not good_refs and not (owner and catalog[item_id]["check"] == "ask"):
            errors.append(f"{where}: статус «{status}» без ссылки `путь:строка`")
    if status in ("частично", "нет", "вопрос") and not todo.strip(" -—"):
        errors.append(f"{where}: для «{status}» пуста колонка «Что сделать»")
    if status == "нет" and not evidence.strip(" -—"):
        errors.append(f"{where}: для «нет» в «Доказательствах» нужно написать, что и где искал")
    if status in ("не проверено", "N/A") and not (evidence.strip(" -—") or todo.strip(" -—")):
        errors.append(f"{where}: для «{status}» нужно пояснение (почему не проверено / почему не применим)")

missing = [i for i in expected if i not in rows]
for i in missing:
    errors.append(f"пункт {i} отсутствует в отчёте")

by_status = Counter(r["status"] for r in rows.values())
by_sev = {s: Counter() for s in SEVERITIES}
for i, r in rows.items():
    by_sev[expected[i]["severity"]][r["status"]] += 1

summary = ["| Важность | " + " | ".join(STATUSES) + " | Всего |", "|---|" + "---|" * (len(STATUSES) + 1)]
for s in SEVERITIES:
    c = by_sev[s]
    summary.append(f"| {SEVERITY_RU[s]} | " + " | ".join(str(c[x]) for x in STATUSES) + f" | {sum(c.values())} |")
summary.append("| **всего** | " + " | ".join(f"**{by_status[x]}**" for x in STATUSES) + f" | **{sum(by_status.values())}** |")

if args.fill_summary:
    filled, n = re.subn(r"(## Итоги\n\n).*?(\n\n## )", lambda m: m.group(1) + "\n".join(summary) + m.group(2), text, count=1, flags=re.S)
    if not n:
        errors.append("нет раздела «## Итоги», за которым следует другой раздел")
    else:
        report.write_text(filled, encoding="utf-8", newline="\n")
if args.summary:
    print("\n".join(summary))
if commit:
    changed = set(git("diff", "--name-only", commit).stdout.split()) & set(line_counts)
    if changed:
        print(f"внимание: после {commit} изменились процитированные файлы, номера строк в них относятся к {commit}: "
              + ", ".join(sorted(changed)), file=sys.stderr)
print(f"пунктов: {len(rows)}/{len(expected)}; " + ", ".join(f"{s}: {by_status[s]}" for s in STATUSES))

if errors:
    print(f"\nОШИБКИ ({len(errors)}):", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)
print("отчёт корректен", file=sys.stderr)
