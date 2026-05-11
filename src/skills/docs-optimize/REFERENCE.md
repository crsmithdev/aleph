# Docs Optimizer Reference

## C7Score Evaluation

### Scoring Methodology

Analyze documentation against c7score metrics, comparing original and optimized versions.

**Scoring scales (0-100 for each metric):**

- **Question-Snippet Matching:**
  - 90-100: Excellent - Complete, practical answers with context
  - 70-89: Good - Most questions answered with working examples
  - 50-69: Fair - Partial answers, missing context
  - 30-49: Poor - Vague or incomplete answers
  - 0-29: Very Poor - Questions not addressed

- **LLM Evaluation:**
  - 90-100: Unique, clear, syntactically perfect
  - 70-89: Mostly unique and clear, minor issues
  - 50-69: Some duplicates or clarity issues
  - 30-49: Significant duplicates or syntax errors
  - 0-29: Major quality problems

- **Formatting:**
  - 100: All snippets properly formatted with language tags
  - 80-99: Minor formatting issues
  - 50-79: Multiple formatting problems
  - 0-49: Significant formatting issues

- **Metadata Removal:**
  - 100: No project metadata
  - 50-99: Some metadata present
  - 0-49: Significant metadata content

- **Initialization:**
  - 100: All examples show usage beyond setup
  - 50-99: Some initialization-only snippets
  - 0-49: Many initialization-only snippets

### Evaluation Template

```markdown
## C7Score Evaluation

### Original Documentation Score: XX/100

**Metric Breakdown:**
- Question-Snippet Matching: XX/100 (weight: 80%)
  - Analysis: [Brief explanation of score]
- LLM Evaluation: XX/100 (weight: 10%)
  - Analysis: [Brief explanation]
- Formatting: XX/100 (weight: 5%)
  - Analysis: [Brief explanation]
- Metadata Removal: XX/100 (weight: 2.5%)
  - Analysis: [Brief explanation]
- Initialization: XX/100 (weight: 2.5%)
  - Analysis: [Brief explanation]

**Weighted Average:** XX/100

---

### Optimized Documentation Score: XX/100

**Metric Breakdown:**
[Same format as above]

**Weighted Average:** XX/100

---

### Improvement Summary

**Overall Improvement:** +XX points (XX → XX)

**Key Improvements:**
- [Metric]: +XX points - [What specifically improved]

**Impact Assessment:**
[Brief explanation of how optimizations improved the documentation quality]
```

### Scoring Guidelines

- Be objective and consistent
- Base scores on concrete evidence from the documentation
- Explain reasoning for each score
- Final score: (Q×0.8) + (L×0.1) + (F×0.05) + (M×0.025) + (I×0.025)

Note: These are estimated scores. For official scores, users can submit to Context7's benchmark.

## Optimization Patterns

### Transform API Reference → Complete Example

**Before:**
```
## authenticate(api_key)
Authenticates the client.
```

**After:**
```python
from library import Client

client = Client(api_key="your_key")
client.authenticate()

# Now ready to make requests
result = client.get_data()
```

### Transform Import-Only → Quick Start

**Before:**
```python
from library import Client, Config
```

**After:**
```python
# Install: pip install library
from library import Client, Config

# Initialize and use
config = Config(api_key="key")
client = Client(config)
result = client.query("SELECT * FROM data")
```

### Transform Multiple Small → One Comprehensive

Combine related small snippets into one complete workflow example.

## README Structure for High Scores

1. **Quick Start** (High Priority) — Installation + immediate usage
2. **Common Use Cases** (High Priority) — Each major feature with full examples
3. **Configuration** (Medium Priority) — Common configuration patterns
4. **Error Handling** (Medium Priority) — Practical error handling examples
5. **API Reference** (Lower Priority) — Usage examples for each method
6. **Advanced Topics** (Lower Priority) — Complex scenarios with complete code

## llms.txt Generation

### What is llms.txt?

A standardized markdown file format for LLM-friendly content summaries and documentation navigation. Official specification: https://llmstxt.org/

### Generation Workflow

#### Step 1: Analyze Project Structure

1. Identify documentation files (README.md, docs/, CONTRIBUTING.md, etc.)
2. Find example files, tutorials, API reference, configuration docs
3. Determine project type (Python library, CLI tool, web framework, Claude skill, etc.)
4. Assess documentation organization (single README vs multiple files)

#### Step 2: Create the Structure

```markdown
# Project Name

> Brief description (1-3 sentences giving LLMs essential context)

Key features:
- Main feature or capability
- Another important aspect

## Documentation
- [Link Title](https://full-url): Brief description

## API Reference
- [Core API](https://full-url): Main API documentation

## Examples
- [Basic Usage](https://full-url): Simple getting-started examples

## Optional
- [Blog](https://full-url): Latest updates (LLMs can skip this section)
```

#### Step 3: Format Links

Each link must follow this format:
```markdown
- [Descriptive Title](https://full-url): Optional helpful notes
```

Requirements:
- Use markdown bullet lists (`-`)
- Use markdown hyperlinks `[text](url)`
- Use **full URLs** with protocol (https://), not relative paths
- Prefer linking to `.md` files when possible

#### Step 4: Organize by Priority

**High Priority (First):** Documentation / Getting Started, Core API, Examples
**Medium Priority (Middle):** Guides, Configuration, Development
**Low Priority (Last — "Optional" section):** Blog, Community, Changelog

#### Step 5: Handle Different Repo Structures

- **GitHub repos:** `https://github.com/username/repo/blob/main/path/to/file.md`
- **Local files only:** Use placeholder URLs, note they need updating
- **Docs website:** Prefer markdown versions of pages

#### Step 6: Validate

- ✅ File named exactly `llms.txt` (lowercase)
- ✅ Has H1 title as first element
- ✅ Has blockquote summary
- ✅ Uses only H1 and H2 headings
- ✅ All links use full URLs with protocol
- ✅ Sections logically organized (essential → optional)
- ✅ No complex markdown (tables, images, code blocks)

### Templates by Project Type

#### Python Library
Sections: Documentation, API Reference, Examples, Development, Optional

#### CLI Tool
Sections: Getting Started, Commands, Configuration, Examples, Optional

#### Web Framework
Sections: Documentation, Guides, API Reference, Examples, Integrations, Optional

#### Claude Skill
Sections: Documentation, Reference Materials, Examples, Development, Optional

### Tips

1. Be concise — clear, brief language
2. Think like a new user — what would they find first?
3. Descriptive link text, not "click here"
4. Add context notes after colons
5. Use stable, versioned URLs
6. Progressive detail: essentials → optional
7. Keep updated as documentation evolves

### Integration with C7Score

1. Optimize documentation first
2. Then generate llms.txt pointing to optimized docs
3. Result: High-quality docs with LLM-friendly navigation
