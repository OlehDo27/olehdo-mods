# olehdo-mods

Личный маркетплейс плагинов Claude Code.

| Плагин | Что делает |
|---|---|
| `pult` | Пульт сессии: порог автокомпакта, лимиты Claude и Codex, модель и задачи Codex — в панели рядом с чатом и строке над вводом |
| `readiness-audit` | Аудит готовности продукта по каталогу пунктов с доказательствами `путь:строка` и отчётом в `docs/READINESS.md` (`/readiness-audit:audit`) |

## Установка

С GitHub:

```
claude plugin marketplace add OlehDo27/olehdo-mods
claude plugin install readiness-audit@olehdo-mods
claude plugin install pult@olehdo-mods
```

С git.simirials.com (нужен доступ к репозиторию):

```
claude plugin marketplace add https://git.simirials.com/oleg/olehdo-mods.git
```

Обновить до свежей версии: `claude plugin marketplace update olehdo-mods`.

`readiness-audit` требует Python 3 с PyYAML (`python -m pip install pyyaml`).
