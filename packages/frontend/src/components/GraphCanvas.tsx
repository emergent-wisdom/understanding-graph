import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { useGraph } from '@/hooks/useApi'
import {
  DEFAULT_COLOR_HEX,
  getTriggerColorHex,
  triggerColorsHex,
} from '@/lib/colors'
import { ALL_TRIGGER_TYPES, useAppStore } from '@/stores/appStore'
import type { GraphEdge, GraphNode, TriggerType } from '@/types/graph'
import { SearchBar } from './SearchBar'

const TRIGGER_COLORS = triggerColorsHex as Record<TriggerType, string>

const DEFAULT_COLOR = DEFAULT_COLOR_HEX
const DOCUMENT_COLOR = '#e4e4e7' // Off-white/light grey for document nodes
const DOCUMENT_ROOT_COLOR = '#71717a' // Darker grey for document root nodes
const THINKING_NODE_COLOR = '#a78bfa' // Purple for thinking/reasoning trace nodes

// --- Three.js resource sharing ---
// react-force-graph-3d calls our `nodeThreeObject` callback whenever node
// objects need to be (re)built — every graph-data change, every filter
// toggle, every hover. THREE.js geometries and materials live on the GPU and
// are NOT reclaimed by JavaScript GC; they must be `.dispose()`d explicitly.
// Allocating fresh `SphereGeometry` + `MeshLambertMaterial` per call leaks
// GPU memory monotonically until the WebGL context exhausts and the browser
// tab freezes. Fix: one shared geometry for every node, plus a small cache
// of materials keyed by (color, opacity). Bounded: about a dozen distinct
// trigger colors × two opacities (1 and 0.25 for superseded).
const SHARED_NODE_GEOMETRY = new THREE.SphereGeometry(4, 16, 16)
const NODE_MATERIAL_CACHE = new Map<string, THREE.MeshLambertMaterial>()
function getNodeMaterial(
  color: string,
  opacity: number,
): THREE.MeshLambertMaterial {
  const key = `${color}|${opacity}`
  let mat = NODE_MATERIAL_CACHE.get(key)
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    })
    NODE_MATERIAL_CACHE.set(key, mat)
  }
  return mat
}

interface Node3D {
  id: string
  name: string
  color: string
  isDocument?: boolean
  isSuperseded?: boolean
  x?: number
  y?: number
  z?: number
}

interface Link3D {
  source: string | Node3D
  target: string | Node3D
  edgeData: GraphEdge
}

export function GraphCanvas() {
  // biome-ignore lint/suspicious/noExplicitAny: ForceGraph ref types are complex
  const fgRef = useRef<any>(null)
  const {
    selectNode,
    selectEdge,
    selectAndFlyToNode,
    selectedNodeId,
    currentProject,
    nodeLimit,
    hiddenTriggerTypes,
    showDocuments,
    showSuperseded,
    toggleTriggerType,
    setShowDocuments,
    setShowSuperseded,
    resetFilters,
    pendingFlyToNodeId,
    clearPendingFly,
    highlightedNodeIds,
    highlightedEdgeIds,
    timelineExpanded,
    timelineRange,
    timelineSpan,
    setTimelineExpanded,
    setTimelineRange,
    setTimelineSpan,
  } = useAppStore()
  const projectReady = useAppStore((s) => s.projectReady)
  const { data: apiData, isLoading } = useGraph(projectReady, showSuperseded)

  // Hovered state (for tooltips and visual highlighting)
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  // Local hovered-node tooltip state. Used to live in the Zustand store
  // (useAppStore's hoveredNode/setHoveredNode), but hover events fire many
  // times per second — especially during a 1s camera-fly animation, when
  // the raycaster keeps finding different nodes under a stationary cursor
  // as the scene slides past. Any component subscribed to the store (such
  // as DetailsPanel, which historically did `useAppStore()` without a
  // selector) would re-render on every one of those hovers and remount
  // the <NodeLink> the user was hovering/clicking, producing the
  // "node link flicker after one click" bug. Keeping hover state local to
  // GraphCanvas means only GraphCanvas + HoverTooltip re-render on hover.
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)

  // Track container dimensions for responsive rendering
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width, height })
      }
    })

    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  // --- three.js OrbitControls pointer-tracking bug workaround ---
  // Upstream bug in three/examples/jsm/controls/OrbitControls.js (at least
  // through three@0.182): `onPointerUp` case 1 reads
  // `this._pointerPositions[pointerId].x` without checking whether the
  // position was ever populated. `_trackPointer` is only called from
  // `_onTouchStart`, which only runs for `pointerType === 'touch'`, so
  // mouse/pen pointers that went through `_onMouseDown` are never added
  // to `_pointerPositions`. On multi-pointer flows — touch-screen laptops
  // that fire a trailing touch pointer, pen + trackpad, stale captured
  // pointer after tab focus changes, or the browser replaying events on
  // re-focus — a pointerup that reduces `_pointers` to length 1 tries to
  // transition back into touch mode with the remaining pointer and crashes
  // with `Cannot read properties of undefined (reading 'x')`, taking the
  // whole canvas with it. The crash happens intermittently when clicking
  // node links in the right sidebar because that click path releases a
  // pointer capture the canvas was still holding.
  //
  // Fix: attach a capture-phase `pointerdown` listener on the canvas's
  // dom element that pre-populates `_pointerPositions[pointerId]` with a
  // THREE.Vector2 before OrbitControls' own pointerdown handler runs.
  // `_trackPointer` will overwrite the coordinates later for touch/move
  // events via `position.set(…)`, so seeding with a real Vector2 (not a
  // plain `{x, y}`) keeps the .set path alive on subsequent moves.
  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return
    let cleanup: (() => void) | null = null
    let cancelled = false

    const tryPatch = () => {
      if (cancelled || cleanup) return
      const fg = fgRef.current
      if (!fg || typeof fg.controls !== 'function') {
        requestAnimationFrame(tryPatch)
        return
      }
      // biome-ignore lint/suspicious/noExplicitAny: reaching into OrbitControls
      const controls: any = fg.controls()
      if (!controls || !controls.domElement || !controls._pointerPositions) {
        requestAnimationFrame(tryPatch)
        return
      }

      const seedPointerPosition = (e: PointerEvent) => {
        if (controls._pointerPositions[e.pointerId] !== undefined) return
        controls._pointerPositions[e.pointerId] = new THREE.Vector2(
          e.pageX,
          e.pageY,
        )
      }
      controls.domElement.addEventListener(
        'pointerdown',
        seedPointerPosition as EventListener,
        true,
      )
      cleanup = () => {
        controls.domElement.removeEventListener(
          'pointerdown',
          seedPointerPosition as EventListener,
          true,
        )
      }
    }

    tryPatch()
    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
  }, [dimensions.width, dimensions.height])

  // Keyboard navigation - track camera angle in ref
  const cameraAngle = useRef({ theta: 0, phi: Math.PI / 2, distance: 500 })

  // Helper to update camera position from spherical coordinates
  const updateCamera = useCallback(
    (angle: { theta: number; phi: number; distance: number }) => {
      const fg = fgRef.current
      if (!fg) return
      const x = angle.distance * Math.sin(angle.phi) * Math.sin(angle.theta)
      const y = angle.distance * Math.cos(angle.phi)
      const z = angle.distance * Math.sin(angle.phi) * Math.cos(angle.theta)
      fg.cameraPosition({ x, y, z }, { x: 0, y: 0, z: 0 }, 0)
    },
    [],
  )

  // Sort nodes by creation time for timeline (oldest first)
  const sortedNodes = useMemo(() => {
    const nodes = apiData?.nodes || []
    return [...nodes].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateA - dateB // oldest first
    })
  }, [apiData?.nodes])
  const sortedNodeIds = useMemo(
    () => sortedNodes.map((n) => n.id),
    [sortedNodes],
  )

  // Build neighbor connection map for ↑↓ navigation
  const neighborConnectionCounts = useMemo(() => {
    const edges = apiData?.edges || []
    const counts = new Map<string, number>()
    for (const edge of edges) {
      counts.set(edge.from, (counts.get(edge.from) || 0) + 1)
      counts.set(edge.to, (counts.get(edge.to) || 0) + 1)
    }
    return counts
  }, [apiData?.edges])

  // Get neighbors of a node
  const getNeighbors = useCallback(
    (nodeId: string) => {
      const edges = apiData?.edges || []
      const neighbors: string[] = []
      for (const edge of edges) {
        if (edge.from === nodeId) neighbors.push(edge.to)
        if (edge.to === nodeId) neighbors.push(edge.from)
      }
      return neighbors
    },
    [apiData?.edges],
  )

  // Navigation history for ↑↓ hub climbing (↑ pushes, ↓ pops back)
  const hubHistoryRef = useRef<string[]>([])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      const fg = fgRef.current
      if (!fg) return

      const angle = cameraAngle.current
      const rotateSpeed = 0.1

      switch (e.key) {
        // Zoom
        case '=':
        case '+':
          angle.distance = Math.max(50, angle.distance * 0.9)
          updateCamera(angle)
          break
        case '-':
        case '_':
          angle.distance = angle.distance * 1.1
          updateCamera(angle)
          break

        // Reset view
        case 'r':
        case 'R':
          fg.zoomToFit(400, 50)
          break

        // Escape to deselect
        case 'Escape':
          selectNode(null)
          setHoveredNode(null)
          break

        // WASD for camera rotation
        case 'a':
        case 'A':
          e.preventDefault()
          angle.theta -= rotateSpeed
          updateCamera(angle)
          break
        case 'd':
        case 'D':
          e.preventDefault()
          angle.theta += rotateSpeed
          updateCamera(angle)
          break
        case 'w':
        case 'W':
          e.preventDefault()
          angle.phi = Math.max(0.1, angle.phi - rotateSpeed)
          updateCamera(angle)
          break
        case 's':
        case 'S':
          e.preventDefault()
          angle.phi = Math.min(Math.PI - 0.1, angle.phi + rotateSpeed)
          updateCamera(angle)
          break

        // Arrow left/right for chronological node navigation
        case 'ArrowLeft':
          e.preventDefault()
          if (selectedNodeId) {
            const currentIdx = sortedNodeIds.indexOf(selectedNodeId)
            if (currentIdx > 0) {
              selectAndFlyToNode(sortedNodeIds[currentIdx - 1])
            }
          } else if (sortedNodeIds.length > 0) {
            selectAndFlyToNode(sortedNodeIds[sortedNodeIds.length - 1])
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (selectedNodeId) {
            const currentIdx = sortedNodeIds.indexOf(selectedNodeId)
            if (currentIdx < sortedNodeIds.length - 1) {
              selectAndFlyToNode(sortedNodeIds[currentIdx + 1])
            }
          } else if (sortedNodeIds.length > 0) {
            selectAndFlyToNode(sortedNodeIds[0])
          }
          break

        // Arrow up: climb to more connected neighbor (push current to history)
        // Arrow down: go back in history
        case 'ArrowUp':
          e.preventDefault()
          if (selectedNodeId) {
            const neighbors = getNeighbors(selectedNodeId)
            const currentCount =
              neighborConnectionCounts.get(selectedNodeId) || 0
            // Find neighbors with MORE connections than current
            const moreConnected = neighbors.filter(
              (n) => (neighborConnectionCounts.get(n) || 0) > currentCount,
            )
            if (moreConnected.length > 0) {
              // Push current node to history before moving
              hubHistoryRef.current.push(selectedNodeId)
              // Jump to the most connected one
              const sorted = moreConnected.sort(
                (a, b) =>
                  (neighborConnectionCounts.get(b) || 0) -
                  (neighborConnectionCounts.get(a) || 0),
              )
              selectAndFlyToNode(sorted[0])
            }
          }
          break
        case 'ArrowDown':
        case 'Backspace':
          e.preventDefault()
          // Go back in hub history
          if (hubHistoryRef.current.length > 0) {
            const previousNode = hubHistoryRef.current.pop()
            if (previousNode) {
              selectAndFlyToNode(previousNode)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectNode,
    updateCamera,
    selectedNodeId,
    sortedNodeIds,
    selectAndFlyToNode,
    getNeighbors,
    neighborConnectionCounts,
  ])

  // Compute visible node IDs based on timeline range
  const timelineFilter = useMemo(() => {
    if (!timelineRange) {
      return null // No filtering - show all
    }

    const [start, end] = timelineRange
    const visibleIds = new Set(sortedNodeIds.slice(start, end + 1))
    return visibleIds
  }, [timelineRange, sortedNodeIds])

  // Transform data - library handles diffing internally by node id
  // Apply filters: nodeLimit, trigger types, documents, timeline
  const graphData = useMemo(() => {
    let nodes = apiData?.nodes || []
    const supersededNodeIds = new Set(apiData?.supersededNodeIds || [])

    // Apply timeline filter first (most restrictive)
    if (timelineFilter) {
      nodes = nodes.filter((n) => timelineFilter.has(n.id))
    }

    // Filter by trigger type (only for concept nodes, not documents)
    if (hiddenTriggerTypes.size > 0) {
      nodes = nodes.filter((n) => {
        const isDocumentNode = Boolean(n.content || n.isDocRoot || n.level)
        if (isDocumentNode) return true // Don't filter documents by trigger
        return !hiddenTriggerTypes.has(n.trigger as TriggerType)
      })
    }

    // Filter documents
    if (!showDocuments) {
      nodes = nodes.filter((n) => !(n.content || n.isDocRoot || n.level))
    }

    // If nodeLimit is set, sort by createdAt descending and take newest N
    if (nodeLimit !== null && nodeLimit > 0) {
      nodes = [...nodes]
        .sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return dateB - dateA // newest first
        })
        .slice(0, nodeLimit)
    }

    const visibleNodeIds = new Set(nodes.map((n) => n.id))

    // Only include edges where both nodes are visible
    const edges = (apiData?.edges || []).filter(
      (e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
    )

    return {
      nodes: nodes.map((n) => {
        // Document nodes get special color - root nodes darker, thinking nodes purple
        const isDocumentNode = Boolean(n.content || n.isDocRoot || n.level)
        const isRootNode = Boolean(n.isDocRoot)
        const isThinkingNode = n.trigger === 'thinking'
        const isSuperseded = supersededNodeIds.has(n.id)
        const color = isRootNode
          ? DOCUMENT_ROOT_COLOR
          : isThinkingNode
            ? THINKING_NODE_COLOR
            : isDocumentNode
              ? DOCUMENT_COLOR
              : TRIGGER_COLORS[n.trigger as TriggerType] || DEFAULT_COLOR
        return {
          id: n.id,
          name: n.title,
          color,
          isDocument: isDocumentNode,
          isSuperseded,
        }
      }),
      links: edges.map((e) => ({
        source: e.from,
        target: e.to,
        edgeData: e,
      })),
    }
  }, [apiData, nodeLimit, hiddenTriggerTypes, showDocuments, timelineFilter])

  // Zoom to fit when data first loads
  const hasData = graphData.nodes.length > 0
  const didInitialZoom = useRef(false)
  useEffect(() => {
    if (hasData && !didInitialZoom.current && fgRef.current) {
      didInitialZoom.current = true
      setTimeout(() => {
        fgRef.current?.zoomToFit(400, 50)
      }, 500)
    }
  }, [hasData])

  // Center view when project changes - keep zoom level, just recenter
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on project change
  useEffect(() => {
    didInitialZoom.current = false
    // Wait for new data to load, then center the view
    setTimeout(() => {
      const fg = fgRef.current
      if (!fg) return

      // Get current camera distance (zoom level)
      const currentPos = fg.cameraPosition()
      const distance =
        Math.sqrt(
          currentPos.x * currentPos.x +
            currentPos.y * currentPos.y +
            currentPos.z * currentPos.z,
        ) || 300

      // Move camera to look at origin (graph center) from current distance
      fg.cameraPosition({ x: 0, y: 0, z: distance }, { x: 0, y: 0, z: 0 }, 500)
    }, 500)
  }, [currentProject?.id])

  // Fly to node when requested (e.g., from navigation buttons)
  useEffect(() => {
    if (!pendingFlyToNodeId || !fgRef.current) return
    clearPendingFly()

    // Find the node in the graph to get its position
    const fg = fgRef.current
    const graphNodes = fg.graphData?.()?.nodes || graphData.nodes
    const targetNode = graphNodes.find(
      (n: Node3D) => n.id === pendingFlyToNodeId,
    )

    if (targetNode && targetNode.x !== undefined) {
      const distance = 150
      fg.cameraPosition(
        { x: targetNode.x, y: targetNode.y, z: (targetNode.z || 0) + distance },
        { x: targetNode.x, y: targetNode.y, z: targetNode.z || 0 },
        1000,
      )
    }
  }, [pendingFlyToNodeId, clearPendingFly, graphData.nodes])

  const handleNodeClick = useCallback(
    (node: Node3D) => {
      selectNode(node.id)
      // Fly camera to node
      if (fgRef.current && node.x !== undefined) {
        const distance = 150
        fgRef.current.cameraPosition(
          { x: node.x, y: node.y, z: (node.z || 0) + distance },
          { x: node.x, y: node.y, z: node.z || 0 },
          1000,
        )
      }
    },
    [selectNode],
  )

  const handleNodeHover = useCallback(
    (node: Node3D | null) => {
      setHoveredNodeId(node?.id || null)
      const originalNode = apiData?.nodes.find((n) => n.id === node?.id)
      if (node && originalNode) {
        setHoveredNode({
          id: node.id,
          title: originalNode.title,
          why: originalNode.why,
          understanding: originalNode.understanding,
          trigger: originalNode.trigger,
          active: true,
          version: 1,
        })
        setHoveredEdge(null) // Clear edge hover when hovering node
        setHoveredEdgeId(null)
      } else {
        setHoveredNode(null)
      }
      document.body.style.cursor = node ? 'pointer' : 'default'
    },
    [apiData?.nodes],
  )

  const handleLinkClick = useCallback(
    (link: Link3D) => {
      if (link.edgeData) {
        selectEdge(link.edgeData.id)
      }
    },
    [selectEdge],
  )

  const handleLinkHover = useCallback((link: Link3D | null) => {
    setHoveredEdgeId(link?.edgeData?.id || null)
    if (link?.edgeData) {
      setHoveredEdge(link.edgeData)
      setHoveredNode(null) // Clear node hover when hovering edge
      setHoveredNodeId(null)
    } else {
      setHoveredEdge(null)
    }
    document.body.style.cursor = link ? 'pointer' : 'default'
  }, [])

  if (!currentProject) {
    return (
      <div className="absolute inset-0 bg-bg-base flex items-center justify-center">
        <div className="text-center">
          <p className="text-base text-text-secondary mb-3">
            Select a project to view its graph
          </p>
          <p className="text-sm text-text-muted bg-bg-surface px-4 py-2 rounded-lg border border-border-subtle">
            Use Claude Code in your terminal
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-bg-base flex flex-col">
      {/* Graph container */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ForceGraph3D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeId="id"
            nodeLabel="name"
            nodeColor={(node: Node3D) => {
              if (node.id === hoveredNodeId) return '#ffffff'
              if (highlightedNodeIds.has(node.id)) return '#fbbf24' // Yellow for commit highlight
              return node.color
            }}
            nodeRelSize={6}
            nodeThreeObject={(node: Node3D) => {
              // Use custom Three.js objects - superseded nodes are transparent.
              // Geometry and material are shared/cached at module scope to
              // avoid the GPU memory leak that comes from `new`ing them per
              // call (see SHARED_NODE_GEOMETRY / NODE_MATERIAL_CACHE above).
              const isHovered = node.id === hoveredNodeId
              const isHighlighted = highlightedNodeIds.has(node.id)
              const baseColor = isHovered
                ? '#ffffff'
                : isHighlighted
                  ? '#fbbf24'
                  : node.color || DEFAULT_COLOR
              const opacity = node.isSuperseded ? 0.25 : 1
              return new THREE.Mesh(
                SHARED_NODE_GEOMETRY,
                getNodeMaterial(baseColor, opacity),
              )
            }}
            nodeThreeObjectExtend={false}
            // Link styling - highlight on hover or when connected to hovered node
            linkColor={(link: Link3D) => {
              // Direct edge hover
              if (link.edgeData?.id === hoveredEdgeId) return '#818cf8'
              // Highlighted from commit hover
              if (link.edgeData?.id && highlightedEdgeIds.has(link.edgeData.id))
                return '#fbbf24'
              // Connected to hovered node
              if (hoveredNodeId) {
                const sourceId =
                  typeof link.source === 'string'
                    ? link.source
                    : link.source?.id
                const targetId =
                  typeof link.target === 'string'
                    ? link.target
                    : link.target?.id
                if (sourceId === hoveredNodeId || targetId === hoveredNodeId) {
                  return '#818cf8'
                }
              }
              return '#3f3f46'
            }}
            linkWidth={(link: Link3D) => {
              // Direct edge hover
              if (link.edgeData?.id === hoveredEdgeId) return 3
              // Highlighted from commit hover
              if (link.edgeData?.id && highlightedEdgeIds.has(link.edgeData.id))
                return 2.5
              // Connected to hovered node
              if (hoveredNodeId) {
                const sourceId =
                  typeof link.source === 'string'
                    ? link.source
                    : link.source?.id
                const targetId =
                  typeof link.target === 'string'
                    ? link.target
                    : link.target?.id
                if (sourceId === hoveredNodeId || targetId === hoveredNodeId) {
                  return 2
                }
              }
              return 1
            }}
            linkOpacity={0.6}
            linkHoverPrecision={2}
            linkDirectionalArrowLength={6}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={() => '#52525b'}
            // Interaction
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onLinkClick={handleLinkClick}
            onLinkHover={handleLinkHover}
            enableNodeDrag={true}
            enableNavigationControls={true}
            // Simulation - use defaults but set reasonable cooldown
            cooldownTime={3000}
            warmupTicks={50}
            // Visual
            backgroundColor="#050505"
            showNavInfo={false}
            controlType="orbit"
          />
        )}

        {/* Stats overlay — hidden on mobile */}
        <div className="hidden sm:flex absolute top-4 left-1/2 -translate-x-1/2 bg-bg-surface/90 backdrop-blur-md px-4 py-2 rounded-lg text-xs border border-border-subtle shadow-md gap-3 items-center z-50">
          <span className="text-text-muted">
            <strong className="text-text-primary">
              {graphData.nodes.length}
              {(nodeLimit !== null ||
                hiddenTriggerTypes.size > 0 ||
                !showDocuments) &&
                apiData?.nodes && (
                  <span className="text-text-muted font-normal">
                    /{apiData.nodes.length}
                  </span>
                )}
            </strong>{' '}
            nodes
          </span>
          <span className="text-text-muted">
            <strong className="text-text-primary">
              {graphData.links.length}
            </strong>{' '}
            edges
          </span>
          <div className="w-px h-4 bg-border-subtle" />
          <SearchBar />
          <div className="w-px h-4 bg-border-subtle" />
          <TriggerFilter
            hiddenTriggerTypes={hiddenTriggerTypes}
            showDocuments={showDocuments}
            showSuperseded={showSuperseded}
            toggleTriggerType={toggleTriggerType}
            setShowDocuments={setShowDocuments}
            setShowSuperseded={setShowSuperseded}
            resetFilters={resetFilters}
          />
          {isLoading && <span className="text-accent">Syncing...</span>}
          <CopyContextButton />
        </div>

        <HoverTooltip hoveredEdge={hoveredEdge} hoveredNode={hoveredNode} />
      </div>

      {/* Timeline footer — hidden on mobile */}
      <div className="hidden sm:block">
        <TimelineBar
          totalNodes={sortedNodeIds.length}
          expanded={timelineExpanded}
          range={timelineRange}
          span={timelineSpan}
          setExpanded={setTimelineExpanded}
          setRange={setTimelineRange}
          setSpan={setTimelineSpan}
          sortedNodes={sortedNodes}
          sortedNodeIds={sortedNodeIds}
          selectAndFlyToNode={selectAndFlyToNode}
        />
      </div>
    </div>
  )
}

function TimelineBar({
  totalNodes,
  expanded,
  range,
  span,
  setExpanded,
  setRange,
  setSpan,
  sortedNodes,
  sortedNodeIds,
  selectAndFlyToNode,
}: {
  totalNodes: number
  expanded: boolean
  range: [number, number] | null
  span: number
  setExpanded: (expanded: boolean) => void
  setRange: (range: [number, number] | null) => void
  setSpan: (span: number) => void
  sortedNodes: GraphNode[]
  sortedNodeIds: string[]
  selectAndFlyToNode: (id: string) => void
}) {
  // Evolution playback state
  const [evolutionIndex, setEvolutionIndex] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [evolutionMode, setEvolutionMode] = useState<'build' | 'navigate'>(
    'navigate',
  )
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track the start of the evolution range separately to detect external changes
  const evolutionStartRef = useRef<number>(0)

  // Compute the range of nodes evolution can navigate through
  // In navigate mode: if timeline is filtered, evolution works within that range
  // In build mode: we track the original start, and end expands as we navigate
  const evolutionRange = useMemo(() => {
    if (evolutionMode === 'build') {
      // In build mode, use the stored start and current totalNodes as potential end
      const start = evolutionStartRef.current
      return { start, end: totalNodes - 1, count: totalNodes - start }
    }
    if (range) {
      return { start: range[0], end: range[1], count: range[1] - range[0] + 1 }
    }
    return { start: 0, end: totalNodes - 1, count: totalNodes }
  }, [range, totalNodes, evolutionMode])

  // Reset evolution index when range START changes externally (not from build mode)
  const prevRangeStartRef = useRef<number | null>(null)
  // Sync evolutionStartRef on first render so autoplay/navigation start correctly
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only run on mount
  useEffect(() => {
    const initialStart = range ? range[0] : 0
    evolutionStartRef.current = initialStart
  }, [])
  useEffect(() => {
    const newStart = range ? range[0] : 0
    // Only reset if the start actually changed and we're not in build mode
    if (
      evolutionMode !== 'build' &&
      prevRangeStartRef.current !== null &&
      prevRangeStartRef.current !== newStart
    ) {
      setEvolutionIndex(0)
      evolutionStartRef.current = newStart
    }
    prevRangeStartRef.current = newStart
  }, [range, evolutionMode])

  // When switching modes, handle range appropriately
  // biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on mode change
  useEffect(() => {
    if (evolutionMode === 'build') {
      // Entering build mode: remember start and show only first node
      const start = range ? range[0] : 0
      evolutionStartRef.current = start
      setEvolutionIndex(0)
      setRange([start, start])
      if (sortedNodeIds[start]) {
        selectAndFlyToNode(sortedNodeIds[start])
      }
    } else {
      // Entering navigate mode: show all nodes (clear range filter)
      setRange(null)
      setEvolutionIndex(0)
    }
  }, [evolutionMode])

  // Navigate to a specific node by evolution index (relative to range)
  const goToNode = useCallback(
    (relativeIndex: number) => {
      if (relativeIndex >= 0 && relativeIndex < evolutionRange.count) {
        const absoluteIndex = evolutionRange.start + relativeIndex
        setEvolutionIndex(relativeIndex)

        // In build mode, set the timeline range first, then fly after render
        if (evolutionMode === 'build') {
          setRange([evolutionRange.start, absoluteIndex])
          setTimeout(() => {
            selectAndFlyToNode(sortedNodeIds[absoluteIndex])
          }, 100)
        } else {
          selectAndFlyToNode(sortedNodeIds[absoluteIndex])
        }
      }
    },
    [
      evolutionRange,
      evolutionMode,
      sortedNodeIds,
      selectAndFlyToNode,
      setRange,
    ],
  )

  // Playback controls
  const play = useCallback(() => {
    setIsPlaying(true)
  }, [])

  const stop = useCallback(() => {
    setIsPlaying(false)
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current)
      playIntervalRef.current = null
    }
  }, [])

  const next = useCallback(() => {
    const nextIndex = Math.min(evolutionIndex + 1, evolutionRange.count - 1)
    goToNode(nextIndex)
  }, [evolutionIndex, evolutionRange.count, goToNode])

  const previous = useCallback(() => {
    const prevIndex = Math.max(evolutionIndex - 1, 0)
    goToNode(prevIndex)
  }, [evolutionIndex, goToNode])

  // Keep refs for interval callback to avoid stale closures
  const evolutionModeRef = useRef(evolutionMode)
  const evolutionRangeRef = useRef(evolutionRange)
  const sortedNodeIdsRef = useRef(sortedNodeIds)
  useEffect(() => {
    evolutionModeRef.current = evolutionMode
  }, [evolutionMode])
  useEffect(() => {
    evolutionRangeRef.current = evolutionRange
  }, [evolutionRange])
  useEffect(() => {
    sortedNodeIdsRef.current = sortedNodeIds
  }, [sortedNodeIds])

  // Auto-play effect - only depends on isPlaying to avoid interval recreation
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setEvolutionIndex((prev) => {
          const { start, count } = evolutionRangeRef.current
          const nextRelativeIndex = prev + 1

          if (nextRelativeIndex >= count) {
            setIsPlaying(false)
            return prev
          }

          const absoluteIndex = start + nextRelativeIndex

          // In build mode, update range first to show the new node
          if (evolutionModeRef.current === 'build') {
            setRange([start, absoluteIndex])
            // Delay fly so the node renders first
            setTimeout(() => {
              selectAndFlyToNode(sortedNodeIdsRef.current[absoluteIndex])
            }, 100)
          } else {
            selectAndFlyToNode(sortedNodeIdsRef.current[absoluteIndex])
          }

          return nextRelativeIndex
        })
      }, 2500) // 2.5 seconds per node (time to read)
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
    }
  }, [isPlaying, selectAndFlyToNode, setRange])
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<
    'left' | 'right' | 'middle' | null
  >(null)
  const dragStartRef = useRef({ x: 0, start: 0, end: 0 })

  const isFiltering = range !== null
  const [start, end] = range || [0, Math.max(0, totalNodes - 1)]
  const viewStart = isFiltering && totalNodes > 0 ? start / totalNodes : 0
  const viewEnd = isFiltering && totalNodes > 0 ? (end + 1) / totalNodes : 1

  // Handle mouse events for dragging
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: 'left' | 'right' | 'middle') => {
      e.preventDefault()
      setIsDragging(handle)
      dragStartRef.current = { x: e.clientX, start, end }
    },
    [start, end],
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaNodes = Math.round((deltaX / rect.width) * totalNodes)

      const { start: origStart, end: origEnd } = dragStartRef.current

      if (isDragging === 'middle') {
        // Move the whole window
        const windowSize = origEnd - origStart
        let newStart = origStart + deltaNodes
        newStart = Math.max(0, Math.min(newStart, totalNodes - windowSize - 1))
        setRange([newStart, newStart + windowSize])
      } else if (isDragging === 'left') {
        // Resize from left
        let newStart = origStart + deltaNodes
        newStart = Math.max(0, Math.min(newStart, origEnd - 10))
        setRange([newStart, origEnd])
        setSpan(origEnd - newStart + 1)
      } else if (isDragging === 'right') {
        // Resize from right
        let newEnd = origEnd + deltaNodes
        newEnd = Math.max(origStart + 10, Math.min(newEnd, totalNodes - 1))
        setRange([origStart, newEnd])
        setSpan(newEnd - origStart + 1)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, totalNodes, setRange, setSpan])

  // Enable filtering on click
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) return
      if (!trackRef.current) return
      if (isFiltering) return // Already filtering, use handles
      if (totalNodes === 0) return

      const rect = trackRef.current.getBoundingClientRect()
      const clickPos = (e.clientX - rect.left) / rect.width
      const centerNode = Math.floor(clickPos * totalNodes)
      const effectiveSpan = Math.min(span, totalNodes)
      const halfSpan = Math.floor(effectiveSpan / 2)
      const newStart = Math.max(
        0,
        Math.min(centerNode - halfSpan, totalNodes - effectiveSpan),
      )
      setRange([newStart, newStart + effectiveSpan - 1])
    },
    [isDragging, isFiltering, totalNodes, span, setRange],
  )

  // Show all
  const handleShowAll = useCallback(() => {
    setRange(null)
  }, [setRange])

  // Bucket sorted nodes into bars showing trigger type distribution
  const NUM_BARS = 50
  const barData = useMemo(() => {
    if (totalNodes === 0) {
      return Array.from({ length: NUM_BARS }, () => ({
        height: 0,
        color: DEFAULT_COLOR,
      }))
    }
    return Array.from({ length: NUM_BARS }, (_, i) => {
      const bucketStart = Math.floor((i / NUM_BARS) * totalNodes)
      const bucketEnd = Math.floor(((i + 1) / NUM_BARS) * totalNodes)
      const bucketNodes = sortedNodes.slice(
        bucketStart,
        Math.max(bucketEnd, bucketStart + 1),
      )
      // Height = number of nodes in bucket, scaled to fill the bar
      const maxBucketSize = Math.ceil(totalNodes / NUM_BARS) + 1
      const height = Math.max(15, (bucketNodes.length / maxBucketSize) * 100)
      // Color = most common trigger type in this bucket
      const counts = new Map<string | undefined, number>()
      for (const n of bucketNodes) {
        counts.set(n.trigger, (counts.get(n.trigger) || 0) + 1)
      }
      let topTrigger: string | null = null
      let topCount = 0
      for (const [t, c] of counts) {
        if (c > topCount) {
          topTrigger = t ?? null
          topCount = c
        }
      }
      const color = getTriggerColorHex(topTrigger)
      return { height, color }
    })
  }, [sortedNodes, totalNodes])

  // Keyboard shortcuts component - floats above timeline, blends into graph
  const KeyboardShortcuts = () => (
    <div className="absolute -top-8 left-1/2 -translate-x-1/2 pointer-events-none">
      <div className="flex gap-3 text-[10px] text-text-muted font-mono">
        <span>
          <kbd className="px-1 py-0.5 bg-bg-muted/80 rounded border border-border-subtle">
            WASD
          </kbd>{' '}
          rotate
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-bg-muted/80 rounded border border-border-subtle">
            ←→
          </kbd>{' '}
          prev/next
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-bg-muted/80 rounded border border-border-subtle">
            ↑↓
          </kbd>{' '}
          hub/back
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-bg-muted/80 rounded border border-border-subtle">
            +/-
          </kbd>{' '}
          zoom
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-bg-muted/80 rounded border border-border-subtle">
            R
          </kbd>{' '}
          reset
        </span>
      </div>
    </div>
  )

  // Collapsed state - just a thin bar to expand
  if (!expanded) {
    return (
      <div className="relative bg-bg-surface border-t border-border-subtle">
        <KeyboardShortcuts />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full h-6 flex items-center justify-center gap-2 text-text-muted hover:text-accent hover:bg-bg-muted/50 transition-colors"
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-[10px]">
            Timeline{' '}
            {isFiltering
              ? `(${start + 1}–${end + 1} of ${totalNodes})`
              : `(${totalNodes} nodes)`}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="relative bg-bg-surface border-t border-border-subtle">
      <KeyboardShortcuts />
      {/* Main container */}
      <div className="max-w-3xl mx-auto">
        {/* Header row */}
        <div className="h-8 px-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-text-muted hover:text-accent transition-colors"
              title="Collapse timeline"
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <span className="text-[10px] text-text-muted">
              {isFiltering ? `${start + 1}–${end + 1}` : 'All'} of {totalNodes}{' '}
              nodes
            </span>
          </div>

          {/* Evolution playback controls */}
          <div className="flex items-center gap-1">
            {/* Mode toggle */}
            <div className="flex rounded border border-border-subtle overflow-hidden mr-2">
              <button
                type="button"
                onClick={() => setEvolutionMode('navigate')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  evolutionMode === 'navigate'
                    ? 'bg-accent text-white'
                    : 'bg-bg-muted text-text-muted hover:text-accent'
                }`}
                title="Navigate mode - fly through existing graph"
              >
                Navigate
              </button>
              <button
                type="button"
                onClick={() => setEvolutionMode('build')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  evolutionMode === 'build'
                    ? 'bg-accent text-white'
                    : 'bg-bg-muted text-text-muted hover:text-accent'
                }`}
                title="Build mode - watch graph grow chronologically"
              >
                Build
              </button>
            </div>
            <span className="text-[10px] text-text-muted mr-2">
              {evolutionIndex + 1}/{evolutionRange.count}
              {range && (
                <span className="text-text-muted/60">
                  {' '}
                  (in {range[0] + 1}–{range[1] + 1})
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={previous}
              disabled={evolutionIndex === 0}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-accent transition-colors"
              title="Previous node"
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {isPlaying ? (
              <button
                type="button"
                onClick={stop}
                className="w-6 h-6 flex items-center justify-center rounded bg-accent-muted text-accent hover:bg-accent hover:text-white transition-colors"
                title="Stop"
              >
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="6" y="5" width="3" height="10" rx="0.5" />
                  <rect x="11" y="5" width="3" height="10" rx="0.5" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={play}
                disabled={evolutionIndex >= evolutionRange.count - 1}
                className="w-6 h-6 flex items-center justify-center rounded bg-bg-muted text-text-muted hover:bg-accent-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Play"
              >
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={next}
              disabled={evolutionIndex >= evolutionRange.count - 1}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-accent transition-colors"
              title="Next node"
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, evolutionRange.count - 1)}
              value={evolutionIndex}
              onChange={(e) => goToNode(Number.parseInt(e.target.value, 10))}
              className="w-24 h-1 ml-2 bg-bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
              title="Jump to position"
            />
          </div>

          {isFiltering && (
            <button
              type="button"
              onClick={handleShowAll}
              className="text-[10px] text-text-muted hover:text-accent transition-colors"
            >
              Show all
            </button>
          )}
        </div>

        {/* Range selector track */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-only interaction for slider track */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: slider track is a visual-only click target */}
        <div
          ref={trackRef}
          className="h-8 mx-3 my-2 relative cursor-pointer"
          onClick={handleTrackClick}
        >
          {/* Background track with node distribution bars */}
          <div className="absolute inset-0 bg-bg-muted rounded overflow-hidden flex items-end">
            {barData.map((bar, i) => {
              const barKey = `bar-${i}`
              return (
                <div
                  key={barKey}
                  className="flex-1 mx-px rounded-t-sm opacity-60"
                  style={{
                    height: `${bar.height}%`,
                    backgroundColor: bar.color,
                  }}
                />
              )
            })}
          </div>

          {/* Dimmed areas outside selection */}
          {isFiltering && (
            <>
              <div
                className="absolute top-0 bottom-0 left-0 bg-bg-base/70 rounded-l"
                style={{ width: `${viewStart * 100}%` }}
              />
              <div
                className="absolute top-0 bottom-0 right-0 bg-bg-base/70 rounded-r"
                style={{ width: `${(1 - viewEnd) * 100}%` }}
              />
            </>
          )}

          {/* Selection window */}
          {isFiltering && (
            <div
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={totalNodes}
              aria-valuenow={start}
              aria-label="Timeline range selector"
              className="absolute top-0 bottom-0 border-2 border-accent rounded cursor-move"
              style={{
                left: `${viewStart * 100}%`,
                width: `${(viewEnd - viewStart) * 100}%`,
              }}
              onMouseDown={(e) => handleMouseDown(e, 'middle')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft')
                  setRange([Math.max(0, start - 1), end - 1])
                if (e.key === 'ArrowRight')
                  setRange([start + 1, Math.min(totalNodes - 1, end + 1)])
              }}
            >
              {/* Left handle */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Adjust range start"
                aria-valuemin={0}
                aria-valuemax={end}
                aria-valuenow={start}
                className="absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-ew-resize flex items-center justify-center group"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleMouseDown(e, 'left')
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'ArrowLeft') {
                    setRange([Math.max(0, start - 1), end])
                    setSpan(end - Math.max(0, start - 1) + 1)
                  }
                  if (e.key === 'ArrowRight') {
                    setRange([Math.min(end - 10, start + 1), end])
                    setSpan(end - Math.min(end - 10, start + 1) + 1)
                  }
                }}
              >
                <div className="w-1 h-4 bg-accent rounded-full group-hover:h-6 transition-all" />
              </div>
              {/* Right handle */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Adjust range end"
                aria-valuemin={start}
                aria-valuemax={totalNodes}
                aria-valuenow={end}
                className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-ew-resize flex items-center justify-center group"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleMouseDown(e, 'right')
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'ArrowLeft') {
                    setRange([start, Math.max(start + 10, end - 1)])
                    setSpan(Math.max(start + 10, end - 1) - start + 1)
                  }
                  if (e.key === 'ArrowRight') {
                    setRange([start, Math.min(totalNodes - 1, end + 1)])
                    setSpan(Math.min(totalNodes - 1, end + 1) - start + 1)
                  }
                }}
              >
                <div className="w-1 h-4 bg-accent rounded-full group-hover:h-6 transition-all" />
              </div>
            </div>
          )}

          {/* Click hint when not filtering */}
          {!isFiltering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] text-text-muted bg-bg-surface/80 px-2 py-0.5 rounded">
                Click to select range
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HoverTooltip({
  hoveredEdge,
  hoveredNode,
}: {
  hoveredEdge: GraphEdge | null
  hoveredNode: GraphNode | null
}) {
  // Show edge tooltip
  if (hoveredEdge) {
    return (
      <div className="absolute bottom-32 left-1/2 -translate-x-1/2 bg-bg-surface/95 backdrop-blur-md border border-border-default border-l-2 border-l-industrial p-3 rounded-lg max-w-[280px] shadow-lg pointer-events-none z-[100]">
        <h4 className="text-sm font-medium text-text-primary mb-1">
          {hoveredEdge.explanation || 'Connection'}
        </h4>
        <p className="text-xs text-text-muted leading-relaxed">
          {hoveredEdge.why || 'No description available'}
        </p>
      </div>
    )
  }

  // Show node tooltip
  if (!hoveredNode) return null

  return (
    <div className="absolute bottom-32 left-1/2 -translate-x-1/2 bg-bg-surface/95 backdrop-blur-md border border-border-default border-l-2 border-l-accent p-3 rounded-lg max-w-[280px] shadow-lg pointer-events-none z-[100]">
      <h4 className="text-sm font-medium text-text-primary mb-1">
        {hoveredNode.title}
      </h4>
      <p className="text-xs text-text-muted leading-relaxed">
        {hoveredNode.why || 'No description available'}
      </p>
    </div>
  )
}

function CopyContextButton() {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied'>('idle')
  const [mode, setMode] = useState<'compact' | 'full'>('compact')
  const [showDropdown, setShowDropdown] = useState(false)

  const handleCopy = async (copyMode: 'compact' | 'full') => {
    setStatus('copying')
    setShowDropdown(false)
    try {
      const compact = copyMode === 'compact' ? 'true' : 'false'
      const res = await fetch(
        `/api/graph/context?showEvolution=false&compact=${compact}`,
      )
      if (!res.ok) throw new Error('Failed to fetch context')
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setMode(copyMode)
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 2000)
    } catch (error) {
      console.error('Error copying context:', error)
      setStatus('idle')
    }
  }

  return (
    <div className="relative ml-2">
      <div className="flex">
        <button
          type="button"
          onClick={() => handleCopy(mode)}
          disabled={status === 'copying'}
          className="px-2 py-1 text-xs bg-bg-muted hover:bg-accent-muted text-text-muted hover:text-accent rounded-l border border-border-subtle hover:border-accent transition-colors disabled:opacity-50"
        >
          {status === 'copying'
            ? 'Copying...'
            : status === 'copied'
              ? 'Copied!'
              : `Copy ${mode === 'compact' ? 'Compact' : 'Full'}`}
        </button>
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          className="px-1 py-1 text-xs bg-bg-muted hover:bg-accent-muted text-text-muted hover:text-accent rounded-r border border-l-0 border-border-subtle hover:border-accent transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Toggle dropdown</title>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {showDropdown && (
        <div className="absolute top-full right-0 mt-1 bg-bg-surface border border-border-subtle rounded shadow-lg z-50">
          <button
            type="button"
            onClick={() => handleCopy('compact')}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-accent-muted hover:text-accent transition-colors"
          >
            Compact
          </button>
          <button
            type="button"
            onClick={() => handleCopy('full')}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-accent-muted hover:text-accent transition-colors"
          >
            Full
          </button>
        </div>
      )}
    </div>
  )
}

function TriggerFilter({
  hiddenTriggerTypes,
  showDocuments,
  showSuperseded,
  toggleTriggerType,
  setShowDocuments,
  setShowSuperseded,
  resetFilters,
}: {
  hiddenTriggerTypes: Set<TriggerType>
  showDocuments: boolean
  showSuperseded: boolean
  toggleTriggerType: (type: TriggerType) => void
  setShowDocuments: (show: boolean) => void
  setShowSuperseded: (show: boolean) => void
  resetFilters: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const hasFilters = hiddenTriggerTypes.size > 0 || !showDocuments

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2 py-1 rounded border transition-colors flex items-center gap-1.5 ${
          hasFilters
            ? 'bg-accent-muted text-accent border-accent'
            : 'bg-bg-muted text-text-muted border-border-subtle hover:border-accent hover:text-accent'
        }`}
        title="Filter by node type"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z"
            clipRule="evenodd"
          />
        </svg>
        Type
        {hasFilters && (
          <span className="bg-accent text-white text-[10px] px-1 rounded-full">
            {hiddenTriggerTypes.size + (showDocuments ? 0 : 1)}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Backdrop overlay for dropdown */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled by dropdown */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 bg-bg-surface border border-border-default rounded-lg shadow-lg z-50 min-w-[180px] py-1">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted font-medium border-b border-border-subtle">
              Concept Types
            </div>
            {ALL_TRIGGER_TYPES.map((type) => {
              const isHidden = hiddenTriggerTypes.has(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleTriggerType(type)}
                  className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-bg-muted transition-colors text-left"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: isHidden
                        ? 'transparent'
                        : TRIGGER_COLORS[type],
                      border: isHidden
                        ? `1px solid ${TRIGGER_COLORS[type]}`
                        : 'none',
                    }}
                  />
                  <span
                    className={`text-xs capitalize ${isHidden ? 'text-text-muted line-through' : 'text-text-primary'}`}
                  >
                    {type}
                  </span>
                </button>
              )
            })}

            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted font-medium border-t border-b border-border-subtle mt-1">
              Other
            </div>
            <button
              type="button"
              onClick={() => setShowDocuments(!showDocuments)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-bg-muted transition-colors text-left"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: showDocuments
                    ? DOCUMENT_COLOR
                    : 'transparent',
                  border: showDocuments
                    ? 'none'
                    : `1px solid ${DOCUMENT_COLOR}`,
                }}
              />
              <span
                className={`text-xs ${!showDocuments ? 'text-text-muted line-through' : 'text-text-primary'}`}
              >
                Documents
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowSuperseded(!showSuperseded)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-bg-muted transition-colors text-left"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: showSuperseded ? '#6b7280' : 'transparent',
                  border: showSuperseded ? 'none' : '1px solid #6b7280',
                  opacity: showSuperseded ? 0.4 : 1,
                }}
              />
              <span
                className={`text-xs ${!showSuperseded ? 'text-text-muted' : 'text-text-primary'}`}
              >
                Superseded
              </span>
              <span className="text-[10px] text-text-muted ml-auto">
                (old versions)
              </span>
            </button>

            {hasFilters && (
              <div className="border-t border-border-subtle mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    resetFilters()
                    setIsOpen(false)
                  }}
                  className="w-full px-3 py-1.5 text-xs text-accent hover:bg-accent-muted transition-colors text-left"
                >
                  Reset all filters
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
