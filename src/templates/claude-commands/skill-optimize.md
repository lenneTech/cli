---
description: Optimize Claude skill files if too large
---

Analyze and optimize large skill files for better Claude Code performance:

## 📊 1. Skill File Analysis

Analyze all skill files:
```bash
# Count lines of all SKILL.md files
find src/templates/claude-skills -name "SKILL.md" -exec wc -l {} \;

# Or more detailed
for skill in src/templates/claude-skills/*/SKILL.md; do
  lines=$(wc -l < "$skill")
  name=$(basename $(dirname "$skill"))
  echo "$name: $lines lines"
done
```

## 🎯 2. Determine Optimization Needs

**Target Sizes:**
- ✅ **Optimal:** 500-800 lines (fastest loading)
- ⚠️ **Acceptable:** 800-1,800 lines (borderline)
- ❌ **Too Large:** > 1,800 lines (MUST be optimized)

Identify files over 1,800 lines for optimization.

## 📑 3. Identify Large Sections

For each oversized SKILL.md:
```bash
# Show sections with line numbers
grep -n "^## " SKILL.md

# Calculate section sizes
# Sections > 200 lines are candidates for extraction
```

**Typical large sections:**
- Quality Review processes (often 500-1000 lines)
- Security Rules (often 300-500 lines)
- Configuration Guides (often 200-300 lines)
- Test Guidelines (often 400-600 lines)
- Example Collections (often 300-500 lines)

## 🔧 4. Perform Modularization

For each large section (> 200 lines):

**A. Extract section:**
```bash
# Create separate .md file
# e.g., security-rules.md, quality-review.md, configuration.md
```

**B. Add frontmatter:**
```markdown
---
name: skill-name-section-name
version: 1.0.0
description: What this file contains
---
```

**C. Replace in SKILL.md:**
```markdown
## Section Name

**📖 For complete [section topic] with all details, see: `section-file.md`**

**Quick overview:**
- Key point 1
- Key point 2
- Key point 3

**Critical reminders:**
- [ ] Important checkpoint 1
- [ ] Important checkpoint 2
```

## 📏 5. Extraction Strategy

**What to extract:**
- ✅ Detailed process descriptions
- ✅ Extensive examples
- ✅ Long checklists
- ✅ Reference documentation
- ✅ Troubleshooting guides

**What NOT to extract:**
- ❌ Core workflow (Phases 1-7)
- ❌ Critical warnings (Security, declare keyword)
- ❌ Command syntax (brief reference)
- ❌ Skill description and "When to Use"

## ✅ 6. Quality Assurance

After each extraction:
- [ ] SKILL.md has clear reference (📖) to detail file
- [ ] Detail file has frontmatter
- [ ] Compact summary remains in SKILL.md
- [ ] No information is lost
- [ ] Line count significantly reduced

## 📊 7. Measure Success

```bash
# Before/After comparison
echo "Original: 3,309 lines"
echo "After optimization: $(wc -l < SKILL.md) lines"
echo "Reduction: $((3309 - $(wc -l < SKILL.md))) lines"
echo "Percentage: $(echo "scale=1; (3309 - $(wc -l < SKILL.md)) * 100 / 3309" | bc)%"
```

**Success if:**
- ✅ SKILL.md under 1,800 lines (ideal: under 1,500)
- ✅ 5-8 modular detail files created
- ✅ 30-50% reduction achieved
- ✅ All information still available

## 🎯 8. Create Report

Create summary:
```
=== Skill Optimization Report ===

📁 Optimized Skills:
- skill-name: 3,309 → 1,890 lines (-43%)

📄 Created Detail Files:
- security-rules.md (9.2K)
- quality-review.md (29K)
- configuration.md (7.0K)
...

✅ All skills now within optimal range!
```
