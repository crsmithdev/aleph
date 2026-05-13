# AI-driven hairstyle preview pipeline

Personal, not a Construct feature. Saving so the pipeline can be re-run later
without re-researching.

## Recommended pipeline (free, ~15 min)

1. **Capture**: front, left 3/4, right 3/4 photos in window light.
2. **Assess** (any multimodal LLM — Gemini, Claude, ChatGPT):
   > "You are a senior hairstylist. From these three photos, analyze face shape,
   > forehead height, jaw width, hairline, and current hair texture/density.
   > Recommend 8 hairstyles (mix of conservative + bold) and 4 hair colors that
   > would suit me, with one-line rationale per recommendation."
3. **Generate, 9-up grid** (Nano Banana 2 / Gemini 3.1 Flash Image, free in app):
   > "Generate a 1:1 grid of 9 distinct hairstyles on this person: [list 9 from
   > Step 2]. Keep face, expression, skin tone, lighting, outfit, and background
   > identical to the original. Match each style to my head shape — warp,
   > shadow, and anchor the hair naturally. Label each style."
4. **Color sweep**: second grid for the top 2 styles × 4 colors.
5. **Pick 2 final, bring to stylist as reference.**

Nano Banana 2 reports ~95% character consistency, 1–5s generation, and a
reasoning pass for gravity/volume/lighting that beats Flux Kontext on speed and
identity preservation.

## Cost compare

| Tool | Cost | Notes |
|---|---|---|
| Nano Banana 2 (Gemini app) | $0 | Free, fastest path |
| Nano Banana 2 (API) | cents/image | Fine for scripted batches |
| FLUX.1 Kontext [pro] | $0.04/image | More edit precision, less id consistency |
| FLUX.1 Kontext [dev] | $0.025/megapixel | Cheapest paid |
| GPT-Image | ~same order | |
| Consumer apps | $5–15/mo | YouCam, HaircutAI, Fotor |

## Alternatives if no prompting wanted

- **HaircutAI** — 180+ styles, 68-point face analysis, 4 recs in 30s, free tier.
- **YouCam / Perfect Corp** — 60+ styles, 150+ colors, instant template render.
- **Fotor** — neural rendering, paid.

## Maximum-control DIY

ComfyUI + InstantID (face-ID ControlNet locks identity) + ComfyUI_StableHair_ll
(hair transfer that preserves face/background). Local, free, but workflow to
set up.
