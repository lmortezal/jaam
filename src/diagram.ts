import type cytoscape from "cytoscape";
import { emptyFilters, graphElements, type Inventory, type DiagramView } from "./model";
import { layoutGraph } from "./graphLayout";
import { NODE } from "./visual";

export function syncDiagram(graph: cytoscape.Core, data: Inventory, env: string) {
  const elements = graphElements(data, env, emptyFilters());
  const groups = data.diagram_views[env]?.groups || [];
  const ids = new Set([...elements.map(e => e.data.id), ...groups.map(g => `__group__${g.id}`)]);
  const newNodes: string[] = [];
  graph.batch(() => {
    graph.nodes(".group").filter(g => !ids.has(g.id())).forEach(g => { g.children().move({parent:null}); });
    graph.elements().filter(e => !ids.has(e.id())).remove();
    for (const item of elements) {
      const existing = graph.getElementById(item.data.id);
      if (existing.length) { existing.data(item.data); existing.classes(item.classes); }
      else {
        const added = graph.add(item);
        if (added.isNode()) {
          const saved = data.diagram_views[env]?.nodes[item.data.id];
          if (saved) { added.position({ x: saved.x, y: saved.y }); if (saved.locked) added.lock(); }
          else newNodes.push(item.data.id);
        }
      }
    }
  });
  if (newNodes.length) {
    if (newNodes.length === graph.nodes().length) layoutGraph(graph, Math.max(1, graph.width()/Math.max(1,graph.height())));
    else {
      const fixed = graph.nodes().filter(n => !newNodes.includes(n.id()));
      const box = fixed.boundingBox();
      newNodes.forEach((id, i) => graph.getElementById(id).position({ x: box.x2 + NODE.width + 40 + (i % 3)*(NODE.width + 35), y: box.y1 + NODE.height/2 + Math.floor(i/3)*(NODE.height + 35) }));
    }
  }
  graph.batch(() => {
    for (const group of groups) {
      const id = `__group__${group.id}`;
      const props = { id, kind: "group", label: group.name, group, minWidth: group.width, minHeight: group.height };
      let node = graph.getElementById(id);
      if (!node.length) node = graph.add({ data: props, classes: "group", position: { x: group.x, y: group.y } });
      else node.data(props);
      node.unselectify();
    }
    graph.nodes().not(".group").forEach(node => {
      node.data("kind", "component");
      const group = groups.find(g => g.members.includes(node.id()));
      const parent = group ? `__group__${group.id}` : null;
      if ((node.parent().id() || null) !== parent) node.move({ parent });
    });
    graph.nodes(".group").forEach(g => { g.descendants().toArray().some(n => n.locked()) ? g.ungrabify() : g.grabify(); });
  });
  return newNodes.length > 0;
}
export function diagramSnapshot(graph: cytoscape.Core): DiagramView {
  return {
    groups: graph.nodes(".group").map(g => ({ ...g.data("group"), ...g.position(), members: g.children().map(n => n.id()), width: g.data("minWidth"), height: g.data("minHeight") })),
    nodes: Object.fromEntries(graph.nodes().not(".group").map(n => [n.id(), { x: n.position("x"), y: n.position("y"), locked: n.locked() }]))
  };
}
export function pruneDiagramViews(d: Inventory): Inventory {
  const ids = new Set(d.components.map(c => c.id)), envs = new Set(d.environments.map(e => e.id));
  return { ...d, diagram_views: Object.fromEntries(Object.entries(d.diagram_views || {}).filter(([env]) => envs.has(env)).map(([env, view]) => [env, { ...view, groups: (view.groups || []).map(g => ({ ...g, members: g.members.filter(id => d.components.some(c => c.id === id && c.environment_id === env)) })), nodes: Object.fromEntries(Object.entries(view.nodes).filter(([id]) => ids.has(id))) }])) };
}
