# olehdo-mods

Личный маркетплейс плагинов Claude Code.

| Плагин | Что делает |
|---|---|
| `pult` | Пульт сессии: порог автокомпакта, лимиты Claude и Codex, модель и усилие сабагентов по типам задач, модель и задачи Codex — в панели рядом с чатом и строке над вводом |
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

Обновить до свежей версии: `claude plugin marketplace update olehdo-mods`, затем `claude plugin update pult@olehdo-mods`.

## Сабагенты в пульте

Карточка «Сабагенты» и команда `/subagents` задают модель и усилие по типу работы:

| Тип | Кого касается | По умолчанию |
|---|---|---|
| `scout` | `Explore` | Sonnet, low |
| `plan` | `Plan` | Opus, high |
| `code` | `general-purpose`, `claude`, агенты в worktree | Sonnet, high |
| `review` | `pult:review` | Opus, high |
| `mech` | `pult:mech` | Haiku, low |
| `other` | остальные типы, например `codex:codex-rescue` | как есть |
| `session` | новые сессии приложения | Sonnet, high |

Примеры: `/subagents scout haiku low`, `/subagents off`, `/subagents default`.

Модель, названная в самом вызове, важнее правила. Форк всегда идёт на модели родителя. Новая сессия не поднимется выше модели и усилия текущей.

`readiness-audit` требует Python 3 с PyYAML (`python -m pip install pyyaml`).
