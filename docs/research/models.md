# LLM model ids: verification

Read on **2026-11-07**.

Sources:
- Anthropic: https://docs.claude.com/en/docs/about-claude/models, which 302-redirects to https://platform.claude.com/docs/en/about-claude/models (*Models overview*)
- OpenAI: https://developers.openai.com/api/docs/models
- Google: https://ai.google.dev/gemini-api/docs/models, which 301-redirects to https://aistudio.google.com/docs/models; release and shutdown dates are from https://aistudio.google.com/docs/deprecations

## Verdict per proposed id

| Tier | Proposed id | Exists? | Status / notes |
|---|---|---|---|
| Heavy | `claude-opus-5-5` | ✅ | Claude API ID and alias `claude-opus-5-5`. $4 / $20 per MTok, 1M context, 128K max output, default effort `medium`, retirement not sooner than 2027-09-22. Anthropic says "start with Claude Opus 5.5 for most workloads". A higher tier exists: `claude-fable-5-1` ($10 / $50), for "demanding reasoning and long-horizon agentic work". |
| Heavy | `gpt-6-astra` | ✅ | "Our most capable model for the most demanding work." $10 / $50 per MTok. No deprecation note. |
| Heavy | `gemini-3.1-pro-preview` | ✅ but ⚠️ | Listed in the Gemini 3 table, **preview**, released 2026-02-19, no shutdown date announced. **It is no longer Google's top model:** `gemini-4-argon` is listed first as "Our flagship reasoning model" (it has no row on the deprecations page). For production, consider `gemini-4-argon`, or `gemini-3.8-flash` if you need a stable, dated model. Preview models can change or be shut down at short notice, as `gemini-3-pro-preview` already has been. |
| Standard | `claude-sonnet-5-5` | ✅ | $2 / $10, "The best combination of speed and intelligence". Retirement not sooner than 2027-09-28. |
| Standard | `gpt-6.1-sol` | ✅ | "Near-Astra performance for complex work at a lower cost." $2 / $10. (`gpt-6.1-terra` at $1 / $5 also exists, between Sol and Luna.) |
| Standard | `gemini-3.8-flash` | ✅ | Badge "New", released 2026-09-02, no shutdown date. "Our most intelligent Flash model…". Google will also route deprecated `gemini-2.5-pro` traffic to it on 2026-12-01. |
| Light | `claude-haiku-5-5` | ✅ | "From $0.10 / $0.50", "For high-volume, latency-sensitive tasks such as classification, extraction, and routing". Retirement not sooner than 2027-10-07. |
| Light | `gpt-6-luna` | ✅ | "Our most efficient model for focused, high-volume tasks." $0.10 / $0.50. |
| Light | `gemini-3.5-flash-lite` | ✅ | **Stable**, released 2026-07-21, no shutdown date. "Our fastest, most cost-effective 3.5 model for high-throughput execution." |

## Corrections / recommendations

1. All nine ids are valid strings today. None is deprecated.
2. **Heavy / Gemini:** `gemini-3.1-pro-preview` is a 9-month-old *preview*. Replace it with `gemini-4-argon`, Google's current flagship (but check its page for status before committing), or accept the preview risk and keep a config-driven fallback.
3. Consider adding `claude-fable-5-1` as an optional "max" tier. It is not needed for an MVP.
4. Keep model ids in config or env, not code, so a retirement means changing config, not redeploying code.
