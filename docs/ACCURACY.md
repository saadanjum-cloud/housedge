# Measuring what AI says about a brand: research and the Housedge method

Written for the CTO. Covers what the published research and the commercial tools say about measuring AI
answers, what Housedge did before, what it does now (`server/extract.js`), and how to prove the accuracy
number before quoting it to a client. Sources are at the end; findings that come from vendor blogs are marked.

## 1. What the field measures

Every tool and paper converges on the same small set of numbers. The names differ.

| Number | Meaning | Also called |
|---|---|---|
| **Visibility** | % of answers in which the brand appears at all | mention rate, share of answer, BRP@k (prevalence) |
| **Recommendation rate** | % of answers that actively suggest the brand, not merely name it | - |
| **Prominence** | How high up the brand is when the answer ranks options | position, MRR@k, position-adjusted word count |
| **Share of voice** | Brand mentions ÷ all brand mentions in the same answers | competitive share |
| **Citation rate** | % of answers that link to a site the brand owns | - |
| **Sentiment** | How the answer portrays the brand | perception, tone |

Two points from the research that the commercial tools mostly skip:

1. **Prominence must come from a real ranking.** The brand-retrieval paper defines prominence as the
   reciprocal of the brand's rank in the answer's list, averaged over repeats (MRR). The GEO paper weights
   by position with exponential decay. Neither uses "order of first mention in prose", which is what
   Housedge's old code did. Prose order is not a rank.
2. **Single answers are not measurements.** See §3.

Ahrefs describes its own numbers as "directional, modeled signals rather than exact traffic counts".
Semrush does not publish the formula for its visibility score. No vendor publishes an accuracy figure for
its mention detection; one competitor-run audit claims Ahrefs found 3 ChatGPT mentions where a manual
check found 123 (treat as one data point from a hostile source).

## 2. How mentions are detected, and why counting fails

**The old Housedge method** ([analysis.js](../server/analysis.js)): exact word match against the tracked
brands plus a hard-coded library of ~140 gambling brands; sentiment from a list of ~80 positive and
negative words in four languages; position = order of first appearance; sources classified by a
hard-coded list of casino review sites.

What the research says about that approach:

- **Substring and word-list matching produce false brands.** The Dice Roll reanalysis found a published
  study's dictionary count had matched "away" and "ember" inside longer words, and counted the word
  "Research" as a brand mention; after correction, one brand's count fell from 2,912 to 437 answers.
  Their protocol now requires word-boundary matching with curated alias dictionaries.
- **Common-word brand names need an anchor.** Practitioner audits (vendor sources) list the failure
  classes: lexical collisions (a brand that is also a noun, surname or acronym), negated mentions
  ("not X"), quotation artifacts (the model repeating a review without endorsing it), and competitor
  confusion. The recommended fix is to count a hit only when a domain, product or checkable claim
  confirms the entity, and to separate *detection* (is the string there) from *resolution* (which
  company is meant).
- **Word-list sentiment cannot read negation or contrast.** "Nike is not cheap, but the quality holds
  up" scores negative on a word list. Zero-shot LLMs do aspect-level sentiment reasonably (below
  fine-tuned specialist models, but fine for multilingual use), and simpler prompts beat elaborate ones.
- **LLM judges agree with humans about as well as humans agree with each other.** Across QA, UX and
  quality-labelling studies, judge-to-human Cohen's kappa runs 0.4 to 0.93 depending on task; human-human
  kappa on the same subjective tasks is 0.58 to 0.72. One paper notes kappa itself is an imperfect
  alignment metric. So: an LLM reader is good enough, *if* its output is checked and its accuracy is
  measured on a labelled sample, not assumed.
- **LLM extraction invents evidence unless forced not to.** The grounded-extraction literature (LMDX,
  SCOPE, financial fact-ledger, trait-extraction papers) converges on one pattern: require a verbatim
  quote per extracted value, check mechanically that the quote is an exact substring of the source,
  and drop anything that fails. They also note the limit: a verbatim quote proves the quote exists,
  not that it supports the value. A separate check on a labelled sample covers that.

## 3. Repeats: how many runs a question needs

This is the largest accuracy problem and the one the old dashboard ignored.

- **Conductor study** (vendor, 14,000 API calls, 50 runs per prompt, four engines): the set of brands
  named in two runs of the *same* prompt overlaps only 40% for purchase prompts and 63% for comparison
  prompts (Jaccard). The leading brand is the same in 91% of comparison runs but only 59% of purchase
  runs and 30% of educational runs. Gemini is the least consistent engine, Perplexity the most.
- **Dice Roll Method** (arXiv:2609.04047 v2, reanalysis of ~190,000 observations): in a 250-question
  study across 3 models, the (model × question) cell explains 84% of total variance and run-to-run
  noise 16%. Reliability G is 0.96 at five runs and reaches 0.80 at one to two runs *within a model*
  when the questions differ. But for five phrasings of one question on one model, G at five runs is only
  0.27, so no fixed run count fits every case. The rule they validate on three external corpora:
  **run a ~10-iteration pilot, estimate within-cell (noise) and between-cell (signal) variance, and take
  n = 4·noise/signal for G = 0.80 (9·noise/signal for G = 0.90).** Precision of the mean improves as
  1/√n: 80% of the n=10 precision is reached at n=7. Detecting a *change* needs far more runs than
  estimating a level: 80% power for a large effect needs 15-25 runs per cell, a medium effect 30+.
- **Brand retrieval paper** (arXiv:2609.16304): 40 stateless sessions per category per model; concludes
  LLM recommendations must be evaluated "as a stochastic process rather than from single generated
  lists".
- **Drift:** model providers change inference infrastructure without changing the version string. The
  protocol logs model id and date on every call and tests for drift (Kolmogorov-Smirnov across time
  windows) rather than assuming stability.

Consequence for Housedge: a daily run *is* a repeat. Thirty daily answers to one question on one engine
is a cell of n=30. The dashboard must report the interval around a percentage, and call a change real
only when intervals do not overlap. Both are now in `server/stats.js` (`wilson`, `changeIsReal`), and
`varianceComponents` + `runsNeeded` implement the pilot rule so the team can decide, per client, how
many runs a report needs.

## 4. The Housedge method now

One algorithm for every industry. No brand library, no word lists, no casino-site list in the reading step.

```
answer text ──► 1. extract (Claude, fixed JSON, no tools, answer wrapped as untrusted data)
            ──► 2. verify  (mechanical: quote must be verbatim in the answer and must name the entity;
                            rank accepted only when the answer is a ranked list; failures dropped and counted)
            ──► 3. resolve (deterministic: name / alias / legal-suffix / domain match to tracked brands;
                            unmatched company names become competitor suggestions)
            ──► 4. cross-check (old exact word match of the client's own name vs the extractor;
                            disagreement flagged for a human look)
            ──► stored reading (extractions table, versioned) ──► mentions / other_brands rows the dashboards read
```

Per entity the extractor returns: name as written, kind (company/product/other), a short descriptor,
**role** (recommended / listed / compared / warned_against / passing), **rank** (only from a real list),
**sentiment** (positive / neutral / mixed / negative), the **verbatim quote**, attributes praised and
criticised, and any website the answer gives. Per answer: its **shape** (ranked list, unranked list,
single pick, narrative, no brands, refusal).

Why each design choice:

| Choice | Reason |
|---|---|
| Extraction is project-independent (the model is not told which brands are tracked) | A stored reading can be re-matched when a competitor is added later, with no new AI cost. Resolution is deterministic and auditable. |
| Verbatim quote, checked mechanically, or dropped | Stops invented evidence reaching a report (§2). The drop count is stored per answer and summed per project: a rising drop rate is the alarm that the model or prompt has drifted. |
| Rank only from ranked lists; prose gets `null` | MRR/position must mean "rank in a list" (§1). Null is honest; the old first-mention order was not. |
| Role separate from sentiment | "Warned against" is the number a client needs most, and a word list cannot produce it. Recommendation rate is now computable. |
| Neutral sentiment stored as "no signal" (null) | Matches the dashboard's existing convention; mixed and neutral are kept as labels in the stored reading. |
| Old word-match kept only as a cross-check on the client's own brand | It is the one case where exact matching is strong. Disagreement = review queue, never a vote. |
| Extractor version stored with every reading | Re-run old answers when the prompt changes and see exactly what moved. |
| Off by default (`extract_answers` setting) | Nothing changes for existing clients until the answer key in §5 says the new reading is better. |

Prompt-injection posture is unchanged from the fact check: the answer is data inside `<answer>` tags, the
system prompt says never to follow instructions inside it, the model has no tools, output is schema-forced.

Cost: about 1-3k input tokens and ~400 output tokens per answer. On Opus 5.5 that is roughly $0.01-0.02
per answer; on Haiku 5.5 roughly $0.0005. It is counted in the monthly cap like every other AI call.
Which model to use is decided in §5, not assumed.

What it does not yet do (deliberate):

- Common-word brand names (a client called "Relax" or "Flutter") still match by exact name. Add the
  client's domain on the Competitors page and the domain anchor takes precedence; a descriptor check is
  the next step if a real client hits this.
- Source classification (review site / forum / news) still uses the old list. Replace with a cached
  per-domain AI classification when the reading step is validated.
- The dashboard does not yet show intervals or the recommendation rate; `stats.js` has the functions,
  the metrics queries need wiring.

## 5. How to prove the accuracy number

Do not quote an accuracy figure that was not measured on this pipeline. The harness is in
`server/eval/`.

1. **Build the answer key.** 150 real answers, across at least three industries and all four engines,
   each labelled by two people independently: entities named, role, sentiment, rank, answer shape.
   Format: one JSON object per line, see `labels.example.jsonl`. Where the two labellers disagree,
   discuss and record the agreed label; note the human-human kappa (expect 0.6-0.75).
2. **Score both methods.**
   ```
   node server/eval/predict.js counting labels.jsonl > counting.jsonl
   KEY_ANTHROPIC=… node server/eval/predict.js claude labels.jsonl > opus.jsonl
   KEY_ANTHROPIC=… EXTRACT_MODEL=claude-haiku-5-5 node server/eval/predict.js claude labels.jsonl > haiku.jsonl
   node server/eval/score.js labels.jsonl counting.jsonl     # and opus.jsonl, haiku.jsonl
   ```
   Output: entity precision/recall/F1, role and sentiment agreement with Cohen's kappa, rank error, shape
   agreement. Pass bar: F1 ≥ 0.9 on entities, kappa ≥ 0.7 on role and sentiment, which is at or above
   human-human agreement. Pick the cheapest model that clears the bar.
3. **Run the stability pilot.** For one client, run each question 10 times on each engine in one day.
   Feed the per-answer visibility (1/0) cells into `varianceComponents` and `runsNeeded`. That gives the
   number of runs a monthly report needs for G ≥ 0.8, per client. Expect 1-5 for distinct questions.
4. **Switch on** (`extract_answers` setting), watch `extractionStats`: the dropped-quote rate and the
   cross-check disagreement rate. Each flagged answer gets a human look for the first month.
5. **Re-score quarterly** or whenever the extractor version changes. Keep the answer key under version
   control.

## 6. Metric definitions to put in the client report

- **Visibility**: share of answers in the period naming the brand in any role, with a 95% Wilson interval.
- **Recommendation rate**: share of answers where the role is *recommended*. Interval as above.
- **Warned-against rate**: share where the role is *warned_against*. Any non-zero value is reported with
  its quotes.
- **Rank**: mean rank in answers that contain a ranked list, with the count of such answers. Shown as
  "#2.1 in 14 ranked answers", never as a bare number.
- **Sentiment**: share positive / mixed / negative among answers that judge the brand; neutral answers
  are excluded from the denominator and their count is shown.
- **Share of voice**: brand mentions ÷ all company mentions (resolved or not) in the same answers.
- **Change vs previous period**: shown as real only when the two intervals do not overlap; otherwise
  "no measurable change".
- Always: number of answers, number of distinct questions, engines, date range, extractor version, and
  the drop and disagreement rates for the period.

## Sources

Research papers
- Żatuchin, *The Dice Roll Method: A Standardized Protocol for Repeated-Query Auditing of LLM Brand Recommendations*, arXiv:2609.04047 v2 (Oct 2026). https://arxiv.org/abs/2609.04047
- *Evaluating Brand Retrieval and Ranking in Large Language Model Recommendations*, arXiv:2609.16304. https://arxiv.org/abs/2609.16304v1
- *Who Owns the AI Recommendation? A Multi-Industry Empirical Map of Brand Category Ownership*, arXiv:2606.23057. https://arxiv.org/html/2606.23057v1
- *Evaluating LLM-Based Mobile App Recommendations*, arXiv:2510.18364. https://arxiv.org/pdf/2510.18364
- Aggarwal et al., *GEO: Generative Engine Optimization*, KDD 2024, arXiv:2311.09735. https://arxiv.org/pdf/2311.09735
- *LMDX: Language Model-based Document Information Extraction and Localization*, arXiv:2309.10952. https://arxiv.org/pdf/2309.10952
- *PARSE / SCOPE: LLM Driven Schema Optimization for Reliable Extraction*, EMNLP Industry 2025. https://aclanthology.org/2025.emnlp-industry.184.pdf
- *Neuro-Symbolic Financial Reasoning via Deterministic Fact Ledgers*, arXiv:2603.04663. https://arxiv.org/pdf/2603.04663
- *A Registry-Bound LLM Pipeline for Evidence-Grounded Trait Extraction*, arXiv:2606.00994. https://arxiv.org/pdf/2606.00994
- *Evaluating Zero-Shot Multilingual Aspect-Based Sentiment Analysis with LLMs*, arXiv:2412.12564. https://arxiv.org/pdf/2412.12564
- *Reference-Guided Verdict: LLMs-as-Judges in Automatic Evaluation of Free-Form QA*, arXiv:2408.09235. https://arxiv.org/pdf/2408.09235
- *LLMs-as-Judges in Automatic Evaluation of Free-Form QA*, WiNLP 2025. https://aclanthology.org/2025.winlp-main.37.pdf
- *Evaluating Alignment and Vulnerabilities in LLMs-as-Judges*, GEM 2025. https://aclanthology.org/2025.gem-1.33.pdf
- *LLM-Derived Preference Judgments Are Not Self-Consistent*, arXiv:2608.17644. https://arxiv.org/pdf/2608.17644

Vendor and practitioner sources (claims not independently verified)
- Conductor, *AI Brand Recommendation Study: Why Intent Type Predicts AI Output Consistency*. https://www.conductor.com/academy/ai-recommendation-consistency-analysis/
- Ahrefs, *Brand Radar Methodology*. https://ahrefs.com/blog/?p=192393
- Pebblous, *How Many Iterations an LLM Brand Audit Needs*. https://blog.pebblous.ai/blog/llm-brand-audit-iteration-count/en/
- Authoritytech, *We Audited Our Own AI Visibility Tracker: Every Brand Mention It Found Without Retrieval Was False*. https://authoritytech.io/blog/ai-brand-mention-false-positives-audit-2026
- GEOsurge corpus on mention detection and entity linking. https://geosurge.ai/corpus/gen-2950/entity-linking/entity-linking-error-analysis-for-brand-mentions-in-llm-answers.html
- Trakkr, *AI Share of Voice: Definition, Formula & Audit Guide*. https://trakkr.ai/article/measure-share-of-voice-in-ai-overviews
- LLM Pulse, *How to Measure AI Share of Voice*. https://llmpulse.ai/blog/measure-ai-share-of-voice/
- Shadow, *How to Measure AI Share of Voice: Methods, Tools, and Benchmarks*. https://www.shadow.inc/resources/how-to-measure-ai-share-of-voice
- Position Digital, *15 Best AI Visibility Tracking Tools I Tested (2026)*. https://www.position.digital/blog/best-ai-visibility-tracking-tools/
- Exploding Topics, *Semrush AI Visibility Toolkit vs Ahrefs Brand Radar*. https://explodingtopics.com/blog/ai-visibility-vs-brand-radar
- Kingy AI, *Using Ahrefs Brand Radar & Semrush AI Toolkit for LLM Citation Monitoring*. https://kingy.ai/news/using-ahrefs-brand-radar-semrush-ai-toolkit-for-llm-citation-monitoring/
- Future AGI, *Human vs LLM Annotation in 2026*. https://futureagi.com/blog/human-vs-llm-annotation-2025/
- Reducto, *JSON Schema Extraction with Citations*. https://llms.reducto.ai/json-schema-extraction-with-citations
- GDELT, *Experiments In Entity Extraction Using LLMs: Hallucination*. https://blog.gdeltproject.org/experiments-in-entity-extraction-using-llms-hallucination-how-a-single-apostrophe-can-change-the-results/
