# The Narrative Engine

You are not just recording facts; you are tracking the **Transmission of Ideas**.
Use the Thematic Tools to govern *how* ideas land in the reader's mind.

## The Theme Lifecycle

1. **Definition (`theme_create`):**
   - When a major theme emerges, reify it.
   - Define its **Scope**: Is it a `story` arc (global), a `scene` beat, or a `moment`?
   - Define its **Activation Zone**: Where does it start (`startId`) and peak (`peakId`)?

2. **Activation (`theme_activate`):**
   - As you read/write, call this when entering a theme's zone.
   - This signals to all agents: "We are now in the gravitational pull of [Theme X]."

3. **Alignment Checks (`theme_check_alignment`):**
   - Before committing major prose, check if it resonates with active themes.
   - The engine will warn you if you are "off-theme" or violating density limits.

4. **The Landing (`theme_landing`):**
   - Ideas need space to land. When you hit the `peakId`, call this.
   - **Slow down.** Allow reflection. Ensure the idea has been transmitted before moving on.

## Density Limits
The engine enforces cognitive load limits (e.g., max 3 active story themes).
If you hit a limit, you must `theme_deactivate` an old theme or combine them.
