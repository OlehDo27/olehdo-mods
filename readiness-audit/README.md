# readiness-audit

Аудит «что мы забыли перед реальными пользователями». Каталог пунктов с тегами профилей; скилл `/readiness-audit:audit` проходит по каждому пункту, ищет в коде доказательства (`путь:строка`) и пишет `docs/READINESS.md`. Валидатор не даёт поставить «есть» без ссылки на реальную строку.

## Запуск

```
/readiness-audit:audit
/readiness-audit:audit desktop-tool,ai-feature
```

Нужен Python 3 с PyYAML.

## Устройство

- `profiles.yaml` — профили (desktop-tool, ai-feature готовы; game, infra, web-saas запланированы) и порядок разделов.
- `catalog/*.yaml` — пункты. Схема описана в начале `catalog/desktop-tool.yaml`.
- `scripts/select.py` — выбрать пункты для профилей.
- `scripts/validate.py` — проверить отчёт: полнота, статусы, существование файлов и строк в ссылках.
- `scripts/big_files.py` — крупнейшие исходники (для `maint-big-files`).
- `skills/audit/` — скилл и шаблон отчёта.

## Как добавить пункт или профиль

Пункт — новая запись в `catalog/*.yaml` с уникальным `id` (id не переименовывать: по ним сверяются старые отчёты). Профиль — запись в `profiles.yaml` со `status: ready` и пункты с этим профилем в `profiles: [...]`. После правки: `python scripts/select.py --profiles <профиль>`.
