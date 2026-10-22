# openrouter-statusbar

A minimal one-line status bar for [Pi](https://pi.dev). One file, zero dependencies, zero config.

```
../projects/my-app (main)          kimi-k2.6 · high · ━━━━━━━━━━────────── 52% · 11k/200k · $0.00/$3.41
```

## Why this one

Most status bars show you how much you have **used**. This one shows how much is **left** — OpenRouter account credit, live from the API — right next to the context window. When you are deciding whether to start one more long turn, what's left is the number that matters.

It is also deliberately tiny: a single TypeScript file, no build step, no runtime dependencies, no configuration required. If you have logged into OpenRouter through Pi, it works immediately.

## Install

```bash
pi install npm:openrouter-statusbar
```

Then restart Pi, or run `/statusbar-openrouter` to mount the bar in the current session.

## What it shows

| Segment | Meaning |
|---|---|
| `../projects/my-app` | Last two path segments of the session directory |
| `(main)` | Current git branch, hidden outside a repository |
| `kimi-k2.6` | Model, without the `provider/` prefix |
| `high` | Thinking level |
| `━━━━━━━━━━ 52%` | Context window usage |
| `11k/200k` | Context tokens used / context window |
| `$0.00/$3.41` | Session cost / OpenRouter credits remaining |

## Colour

Quiet by default, with one accent reserved for state:

| Element | Colour |
|---|---|
| Everything else | dim gray `#6b7280` |
| Directory | normal foreground (the only non-dim text) |
| `·` separators | one shade darker `#4b5563` |
| Context below 50% | dim gray |
| Context 50–80% | yellow |
| Context above 80% | red |

- `NO_COLOR` (set to a non-empty value) turns all colour off.
- Without truecolor support the bar falls back to 16-colour ANSI (`90`, `33`, `31`), which also reads correctly on 256-colour terminals.

## Formatting

- Tokens: `999`, `11k`, `1M`, `1.5M` — a decimal only below 10, and never a trailing `.0`.
- Money: 3 decimals below `$0.01`, otherwise 2 (`$0.003`, `$3.41`).
- Percent: whole numbers only.

## Credits

The remaining balance is read from `https://openrouter.ai/api/v1/credits` (cached for 60 seconds, refreshed after every agent turn). The API key is taken from:

1. the `OPENROUTER_API_KEY` environment variable, or
2. Pi's own auth store (`~/.pi/agent/auth.json`), which is populated by `/login`.

The second source means there is nothing to configure: if Pi can talk to OpenRouter, the bar can show the balance. If no key is found, the balance shows as `$?`.

## Command

| Command | Effect |
|---|---|
| `/statusbar-openrouter` | Re-mount the bar and force a credits refresh |

## License

MIT
