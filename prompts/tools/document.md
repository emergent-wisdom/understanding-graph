# Document Tools

## Navigate Documents

| Goal | Tool |
|------|------|
| List documents | `doc_list_roots()` |
| See structure | `doc_get_tree({ rootId, brief: true })` |
| Context/location | `doc_navigate({ nodeId })` |
| Read content | `doc_read({ nodeId })` |
| Regenerate all docs | `doc_generate_all()` |

---

## Strategic Reading Pattern

Don't load entire documents. Navigate like a researcher - jump to key sections first:

```
1. doc_list_roots()                        # What documents exist?
2. doc_get_tree({ rootId, brief: true })   # See structure (no content)
3. doc_navigate({ nodeId: "abstract" })    # Jump to abstract
4. doc_read({ nodeId: "abstract" })        # Read just that section
5. doc_navigate({ nodeId: "conclusion" })  # Jump to conclusion
6. doc_read({ nodeId: "conclusion" })      # Read just that section
7. [Now you understand the paper - dive deeper if needed]
```

**Example: Understanding a 50-page paper**
```javascript
// 1. Get the map
doc_get_tree({ rootId: "n_paper", brief: true })
// -> Abstract (n_abs), Introduction (n_intro), Methods (n_meth),
//   Results (n_res), Discussion (n_disc), Conclusion (n_conc)

// 2. Read strategically (not linearly)
doc_read({ nodeId: "n_abs" })    // What's the claim?
doc_read({ nodeId: "n_conc" })   // What did they find?
doc_read({ nodeId: "n_meth" })   // Only if methods matter for your task

// 3. Use navigate for context
doc_navigate({ nodeId: "n_res" })
// -> Shows siblings, children, parent - orient before loading
```

This minimizes context consumption. Load structure first, content selectively.

---

## Create Documents

```javascript
graph_batch({
  operations: [
    { tool: "doc_create", params: {
        title: "Paper Title",       // <- node name
        level: "document",          // <- level, not docType
        content: "# Introduction...",
        isDocRoot: true,
        fileType: "md"
    }},
    { tool: "doc_create", params: {
        title: "Methods",
        level: "section",
        content: "## Methods...",
        parentId: "$0.id"           // <- links to root
    }},
    { tool: "doc_create", params: {
        title: "Results",
        level: "section",
        content: "## Results...",
        parentId: "$0.id",
        afterId: "$1.id"            // <- ordering
    }}
  ]
})
```

---

## Never Read Files Directly - Use Document Tools

**The graph is the source of truth. Files are ephemeral projections.**

### Why This Matters

When documents exist in the graph, they have:
- **Node IDs** that link them to the knowledge web
- **Edges** connecting them to concepts they discuss
- **Metadata** (triggers, timestamps, sessions)
- **History** showing how they evolved

When you read a file directly with `Read`, you get:
- Raw text with no context
- No links to related concepts
- No way to trace what the document expresses
- Wasted context on content that may be stale

### The Rule

| Want to... | WRONG | CORRECT |
|------------|-------|---------|
| Read a document | `Read({ file_path: "generated/paper.md" })` | `doc_read({ nodeId: "n_paper" })` |
| See document structure | `Read` the whole file | `doc_get_tree({ rootId, brief: true })` |
| Find where you are | Scroll through file | `doc_navigate({ nodeId })` |
| List all documents | `Glob({ pattern: "**/*.md" })` | `doc_list_roots()` |

### When Files Don't Exist in Graph

Sometimes you encounter files that genuinely aren't in the graph (external files, user uploads, non-document code). In those cases, `Read` is appropriate.

**But for anything in `generated/`, `projects/*/generated/`, or any document YOU created** - always use document tools.
