---
description: Optimize and validate Claude skill files against best practices
---

Analyze and optimize skill files for better Claude Code performance and compliance with official best practices.

## 🎯 Step 1: Fetch Latest Best Practices

**🚨 MANDATORY: Execute this step FIRST at every invocation!**

Use WebFetch to download current official requirements:

```
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
```

Extract and analyze:
- Current file size recommendations (lines/tokens)
- Frontmatter requirements (name, description formats)
- Naming conventions (gerund vs noun vs action forms)
- Progressive disclosure patterns
- Content quality requirements
- Anti-patterns to avoid
- Any new requirements since last check

## ✅ Step 2: Validate All Skills

Run automated validation checks on all skills in `src/templates/claude-skills/`:

### A. Frontmatter Validation

Check required YAML frontmatter fields:

```bash
echo "=== Frontmatter Validation ==="
for skill in src/templates/claude-skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))
  echo "--- $name ---"

  # Check name field
  skill_name=$(grep "^name:" "$skill" | cut -d: -f2 | tr -d ' ')
  if [ -n "$skill_name" ]; then
    # Validate format: lowercase, numbers, hyphens only, max 64 chars
    if echo "$skill_name" | grep -qE '^[a-z0-9-]+$'; then
      len=${#skill_name}
      if [ "$len" -le 64 ]; then
        echo "✅ name: $skill_name ($len chars)"
      else
        echo "❌ name: $skill_name (TOO LONG: $len chars, max 64)"
      fi
    else
      echo "❌ name: $skill_name (INVALID: use lowercase, numbers, hyphens only)"
    fi

    # Check for reserved words
    if echo "$skill_name" | grep -qE '(anthropic|claude)'; then
      echo "⚠️  WARNING: name contains reserved word"
    fi
  else
    echo "❌ name: MISSING"
  fi

  # Check description field
  desc=$(grep "^description:" "$skill" | cut -d: -f2-)
  if [ -n "$desc" ]; then
    desc_len=${#desc}
    if [ "$desc_len" -le 1024 ]; then
      echo "✅ description: $desc_len chars"

      # Check for first/second person (should be third person)
      if echo "$desc" | grep -qiE '\b(I|you|your|my)\b'; then
        echo "⚠️  WARNING: description uses first/second person (should be third person)"
      fi

      # Check for vagueness
      if echo "$desc" | grep -qiE '\b(helps|processes|manages|handles)\s+(with|data|files)?\s*$'; then
        echo "⚠️  WARNING: description may be too vague (add specifics and trigger terms)"
      fi
    else
      echo "❌ description: TOO LONG ($desc_len chars, max 1024)"
    fi
  else
    echo "❌ description: MISSING"
  fi

  echo ""
done
```

**Validation criteria:**
- [ ] `name` exists, lowercase/numbers/hyphens only, max 64 chars
- [ ] `name` doesn't contain reserved words ("anthropic", "claude")
- [ ] `description` exists, max 1024 chars
- [ ] `description` in third person (not "I" or "you")
- [ ] `description` includes specific actions and trigger terms
- [ ] No XML tags in either field

### B. File Size Validation

**Official guideline: SKILL.md body < 500 lines**

```bash
echo "=== File Size Validation ==="
for skill in src/templates/claude-skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))

  # Count body lines (excluding frontmatter)
  frontmatter_end=$(grep -n "^---$" "$skill" | tail -1 | cut -d: -f1)
  body_lines=$(tail -n +$((frontmatter_end + 1)) "$skill" | wc -l)

  printf "%-30s %5d lines " "$name:" "$body_lines"

  if [ "$body_lines" -lt 500 ]; then
    echo "✅ OPTIMAL"
  elif [ "$body_lines" -lt 800 ]; then
    echo "⚠️  ACCEPTABLE (consider optimization)"
  else
    echo "❌ TOO LARGE (needs optimization)"
  fi
done
```

**Size targets:**
- ✅ **Optimal:** < 500 lines (Claude official recommendation)
- ⚠️ **Acceptable:** 500-800 lines (borderline)
- ❌ **Too Large:** > 800 lines (MUST optimize)

### C. Progressive Disclosure Check

**Official requirement: One-level-deep references only**

```bash
echo "=== Progressive Disclosure Check ==="
for skill_dir in src/templates/claude-skills/*/; do
  skill_name=$(basename "$skill_dir")
  echo "=== $skill_name ==="

  # Count reference files (one level deep)
  ref_files=$(find "$skill_dir" -maxdepth 1 -name "*.md" ! -name "SKILL.md")
  ref_count=$(echo "$ref_files" | grep -c ".")

  if [ "$ref_count" -gt 0 ]; then
    echo "📄 Reference files: $ref_count"
    echo "$ref_files" | while read -r file; do
      filename=$(basename "$file")
      lines=$(wc -l < "$file")

      # Check if file > 100 lines should have TOC
      if [ "$lines" -gt 100 ]; then
        if grep -q "^## Table of Contents" "$file" || grep -q "^# Table of Contents" "$file"; then
          echo "  ✅ $filename ($lines lines, has TOC)"
        else
          echo "  ⚠️  $filename ($lines lines, needs TOC)"
        fi
      else
        echo "  ✅ $filename ($lines lines)"
      fi
    done
  else
    echo "📄 Reference files: 0"
  fi

  # Check for nested files (anti-pattern)
  nested=$(find "$skill_dir" -mindepth 2 -name "*.md" 2>/dev/null)
  if [ -n "$nested" ]; then
    echo "  ❌ WARNING: Nested files found (avoid deep nesting):"
    echo "$nested" | sed 's/^/    /'
  fi

  # Check for Windows-style paths in SKILL.md
  if grep -q '\\' "$skill_dir/SKILL.md"; then
    echo "  ⚠️  WARNING: Windows-style backslashes found (use forward slashes)"
  fi

  echo ""
done
```

**Rules:**
- ✅ Reference files one level deep from SKILL.md
- ✅ Files > 100 lines have table of contents
- ✅ Forward slashes in all paths
- ✅ Descriptive file names (not `doc1.md`, `utils.md`)
- ❌ No nested references (file → file → file)

### D. Naming Convention Check

**Recommended: Gerund form (processing-pdfs, analyzing-data)**

```bash
echo "=== Naming Convention Check ==="
for skill in src/templates/claude-skills/*/SKILL.md; do
  skill_name=$(grep "^name:" "$skill" | cut -d: -f2 | tr -d ' ')

  # Check if gerund form (-ing)
  if echo "$skill_name" | grep -qE -- '-(ing|izing|ising)(-|$)'; then
    echo "✅ $skill_name (gerund form - recommended)"
  # Check if action-oriented
  elif echo "$skill_name" | grep -qE '^(process|analyze|manage|generate|create|build|test)-'; then
    echo "⚠️  $skill_name (action-oriented - acceptable)"
  # Check if noun phrase
  elif echo "$skill_name" | grep -qE -- '-ing$'; then
    echo "✅ $skill_name (noun phrase with -ing - acceptable)"
  else
    # Check for anti-patterns
    if echo "$skill_name" | grep -qE '^(helper|utils|tools|common)'; then
      echo "❌ $skill_name (VAGUE: avoid helper/utils/tools)"
    else
      echo "⚠️  $skill_name (consider gerund form: ${skill_name}ing or processing-${skill_name})"
    fi
  fi
done
```

### E. Content Quality Scan

```bash
echo "=== Content Quality Scan ==="
for skill in src/templates/claude-skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))
  echo "--- $name ---"

  # Check for common anti-patterns
  if grep -qi "magic number" "$skill"; then
    echo "⚠️  Uses term 'magic number' - ensure values are justified"
  fi

  if grep -qE '\b(TODO|FIXME|XXX)\b' "$skill"; then
    echo "⚠️  Contains TODO/FIXME markers"
  fi

  if grep -q "as of [0-9][0-9][0-9][0-9]" "$skill"; then
    echo "⚠️  Contains time-sensitive information (use 'old patterns' section)"
  fi

  # Check for inconsistent terminology
  if grep -qi "repository" "$skill" && grep -qi "repo" "$skill"; then
    echo "⚠️  Inconsistent terminology: 'repository' and 'repo' both used"
  fi

  echo ""
done
```

## 📊 Step 3: Compare Against Fetched Best Practices

Cross-reference validation results with the best practices document from Step 1:

1. **Verify size limits:** Still 500 lines body?
2. **Check naming:** Still gerund-preferred?
3. **Review frontmatter:** Any new required fields?
4. **Scan anti-patterns:** Any new patterns to avoid?
5. **Note changes:** Document differences from current implementation

If official guidelines have changed, update validation criteria accordingly.

## 🔧 Step 4: Optimization (If Needed)

For skills > 500 lines, perform extraction:

### A. Identify Large Sections

```bash
# Analyze section sizes in oversized SKILL.md
awk '/^## / {
  if (prev) print prev " " NR-start " lines"
  prev=$0
  start=NR
}
END {
  if (prev) print prev " " NR-start " lines"
}' SKILL.md | sort -t' ' -k3 -rn
```

**Candidates for extraction (> 100 lines):**
- Detailed workflows and processes
- Extensive example collections
- Long checklists
- Reference tables
- Troubleshooting guides
- Historical context sections

### B. Extract Content

**1. Create reference file:**

```markdown
---
name: skill-name-topic
description: Detailed [topic] for skill-name skill
---

# [Topic Title]

## Table of Contents
(If file > 100 lines, REQUIRED)

[Content extracted from SKILL.md]
```

**2. Replace in SKILL.md:**

```markdown
## [Topic]

**📖 Complete [topic] details: `topic-name.md`**

**Quick overview:**
- Essential point 1
- Essential point 2
- Essential point 3

**Critical checklist:**
- [ ] Must-know item 1
- [ ] Must-know item 2
```

### C. Keep vs Extract

**Keep in SKILL.md:**
- Core workflow (numbered steps)
- Critical warnings
- "When to Use" section
- Quick command reference
- Essential checklists (< 10 items)

**Extract to separate files:**
- Detailed workflows (> 100 lines)
- Extensive examples (> 50 lines)
- Reference documentation
- Troubleshooting guides
- Historical "old patterns" sections

## 📋 Step 5: Generate Report

```bash
echo "=================================="
echo "  Skill Validation Report"
echo "=================================="
echo ""
echo "📊 Summary:"
total=$(find src/templates/claude-skills -name "SKILL.md" | wc -l)
echo "Total skills validated: $total"
echo ""

echo "📏 Size Distribution:"
optimal=0
acceptable=0
too_large=0

for skill in src/templates/claude-skills/*/SKILL.md; do
  frontmatter_end=$(grep -n "^---$" "$skill" | tail -1 | cut -d: -f1)
  body_lines=$(tail -n +$((frontmatter_end + 1)) "$skill" | wc -l)

  if [ "$body_lines" -lt 500 ]; then
    optimal=$((optimal + 1))
  elif [ "$body_lines" -lt 800 ]; then
    acceptable=$((acceptable + 1))
  else
    too_large=$((too_large + 1))
  fi
done

echo "  ✅ Optimal (< 500 lines):    $optimal"
echo "  ⚠️  Acceptable (500-800):     $acceptable"
echo "  ❌ Too large (> 800):         $too_large"
echo ""

echo "📋 Frontmatter Compliance:"
complete=0
incomplete=0

for skill in src/templates/claude-skills/*/SKILL.md; do
  if grep -q "^name:" "$skill" && grep -q "^description:" "$skill"; then
    complete=$((complete + 1))
  else
    incomplete=$((incomplete + 1))
  fi
done

echo "  ✅ Complete:   $complete"
echo "  ❌ Incomplete: $incomplete"
echo ""

echo "🔍 Issues Requiring Attention:"
for skill in src/templates/claude-skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))
  issues=""

  # Check size
  frontmatter_end=$(grep -n "^---$" "$skill" | tail -1 | cut -d: -f1)
  body_lines=$(tail -n +$((frontmatter_end + 1)) "$skill" | wc -l)
  if [ "$body_lines" -gt 800 ]; then
    issues="${issues}- Size: $body_lines lines (optimize)\n"
  fi

  # Check frontmatter
  if ! grep -q "^name:" "$skill"; then
    issues="${issues}- Missing 'name' field\n"
  fi
  if ! grep -q "^description:" "$skill"; then
    issues="${issues}- Missing 'description' field\n"
  fi

  # Check naming
  skill_name=$(grep "^name:" "$skill" | cut -d: -f2 | tr -d ' ')
  if echo "$skill_name" | grep -qE '^(helper|utils|tools)'; then
    issues="${issues}- Vague name: $skill_name\n"
  fi

  if [ -n "$issues" ]; then
    echo ""
    echo "$name:"
    echo -e "$issues"
  fi
done

echo ""
echo "=================================="
echo "✅ Validation Complete"
echo "=================================="
```

## 🎯 Step 6: Action Items

Based on validation, create specific action items for each skill needing work:

**Priority 1 (Critical):**
- Missing frontmatter fields → Add immediately
- Invalid name format → Fix format
- > 800 lines → Extract content

**Priority 2 (Important):**
- 500-800 lines → Consider extraction
- Vague descriptions → Add specifics and trigger terms
- Missing TOC in large files → Add table of contents

**Priority 3 (Nice to have):**
- Improve naming (→ gerund form)
- Add concrete examples
- Fix inconsistent terminology

## ✅ Step 7: Verification

Before completing, verify:
- [ ] All skills have valid frontmatter (name + description)
- [ ] All descriptions in third person with trigger terms
- [ ] All names follow format (lowercase, hyphens, max 64 chars)
- [ ] All SKILL.md files < 800 lines (ideally < 500)
- [ ] Reference files > 100 lines have table of contents
- [ ] No deeply nested file references
- [ ] All paths use forward slashes
- [ ] No vague names (helper, utils, tools)
- [ ] Cross-referenced with latest best practices from Step 1

## 📚 References

Official documentation:
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://www.anthropic.com/engineering/claude-code-best-practices

## 💡 Tips for Command Execution

**For autonomous execution:**
1. Start with WebFetch in Step 1 (MANDATORY)
2. Run all validation scripts sequentially
3. Generate full report in Step 5
4. List specific action items for each skill
5. Provide clear next steps to user

**For interactive use:**
- Show progress between steps
- Highlight critical issues immediately
- Provide examples of good fixes
- Ask for clarification on borderline cases

**Success indicators:**
- All skills pass frontmatter validation
- 80%+ skills under 500 lines
- All issues documented with action items
- Report includes comparison with latest best practices
