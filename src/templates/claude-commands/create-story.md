---
description: Create a user story for TDD implementation
---

# User Story erstellen

Guide the user through creating a well-structured user story that can be used as a prompt for Claude Code to implement with Test-Driven Development (TDD).

## When to Use This Command

- Planning and documenting new features
- Preparing user stories for TDD implementation
- Capturing requirements in a structured format
- Creating stories for Linear tickets or documentation

**IMPORTANT: The generated story and all user-facing communication must ALWAYS be in German, regardless of the user's input language. Exceptions: Properties (camelCase), code snippets, and technical terms remain in English.**

**ABORT HANDLING: If the user wants to cancel at any point (e.g., "abbrechen", "stop", "cancel", "nicht mehr"), acknowledge it (in German): "Okay, Story-Erstellung abgebrochen." and stop the process.**

---

## Guidelines for Good Stories

Keep these guidelines in mind when generating the story:

### INVEST Criteria (Quality Check)

Every story should be checked against these criteria:

- **Independent** - Can be implemented without depending on other stories
- **Negotiable** - Open for discussion and refinement
- **Valuable** - Delivers real, tangible value to the user (not just technical tasks)
- **Small** - Completable within a single sprint (if too large, suggest splitting)
- **Testable** - Has measurable acceptance criteria

### 3C Model

- **Card** - Concise title that fits on a notecard
- **Conversation** - Story emerges from dialogue (Gap Analysis enables this)
- **Confirmation** - Clear acceptance criteria define "done"

### Emotional Narrative

The story should convey the **user's emotional experience**, not just technical functionality. Ask "Why does this matter to the user?" - use the **5 Whys technique** if the reason is unclear.

### Title

- Keep short (max 10 words)
- Format: "[Rolle] möchte [Feature], damit [Kurze Begründung]"

### Acceptance Criteria

- Aim for **4-8 criteria** per story
- Start with action verbs (kann, soll, muss)
- Be specific and measurable - focus on *what*, not *how*
- Include both positive and negative cases
- Consider: authentication, authorization, validation, persistence
- **Optional Gherkin format** for complex criteria:
  ```
  Gegeben [Ausgangssituation]
  Wenn [Aktion]
  Dann [Erwartetes Ergebnis]
  ```

### Properties

- Use camelCase for property names
- Provide BOTH English AND German descriptions
- Specify relationships clearly (e.g., "Referenz auf User-Entität")

### For TDD

- Each acceptance criterion becomes at least one test
- Consider edge cases that need explicit tests
- Think about security tests (permission-denied scenarios)

---

## Step 1: Collect Initial Thoughts

**Ask the user to share their story idea (in German):**

"Bitte beschreibe deine User Story Idee. Teile so viele Details wie möglich mit:
- Wer braucht dieses Feature (Rolle/Nutzertyp)?
- Was soll erreicht werden?
- Warum wird es benötigt?
- Spezifische Anforderungen oder Properties?
- Technische Hinweise?

Schreib einfach deine Gedanken auf - ich helfe dir, sie in eine strukturierte User Story zu bringen."

**Wait for the user's response before proceeding.**

---

## Step 2: Analyze and Identify Gaps

After receiving the user's input, analyze it against this checklist:

### Required Elements Checklist

**Basic Story Elements:**
- [ ] **Role** - Who is the user? (Admin, Customer, Guest, etc.)
- [ ] **Feature** - What do they want to achieve?
- [ ] **Reason** - Why do they need this? What's the benefit?

**Description Details:**
- [ ] **Context** - Background information, which system/module?
- [ ] **Requirements** - Specific functional requirements
- [ ] **Properties** (optional) - Data fields with types (if applicable)
- [ ] **Notes** (optional) - Technical hints, constraints, special logic

**Quality Criteria:**
- [ ] **Acceptance Criteria** - Testable conditions for success
- [ ] **Security Considerations** - Who can access/modify? (permissions)
- [ ] **Edge Cases** - What happens in special situations?

### Gap Analysis

For each missing or unclear element, formulate a **specific question in German** using the AskUserQuestion tool:

**Fehlende Rolle:**
- "Wer wird dieses Feature nutzen? (z.B. Admin, Kunde, Gast, Entwickler)"

**Fehlendes Feature/Ziel:**
- "Was genau soll der Nutzer tun können?"

**Fehlende Begründung:**
- "Welchen Nutzen bringt dieses Feature? Welches Problem löst es?"

**Fehlende Properties (only ask if the feature involves data entities):**
- "Welche Daten müssen gespeichert werden? Bitte liste die Properties mit ihren Typen auf (string, number, boolean, Date, enum, Referenz)"

**Fehlende Akzeptanzkriterien:**
- "Wie können wir überprüfen, dass das Feature funktioniert? Was sind die Erfolgsbedingungen?"

**Unklare Sicherheit:**
- "Wer soll Zugriff auf dieses Feature haben? Gibt es Berechtigungseinschränkungen?"

**Fehlende Edge Cases:**
- "Gibt es Sonderfälle zu beachten? Was soll passieren, wenn [konkretes Szenario]?"

### Questioning Strategy

1. **Ask only about missing/unclear elements** - Don't ask for information already provided
2. **Be specific** - Reference what was said and ask for clarification
3. **Group related questions** - Ask 2-4 questions at once, not one by one
4. **Suggest improvements** - If something seems incomplete, suggest additions
5. **Accept refusal gracefully** - If the user refuses to answer or provides no input, accept it and make the best of available information

**Example question (in German):**
"Deine Story-Idee ist klar bezüglich des Grundfeatures. Ich brauche noch ein paar Details:
1. Du hast erwähnt, dass Admins Items verwalten können - können Gäste sie auch sehen?
2. Sollen die Items eine bestimmte Reihenfolge/Position haben?
3. Was passiert, wenn jemand versucht, ein Item zu löschen, das anderswo referenziert wird?"

**If user refuses or skips questions:**
- Accept the decision without pushing further
- Use sensible defaults or common patterns
- Make reasonable assumptions based on context
- Proceed with available information
- Document any assumptions made in the story's "Hinweise" section

---

## Step 3: Validate Completeness

Once all information is gathered, perform a final validation:

### INVEST Check

- **Independent:** Does this story depend on other stories? If yes, note dependencies or suggest splitting.
- **Valuable:** Is the user value clear? If the "damit" part is weak, use 5 Whys to dig deeper:
  - "Warum ist das wichtig?" → Answer → "Und warum ist das wichtig?" → repeat until real value emerges
- **Small:** Can this be completed in one sprint? If too large, suggest splitting into smaller stories (in German):
  - "Diese Story scheint recht umfangreich. Sollen wir sie in kleinere Stories aufteilen?"
- **Testable:** Are all acceptance criteria measurable and verifiable?

### Coherence Check
- Does the feature make sense as described?
- Are the requirements internally consistent?
- Do the acceptance criteria cover all requirements (aim for 4-8)?
- Are there any contradictions?

### Emotional Value Check
- Does the story convey why this matters to the user?
- Is it more than just a technical task?
- If the narrative feels dry, ask (in German): "Was ist der eigentliche Nutzen für den Anwender? Welches Problem wird gelöst?"

### TDD Readiness Check
- Can each acceptance criterion be converted to a test?
- Are the properties clear enough for implementation?
- Is the security model defined?

**If issues found:** Ask clarifying questions (in German) before proceeding.

**If complete:** Proceed to Step 4.

---

## Step 4: Generate and Present Story

Generate the complete user story in the standard format and **present it to the user first**.

**Display the story in a clearly marked code block** so the user can:
- Review and discuss the story
- Request changes or optimizations
- Copy it if needed

After presenting the story, ask (in German): "Ist die Story so in Ordnung, oder möchtest du noch etwas anpassen?"

**If changes requested:** Make the adjustments and present the updated story again.

**If approved:** Proceed to Step 5 (Ask for Output Format).

### Story Format (German)

```markdown
# [Titel - Rolle möchte Feature, damit Begründung]

**Story:** Als [Rolle] möchte ich [Feature], damit [Begründung].

## Beschreibung

[Ausführliche Beschreibung]

### Kontext
[Hintergrund und Systemkontext]

### Anforderungen
[Liste der spezifischen Anforderungen]

### Properties (optional, nur wenn das Feature Datenentitäten betrifft)

| Property   | Type   | Required | Description (EN)   | Beschreibung (DE)    |
|------------|--------|----------|--------------------|----------------------|
| example    | string | yes      | Example property   | Beispiel-Eigenschaft |

[Properties-Tabelle falls relevant - Abschnitt weglassen wenn nicht benötigt]

### Hinweise (optional)
[Technische Hinweise, Einschränkungen, spezielle Logik]

## Akzeptanzkriterien

- [ ] [Testbares Kriterium 1]
- [ ] [Testbares Kriterium 2]
- [ ] [Sicherheitskriterium]
- [ ] [Edge-Case-Kriterium]
```

---

## Step 5: Ask for Output Format

Once the user approves the story, use the AskUserQuestion tool to ask (in German):

**Question:** "Wie möchtest du mit dieser Story fortfahren?"

**Options:**
1. **Linear Ticket erstellen** - Ticket in Linear via MCP erstellen (Linear MCP muss installiert sein)
2. **Als Markdown-Datei speichern** - Story in eine .md-Datei im Projekt speichern
3. **Direkt umsetzen** - Sofort mit TDD-Implementierung via `building-stories-with-tdd` Skill starten
4. **Nichts davon** - Story wurde bereits angezeigt und kann kopiert werden, keine weitere Aktion nötig

(If user selects "Nichts davon", confirm in German: "Alles klar! Die Story wurde oben angezeigt und kann bei Bedarf kopiert werden.")

---

## Step 6: Execute Selected Output

### Option 1: Linear Ticket erstellen

**Prerequisite:** Linear MCP must be installed (`lt claude install-mcps linear`)

1. First, check if Linear MCP is available. If not, inform the user (in German):
   - "Linear MCP ist nicht installiert. Du kannst es mit `lt claude install-mcps linear` installieren."
   - Then ask if they want to choose a different output option

2. If Linear MCP is available, ask for Linear project/team (in German):
   - "In welchem Linear Team soll das Ticket erstellt werden?"
   - Use Linear MCP to list available teams to help the user choose
   - If the user provides an invalid team, show available teams and ask again

3. Create ticket via Linear MCP:
   - Title: The story title
   - Description: The full story in markdown format
   - Labels: Add relevant labels if applicable

4. Report the created ticket URL to the user (in German)

5. **Then ask (in German):** "Möchtest du diese Story jetzt auch mit TDD umsetzen?"

### Option 2: Als Markdown-Datei speichern

1. Ask for the file location (in German):
   - "Wo soll die Story gespeichert werden? (z.B. `docs/stories/faq-verwaltung.md` oder `stories/STORY-001.md`)"
   - Suggest a filename based on the story title (e.g., `stories/admin-faq-verwaltung.md`)

2. Validate the path:
   - Check if the parent directory exists
   - If not, ask (in German): "Das Verzeichnis [dir] existiert nicht. Soll ich es erstellen?"
   - If the file already exists, ask (in German): "Die Datei existiert bereits. Überschreiben?"

3. Write the story to the specified file
   - If writing fails, inform the user (in German): "Fehler beim Speichern: [error]. Bitte einen anderen Pfad angeben."
   - Then ask for a new path

4. Confirm (in German): "Story gespeichert unter [Pfad]"

5. **Then ask (in German):** "Möchtest du diese Story jetzt auch mit TDD umsetzen?"

### Option 3: Direkt umsetzen (or TDD after Option 1/2)

When the user chooses direct implementation or answers "yes" to TDD after Option 1 or 2:

1. Confirm (in German): "Starte TDD-Implementierung mit dem `building-stories-with-tdd` Skill..."

2. Invoke the `building-stories-with-tdd` skill with the generated story as context

3. The skill will handle: test creation, implementation, validation

---

## Beispiel: FAQ-Verwaltung Story

Here is an example of a well-structured user story:

**User's initial input:**
> "Ich brauche FAQs die der Admin verwalten kann und die auf der Website angezeigt werden. Die sollen eine Reihenfolge haben."

**After gap analysis and clarification, the resulting story:**

```markdown
# Admin möchte FAQs verwalten, damit sie auf der Website verfügbar sind

**Story:** Als Admin möchte ich FAQs verwalten können, damit sie allen Besuchern auf der Website zur Verfügung stehen.

## Beschreibung

Es soll ein Modul für FAQs erstellt werden, in dem der Admin FAQs sehen, anlegen, bearbeiten und löschen kann. Nicht eingeloggte Nutzer sollen die FAQs sehen können, damit sie auf der Website dargestellt werden können.

### Kontext
- FAQs sind öffentlich sichtbare Inhalte, die von Administratoren verwaltet werden
- Die Reihenfolge der FAQs ist für die Anzeige wichtig

### Anforderungen
- Admins können vollständige CRUD-Operationen auf FAQs durchführen
- Alle Nutzer (auch Gäste) können FAQs lesen
- FAQs müssen eine bestimmte Reihenfolge über das position-Feld haben
- Die Positionsverwaltung muss automatisch und effizient erfolgen

### Properties

| Property | Type   | Required | Description (EN)        | Beschreibung (DE)     |
|----------|--------|----------|-------------------------|-----------------------|
| question | string | yes      | Question of the FAQ     | Frage der FAQ         |
| answer   | string | yes      | Answer of the FAQ       | Antwort der FAQ       |
| position | number | no       | Position of the element | Position des Elements |

### Hinweise
- FAQs haben eine bestimmte Reihenfolge, die durch das `position`-Feld bestimmt wird
- Beim Anlegen oder Bearbeiten einer FAQ muss geprüft werden, ob die Positionen anderer FAQs angepasst werden müssen
- Wird bei einer neuen FAQ keine position explizit mitgegeben, wird automatisch die höchste Position + 1 vergeben
- Positionsaktualisierungen müssen effizient erfolgen (möglichst wenige Datenbankrequests)
- Wenn eine FAQ ihre Position ändert, müssen die anderen Elemente entsprechend der alten und neuen Position neu positioniert werden

## Akzeptanzkriterien

- [ ] Administratoren können FAQs vollständig verwalten (GET, POST, DELETE, PUT)
- [ ] Alle Nutzer (auch nicht eingeloggte) können die komplette Liste der FAQs sortiert nach position (aufsteigend) abrufen
- [ ] Beim Anlegen einer neuen FAQ ohne position wird automatisch die höchste Position + 1 vergeben
- [ ] Beim Anlegen einer neuen FAQ mit einer bestimmten position werden die anderen FAQs entsprechend neu positioniert
- [ ] Beim Bearbeiten der position einer FAQ werden die anderen FAQs effizient neu positioniert
- [ ] Nicht-Admin-Nutzer können keine FAQs erstellen, bearbeiten oder löschen
- [ ] Position-Werte sind immer positive Ganzzahlen ab 1
```

**Beispiel eines Akzeptanzkriteriums im Gherkin-Format:**

```gherkin
Gegeben eine FAQ mit position 2 existiert bereits
Wenn ein Admin eine neue FAQ mit position 2 anlegt
Dann wird die neue FAQ an Position 2 eingefügt
Und die bisherige FAQ an Position 2 rückt auf Position 3
Und alle weiteren FAQs rücken entsprechend nach
```

---

## Execution Summary

1. **Collect initial thoughts** - Let user describe their idea freely
2. **Analyze gaps** - Check against required elements checklist
3. **Ask targeted questions** - Only for missing/unclear elements (in German)
4. **Validate completeness** - INVEST check, coherence, emotional value, and TDD readiness
5. **Generate and present story** - Format according to template (in German!) and present for discussion/optimization
6. **Ask for output** - Linear ticket, Markdown file, direct implementation, or nothing
7. **Execute choice and offer TDD** - Create output in selected format, then offer TDD implementation if not already chosen

**Key behaviors:**
- User can abort at any point - acknowledge and stop
- Always validate paths/teams before executing
- Handle errors gracefully with German error messages
- "Nichts davon" is a valid choice - story was already displayed

**Remember:** A well-written user story leads to better tests and cleaner implementation!
