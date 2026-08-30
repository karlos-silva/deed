# Documentation

Four documents, each with one job. Read them in this order.

| Document | Answers | Changes when |
| --- | --- | --- |
| [prd.md](./prd.md) | What is this, for whom, and why does it matter? | Product scope or a principle changes |
| [state-model.md](./state-model.md) | What states exist, and what moves between them? | A behaviour rule changes |
| [delivery-plan.md](./delivery-plan.md) | What gets built, in what order, and how do we know it works? | Work is sequenced or accepted |
| [decisions.md](./decisions.md) | Why is it this way and not the obvious alternative? | A direction is chosen or reversed |

## How these change

**Add to the document that already owns the subject.** A new state rule edits
`state-model.md`; a scope change edits `prd.md`. Growth is not a reason to create
a file.

**A bug is a missing scenario, not a new document.** Write the scenario that
would have caught it, then fix the code. If a screen needs a state the model does
not define, the model changes first — the code never invents state.

**A new file needs a new domain, not new work.** The verification engine will get
its own spec because it is a separate module with its own contract. "There is
more to do" never justifies one.

**`decisions.md` is the exception, and it is append-only.** A reversal is a new
entry that marks the earlier one superseded — never an edit over the top. D1 and
D3 were both reversed during design, and the record of that reasoning is worth
more than a tidy file.

## Conventions

Acceptance criteria are `WHEN` / `THEN` scenarios, borrowed from OpenSpec's
requirement format; the tool itself is not used (D11). Diagrams are Mermaid in
Markdown — GitHub renders them, and they diff as text.
