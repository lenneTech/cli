---
description: Generate commit message with alternatives
---

Analyze the current changes compared to the last git commit (`git diff`) and create a commit message.

**Requirements:**
- Write in English
- Keep it short: one concise sentence
- Focus on WHAT changed and WHY, not HOW

**Output format:**
Provide exactly 3 alternatives:

```
1. [your first commit message suggestion]
2. [your second commit message suggestion]
3. [your third commit message suggestion]
```

Then add: "💡 **Copy your preferred message to use with `git commit -am \"...\"`**"