# Sema: Content-Addressed Vocabulary

Sema patterns are vocabulary words with cryptographic precision. The definition IS the identifier - hash the content, get the word. Same bytes = same meaning, forever.

## The Golden Rule: Lookup Before Minting

```javascript
// 1. Always check existing vocabulary first
sema_list()  // See all patterns
sema_lookup({ reference: "TrustModel" })  // Check by handle

// 2. Only mint if it doesn't exist AND you need precision:
sema_mint({ handle: "TrustModel", description: "..." })
```

## When to Use Patterns

- Before explaining a concept: check if a pattern exists
- Delegating to another agent: pass pattern references for precision
- In natural discourse: `"Let's use SteelmanFirst#4691 before critiquing"`

## When to Mint (only after lookup fails)

- Repetition: explaining the same concept 3+ times
- Invariants: concept has non-negotiable constraints
- Boundary: another agent needs exact protocol
- Saturation: graph concept refined 3+ times (stable enough to crystallize)

## Pattern Structure

```javascript
sema_mint({
  handle: "PatternName",           // 1-2 syllables, speakable
  gloss: "One-line summary",       // What it IS
  description: "Full definition",  // How to use it
  invariants: ["Must...", ...],    // Non-negotiable constraints
})
```

## At Boundaries - Verify

```javascript
sema_verify({ expected: "sema:X#...", actual: computed_hash })
// MISMATCH -> halt and clarify. No silent misunderstandings.
```
