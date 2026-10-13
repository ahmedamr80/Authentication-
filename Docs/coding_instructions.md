# Professional Coding & Error Resolution Protocol

This guide establishes a strict workflow for generating code, analyzing errors, and executing precise refactoring without causing accidental regressions.

---

## 1. System Prompt Context (The "Keep Functionalities" Guardrail)
Copy and paste this section directly into your AI prompt context to enforce baseline programming behavior.

```markdown
### CRITICAL INSTRUCTION: FUNCTIONAL PRESERVATION
When optimizing, refactoring, or fixing bugs in existing code, your absolute priority is the **preservation of all existing, undocumented, or adjacent functionalities**.
1. **Impact Assessment**: Before modifying a line of code, trace its dependencies. Identify what other modules, functions, or UI elements rely on it.
2. **Regression Prevention**: Never delete or rewrite logic simply because it looks redundant, unless explicitly instructed. It may be handling an edge case.
3. **Isolated Fixes**: Localize changes to the specific bug. Do not perform unrelated refactoring while fixing an active error.
4. **Behavioral Consistency**: Output code must match the previous implementation's exact inputs, outputs, and side effects, except for the specific bug being resolved.
```

---

## 2. The Structured Bug Reporting Template
When your code fails, do not just copy-paste the error. Fill out this mini-markdown structure and feed it back to the assistant. This forces the LLM to respect the broader system ecosystem.

```markdown
### 🚨 Bug Report & Context

#### 1. The Error Message / Unexpected Behavior
```text
[Paste full stack trace, console error, or description of unexpected behavior here]
```

#### 2. The Active Codebase / File In Question
```python
# [Paste the exact function or block causing the issue]
```

#### 3. Expected vs. Actual Functionality
* **Expected**: What should happen under successful conditions.
* **Actual**: What happens instead.

#### 4. Critical Dependencies (Do Not Break!)
* **Adjacent Features**: [e.g., "The auth state must persist after this database call resets."]
* **Downstream Components**: [e.g., "This function returns a tuple used by the rendering engine; do not change the return type structure."]
```

---

## 3. The Pro Coding Blueprint (`instructions.md`)
Save this as `instructions.md` in your project root to align your development practices with standard enterprise engineering frameworks.

```markdown
# Engineering Excellence & Robust Refactoring Blueprint

### 🧱 Architectural Integrity
* **Single Responsibility Principle (SRP)**: Keep units of execution focused. If a bug fix requires changing more than one logical concept, split the fix into independent, sequential patches.
* **Strict Type Safety & Schemas**: Always write type hints and enforce explicit return signatures. Changing a data structure signature is the #1 cause of silent regressions down the line.

### 🧪 The Refactoring Lifecycle
1. **Reproduce & Isolate**: Pinpoint the bug down to a single function or module.
2. **Map the Blast Radius**: Document what components share state or variables with the broken block.
3. **Formulate the Fix**: Implement a targeted adjustment that resolves the edge case *without* introducing new control flags or altering external state.
4. **Validation Check**: Run a behavioral dry-run. Did the change alter performance or variable availability for structural parts of the system?
```
