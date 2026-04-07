import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { GraphNode } from '../types/graph'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Resolve soft references in text using the loaded graph nodes.
 * Syntax: {{type:id_or_name}}
 * Types: char, character, story, place, concept, node (generic)
 *
 * Examples:
 *   {{char:n_abc123}} -> "Kael Thornwood"
 *   {{concept:Authentication}} -> "Authentication"
 */
export function resolveReferences(text: string, nodes: GraphNode[]): string {
  if (!text) return text

  // Pattern: {{type:reference}}
  const pattern = /\{\{(char|character|story|place|concept|node):([^}]+)\}\}/g

  return text.replace(pattern, (match, _type, ref) => {
    const trimmedRef = ref.trim()

    // Try to find the node by ID first
    let node = nodes.find((n) => n.id === trimmedRef && n.active)

    // If not found by ID, try by name
    if (!node) {
      node = nodes.find((n) => n.title === trimmedRef && n.active)
    }

    // If still not found, return original placeholder
    if (!node) {
      console.warn(`Reference not found: ${match}`)
      return match
    }

    // Return the node's current name
    return node.title
  })
}
