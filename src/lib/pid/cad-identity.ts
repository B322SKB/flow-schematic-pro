import type { Pipe, PidNode, Scheme } from "./types";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdFactory = () => string;

export interface IdentityMigrationResult {
  scheme: Scheme;
  changed: boolean;
  nodeIdsChanged: number;
  pipeIdsChanged: number;
}

/** Upgrade legacy node/pipe IDs while preserving pipe endpoint references. */
export function upgradeSchemeEntityIds(
  source: Scheme,
  idFactory: IdFactory = () => crypto.randomUUID(),
): IdentityMigrationResult {
  const nodeMap = new Map<string, string>();
  const seenNodes = new Set<string>();
  let nodeIdsChanged = 0;
  let pipeIdsChanged = 0;

  const nodes: PidNode[] = source.nodes.map((node) => {
    if (!node.id || seenNodes.has(node.id)) throw new Error(`Duplicate or empty node id: ${node.id}`);
    seenNodes.add(node.id);
    const id = UUID_V4.test(node.id) ? node.id : idFactory();
    if (!UUID_V4.test(id)) throw new Error("Id factory must return UUIDv4");
    nodeMap.set(node.id, id);
    if (id !== node.id) nodeIdsChanged++;
    return { ...node, id };
  });

  const seenPipes = new Set<string>();
  const pipes: Pipe[] = source.pipes.map((pipe) => {
    if (!pipe.id || seenPipes.has(pipe.id)) throw new Error(`Duplicate or empty pipe id: ${pipe.id}`);
    seenPipes.add(pipe.id);
    const from = nodeMap.get(pipe.from.node);
    const to = nodeMap.get(pipe.to.node);
    if (!from || !to) throw new Error(`Pipe ${pipe.id} references a missing node`);
    const id = UUID_V4.test(pipe.id) ? pipe.id : idFactory();
    if (!UUID_V4.test(id)) throw new Error("Id factory must return UUIDv4");
    if (id !== pipe.id) pipeIdsChanged++;
    return { ...pipe, id, from: { ...pipe.from, node: from }, to: { ...pipe.to, node: to } };
  });

  return {
    scheme: { ...source, nodes, pipes },
    changed: nodeIdsChanged + pipeIdsChanged > 0,
    nodeIdsChanged,
    pipeIdsChanged,
  };
}
