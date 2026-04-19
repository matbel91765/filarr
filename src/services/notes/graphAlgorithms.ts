/**
 * Graph Algorithms — Filarr Notes
 *
 * Community detection (simplified Louvain) and recency scoring
 * for the knowledge graph visualization.
 */

import type { GraphEdge } from '../../types/notes';

export interface ClusterResult {
  /** Node ID → cluster ID */
  clusters: Map<string, number>;
  /** Cluster ID → color */
  colors: Map<number, string>;
  /** Number of clusters found */
  count: number;
}

const CLUSTER_COLORS = [
  '#4a9eed', // blue
  '#34d399', // green
  '#f97316', // orange
  '#a78bfa', // purple
  '#f472b6', // pink
  '#fbbf24', // amber
  '#14b8a6', // teal
  '#ef4444', // red
  '#6366f1', // indigo
  '#84cc16', // lime
];

/**
 * Simplified Louvain community detection.
 * Assigns each node to a cluster based on edge density.
 */
export function detectClusters(
  nodeIds: string[],
  edges: GraphEdge[]
): ClusterResult {
  if (nodeIds.length === 0) {
    return { clusters: new Map(), colors: new Map(), count: 0 };
  }

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const id of nodeIds) adj.set(id, new Set());

  for (const edge of edges) {
    adj.get(edge.source)?.add(edge.target);
    adj.get(edge.target)?.add(edge.source);
  }

  // Initialize: each node in its own cluster
  const nodeCluster = new Map<string, number>();
  nodeIds.forEach((id, i) => nodeCluster.set(id, i));

  const totalEdges = edges.length * 2; // undirected
  if (totalEdges === 0) {
    // No edges: all in cluster 0
    for (const id of nodeIds) nodeCluster.set(id, 0);
    return {
      clusters: nodeCluster,
      colors: new Map([[0, CLUSTER_COLORS[0]]]),
      count: 1,
    };
  }

  // Degree of each node
  const degree = new Map<string, number>();
  for (const id of nodeIds) degree.set(id, adj.get(id)?.size || 0);

  // Run iterations: move nodes to neighbor's cluster if modularity improves
  for (let iteration = 0; iteration < 10; iteration++) {
    let moved = false;

    for (const nodeId of nodeIds) {
      const currentCluster = nodeCluster.get(nodeId)!;
      const neighbors = adj.get(nodeId)!;
      if (neighbors.size === 0) continue;

      // Count edges to each neighbor cluster
      const clusterEdges = new Map<number, number>();
      for (const neighbor of neighbors) {
        const nc = nodeCluster.get(neighbor)!;
        clusterEdges.set(nc, (clusterEdges.get(nc) || 0) + 1);
      }

      // Find the cluster with most connections
      let bestCluster = currentCluster;
      let bestCount = clusterEdges.get(currentCluster) || 0;

      for (const [clusterId, count] of clusterEdges) {
        if (count > bestCount) {
          bestCluster = clusterId;
          bestCount = count;
        }
      }

      if (bestCluster !== currentCluster) {
        nodeCluster.set(nodeId, bestCluster);
        moved = true;
      }
    }

    if (!moved) break;
  }

  // Renumber clusters to be contiguous 0, 1, 2...
  const uniqueClusters = [...new Set(nodeCluster.values())];
  const remap = new Map<number, number>();
  uniqueClusters.forEach((c, i) => remap.set(c, i));

  const finalClusters = new Map<string, number>();
  for (const [id, c] of nodeCluster) {
    finalClusters.set(id, remap.get(c)!);
  }

  const colors = new Map<number, string>();
  for (let i = 0; i < uniqueClusters.length; i++) {
    colors.set(i, CLUSTER_COLORS[i % CLUSTER_COLORS.length]);
  }

  return {
    clusters: finalClusters,
    colors,
    count: uniqueClusters.length,
  };
}

/**
 * Calculate recency score for a node based on last update date.
 * Returns 0 (cold, >30 days) to 1 (hot, updated today).
 */
export function recencyScore(updatedAt: string): number {
  const daysSince = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - Math.min(1, daysSince / 30));
}

/**
 * Get heat map color from recency score (0→blue cold, 1→red hot).
 */
export function heatColor(score: number): { fill: string; glow: string } {
  // Interpolate from blue (#4a9eed) through yellow (#fbbf24) to red (#ef4444)
  if (score < 0.5) {
    const t = score * 2;
    const r = Math.round(74 + (251 - 74) * t);
    const g = Math.round(158 + (191 - 158) * t);
    const b = Math.round(237 + (36 - 237) * t);
    return {
      fill: `rgb(${r}, ${g}, ${b})`,
      glow: `rgba(${r}, ${g}, ${b}, 0.4)`,
    };
  } else {
    const t = (score - 0.5) * 2;
    const r = Math.round(251 + (239 - 251) * t);
    const g = Math.round(191 + (68 - 191) * t);
    const b = Math.round(36 + (68 - 36) * t);
    return {
      fill: `rgb(${r}, ${g}, ${b})`,
      glow: `rgba(${r}, ${g}, ${b}, 0.4)`,
    };
  }
}
