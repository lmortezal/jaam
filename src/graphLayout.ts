import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

export function layoutGraph(graph: cytoscape.Core, aspectRatio = 1.8) {
  // Lay out each connected group independently; Dagre alone puts all isolated
  // imported hosts into one enormous rank. Pack those groups into rows afterward.
  // Membership participates in layout partitioning, without creating any graph edges.
  const parts: cytoscape.CollectionReturnValue[] = [];
  const seen = new Set<string>();
  for (const root of graph.nodes().toArray()) {
    if (seen.has(root.id())) continue;
    let nodes = graph.collection();
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (seen.has(node.id())) continue;
      seen.add(node.id());
      nodes = nodes.union(node);
      pending.push(
        ...node
          .neighborhood()
          .nodes()
          .union(node.parent())
          .union(node.children())
          .nodes()
          .toArray(),
      );
    }
    parts.push(nodes.union(nodes.connectedEdges()));
  }
  const pinned = parts.filter((els) =>
    els
      .nodes()
      .toArray()
      .some((n) => n.locked()),
  );
  const groups = parts
    .filter(
      (els) =>
        !els
          .nodes()
          .toArray()
          .some((n) => n.locked()),
    )
    .map((elements) => {
      elements
        .layout({
          name: "dagre",
          rankDir: "TB",
          nodeSep: 30,
          rankSep: 40,
          padding: 0,
          fit: false,
          animate: false,
        } as cytoscape.LayoutOptions)
        .run();
      // An unconnected set inside a container needs a compact grid, not one Dagre rank.
      elements.nodes(".group").forEach((parent) => {
        const children = parent.children();
        if (children.length && children.connectedEdges().empty())
          children
            .layout({
              name: "grid",
              cols: Math.ceil(Math.sqrt(children.length)),
              fit: false,
              avoidOverlap: true,
              spacingFactor: 1.2,
            })
            .run();
      });
      return { elements, box: elements.boundingBox() };
    })
    .sort((a, b) => b.box.h - a.box.h || b.box.w - a.box.w);
  const gap = 35;
  const area = groups.reduce(
    (sum, { box }) => sum + (box.w + gap) * (box.h + gap),
    0,
  );
  const width = Math.max(
    0,
    ...groups.map((g) => g.box.w),
    Math.sqrt(area * aspectRatio),
  );
  let x = 0,
    y = pinned.length
      ? Math.max(...pinned.map((els) => els.boundingBox().y2)) + gap
      : 0,
    rowHeight = 0;
  graph.batch(() => {
    for (const { elements, box } of groups) {
      if (x && x + box.w > width) {
        x = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      elements.nodes().shift({ x: x - box.x1, y: y - box.y1 });
      x += box.w + gap;
      rowHeight = Math.max(rowHeight, box.h);
    }
  });
}
