# Claude usage tracking for the account switcher

Plan usage for setup-token accounts comes from a 1-token probe, not from `/api/oauth/usage`; the binding contract is `claude-account-switcher/usage/CONTRACT.md`.

Verified 2026-11-04 against 3165b22f plus the uncommitted change that added `claude-account-switcher/usage/`.

- `/api/oauth/usage` refuses `claude setup-token` tokens (403, scope `user:profile`). Every `/v1/messages` reply carries `anthropic-ratelimit-unified-{5h,7d}-{utilization,reset,status}`, so the probe is one Haiku message with `max_tokens: 1`.
- A setup token is accepted only with Claude Code's system prompt ("You are Claude Code, Anthropic's official CLI for Claude."). Without it: HTTP 429 `rate_limit_error` "Error" and no usage headers, which is not a real limit.
- Claude Code keeps a usage cache in its global config (`cachedUsageUtilization` in `~/.claude.json`); the VS Code extension yahyashareef.claude-code-usage-tracker reads it before asking the API. Writing it means Claude Code's lock protocol (directory `<config>.lock`, re-read under it, change one key, atomic replace); details and measurements in the contract.
- In that file use only exact-key JSON calls (`json.Node.member/memberCount/remove`): `claude.set/get` in stdlib/claude match keys ignoring case.
