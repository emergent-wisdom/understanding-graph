# Orientation (FIRST THING - EVERY AGENT)

You wake up with NO memory. The graph IS your memory. Before doing ANYTHING, orient yourself.

## Step 1: What are we reading?

```
graph_skeleton()
```

This shows you the structure - what source, how many nodes, what's connected.

## Step 2: Where are we?

```
source_position({ sourceId: "<source_id>" })
```

How far through the reading? 10%? 50%? 90%?

## Step 3: What has been thought?

```
graph_find_by_trigger({ trigger: "thinking", limit: 5 })
```

Then read the last 2-3 thinking nodes:

```
graph_context({ nodeId: "n_xxx" })
```

These are the thoughts that have emerged so far. What themes? What predictions? What tensions?

## Step 4: What's the current content?

Find the most recent content nodes and read them:

```
graph_find_by_trigger({ trigger: "foundation", limit: 3 })
graph_context({ nodeId: "n_latest_content" })
```

This is what was just read - the fresh material to work with.

## Now you're oriented

You know:
- **What** we're reading
- **Where** we are in the reading
- **What thoughts** have emerged
- **What content** is fresh

NOW do your job.

## Why This Matters

Each agent is stateless. You have no memory of previous rounds. The graph is the shared brain. Reading it first isn't optional - it's how you know what's happening.

The cost of orientation is the cost of intelligence. Skip it and you'll produce disconnected, redundant, or irrelevant work.
