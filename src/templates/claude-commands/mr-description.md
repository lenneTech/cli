---
description: Generate Merge Request description
---

Create a comprehensive summary of the changes in English so I can use it as a description in a Merge Request. Only include the essential points.

Please structure the description as follows:
- **Summary**: Brief summary (1-2 sentences)
- **Changes**: List of the most important changes
- **Technical Details**: Relevant technical details if necessary
- **Testing**: How was it tested / how can it be tested

Keep it short and concise - focus on what's essential for code reviewers.

**IMPORTANT OUTPUT FORMAT:**
Present the final MR description in a clearly marked code block that is easy to copy:

```markdown
## Summary
[Your summary here]

## Changes
- Change 1
- Change 2

## Technical Details
[Details if necessary]

## Testing
[Testing approach]
```

Then add: "✂️ **Copy the markdown block above to use it in your Merge Request.**"
