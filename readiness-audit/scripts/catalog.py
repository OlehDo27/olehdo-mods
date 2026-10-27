"""Загрузка каталога пунктов и профилей readiness-audit."""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("readiness-audit: нужен PyYAML (python -m pip install pyyaml)")

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
STATUSES = ["есть", "частично", "нет", "не проверено", "вопрос", "N/A"]
SEVERITIES = ["critical", "high", "medium", "low"]
SEVERITY_RU = {"critical": "критично", "high": "высоко", "medium": "средне", "low": "низко"}


def load_profiles():
    with open(PLUGIN_ROOT / "profiles.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_items():
    items = []
    seen = set()
    for path in sorted((PLUGIN_ROOT / "catalog").glob("*.yaml")):
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        for item in data.get("items", []):
            if item["id"] in seen:
                sys.exit(f"readiness-audit: повторяющийся id {item['id']} в {path.name}")
            seen.add(item["id"])
            items.append(item)
    return items


def parse_list(value):
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def select(profiles, areas=None):
    """Пункты для набора профилей в порядке разделов, затем каталога."""
    conf = load_profiles()
    known = conf["profiles"]
    unknown = [p for p in profiles if p not in known]
    if unknown:
        sys.exit(f"readiness-audit: неизвестные профили: {', '.join(unknown)}; есть: {', '.join(known)}")
    order = list(conf["areas"])
    chosen = [
        i for i in load_items()
        if set(i["profiles"]) & set(profiles) and (not areas or i["area"] in areas)
    ]
    chosen.sort(key=lambda i: order.index(i["area"]))
    return chosen
