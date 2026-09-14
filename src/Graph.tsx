import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { Maximize, Minus, Plus, LockKeyhole, Unlock, Wand2, FolderPlus, Pencil } from "lucide-react";
import { graphElements, type Inventory, type Filters, type DiagramView } from "./model";
import { syncDiagram, diagramSnapshot } from "./diagram";
import { NODE } from "./visual";
import { layoutGraph } from "./graphLayout";
export function Graph({
  data,
  environment,
  filters,
  selected,
  selectedIds, onSelection, onEditGroup,
  highlight,
  onSelect,
  onLaunch,
  onNavigate,
  onSave,
}: {
  data: Inventory;
  environment: string;
  filters: Filters;
  selected: string | null;
  selectedIds: Set<string>;
  onSelection: (ids: Set<string>) => void;
  onEditGroup: (id: string | null) => void;
  highlight: string;
  onSelect: (id: string | null) => void;
  onLaunch: (id: string) => void;
  onNavigate: (id: string) => void;
  onSave: (view: DiagramView) => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null),
    cy = useRef<cytoscape.Core | null>(null);
  const callbacks = useRef({ onSelect, onLaunch, onNavigate, onSave, onSelection });
  callbacks.current = { onSelect, onLaunch, onNavigate, onSave, onSelection };
  const [saveState, setSaveState] = useState(""), [locked, setLocked] = useState(false);
  const [activeGroup, setActiveGroup] = useState("");
  const [groupBox, setGroupBox] = useState<{x2:number;y2:number} | null>(null);
  const activeGroupRef = useRef(""); activeGroupRef.current = activeGroup;
  const resizing = useRef<{x:number;y:number;width:number;height:number;zoom:number}|null>(null);
  const saveSequence = useRef(0), synchronizing = useRef(false);
  async function persist(graph: cytoscape.Core) {
    const sequence = ++saveSequence.current;
    setSaveState("Saving diagram…");
    try { await callbacks.current.onSave(diagramSnapshot(graph)); if (sequence === saveSequence.current) setSaveState("Diagram saved"); }
    catch (e) { if (sequence === saveSequence.current) setSaveState(`Not saved: ${String(e)}`); }
  }
  useEffect(() => {
    if (!container.current) return;
    const graph = cytoscape({
      container: container.current,
      elements: [],
      layout: { name: "preset" },
      minZoom: 0.03,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            shape: "round-rectangle",
            width: NODE.width,
            height: NODE.height,
            "background-color": "#20222e",
            "background-image": "data(icon)",
            "background-width": NODE.icon,
            "background-height": NODE.icon,
            "background-position-x": "50%",
            "background-position-y": "10px",
            "text-max-width": `${NODE.labelWidth}px`,
            "border-width": 1.5,
            "border-color": "data(color)",
            label: "data(label)",
            color: "#e9e9f2",
            "font-family": getComputedStyle(container.current).fontFamily,
            "font-size": NODE.fontSize,
            "text-wrap": "wrap",
            "text-valign": "center",
            "text-halign": "center",
            "line-height": 1.4,
            "text-margin-y": 12,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#51556b",
            "target-arrow-color": "#646981",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 9,
            color: "#9a9eb6",
            "text-rotation": "autorotate",
            "text-background-color": "#14161e",
            "text-background-opacity": 1,
            "text-background-padding": "4px",
            "text-margin-y": -10,
          },
        },
        {
          selector: ".cross",
          style: {
            "line-color": "#b4a1fa",
            "target-arrow-color": "#b4a1fa",
            "line-style": "dashed",
            color: "#c1b3fa",
            width: 2,
          },
        },
        {
          selector: ".external",
          style: { "border-style": "dashed", "background-color": "#292338" },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#d1c4ff",
            "background-color": "#302a48",
          },
        },
        { selector: ".critical", style: { "border-width": 2.5 } },
        { selector: ".group", style: {
          "background-image": "none", "background-color": "#222633", "background-opacity": 0.55,
          "border-color": "#747994", "border-style": "dashed", "border-width": 1.5,
          width: "data(minWidth)", height: "data(minHeight)", "min-width": "data(minWidth)", "min-height": "data(minHeight)",
          "min-width-bias-left": "0%", "min-width-bias-right": "100%", "min-height-bias-top": "0%", "min-height-bias-bottom": "100%",
          padding: "25px", "text-valign": "top", "text-margin-y": -8, "font-weight": "bold",
        } },
        { selector: ".group-active", style: { "border-color": "#d1c4ff", "border-width": 3 } },
        { selector: ".hidden", style: { visibility: "hidden", events: "no" } },
        { selector: ".pinned", style: { "border-style": "double" } },
        { selector: ".dimmed", style: { opacity: 0.2 } },
      ],
    });
    cy.current = graph;
    graph.on("tap", 'node[kind="component"]', e => {
      const event = e.originalEvent;
      if (!event?.metaKey && !event?.ctrlKey && !event?.shiftKey) callbacks.current.onSelect(e.target.id());
    });
    graph.on("select unselect", 'node[kind="component"]', () => {
      if (synchronizing.current) return;
      queueMicrotask(() => {
        if (graph.destroyed()) return;
        const ids = new Set<string>(graph.nodes(":selected").filter(n => n.data("environment") === environment).map(n => n.id()));
        callbacks.current.onSelection(ids);
        if (ids.size > 1) callbacks.current.onSelect(null);
      });
    });
    graph.on("dbltap", 'node[kind="component"]', e => {
      const event = e.originalEvent;
      if (!event?.metaKey && !event?.ctrlKey && !event?.shiftKey && graph.nodes(":selected").length <= 1) callbacks.current.onLaunch(e.target.id());
    });
    graph.on("tap", "edge.cross", (e) =>
      callbacks.current.onNavigate(e.target.data("targetEnvironment")),
    );
    graph.on("tap", "node.group", e => setActiveGroup(e.target.id()));
    graph.on("render", () => {
      const node = graph.getElementById(activeGroupRef.current);
      if (node.length) { const b = node.renderedBoundingBox({includeLabels:false}); setGroupBox({ x2:b.x2, y2:b.y2 }); }
    });
    graph.on("dragfree", "node", () => void persist(graph));
    let initiallyFitted = false;
    const observer = new ResizeObserver(() => {
      graph.resize();
      if (!initiallyFitted && graph.width() > 0 && graph.height() > 0) {
        graph.fit(undefined, 32);
        initiallyFitted = true;
      }
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      graph.destroy();
      cy.current = null;
    };
  }, [environment]);
  useEffect(() => {
    const graph = cy.current;
    if (!graph) return;
    const first = graph.nodes().empty();
    synchronizing.current = true;
    if (syncDiagram(graph, data, environment)) void persist(graph);
    graph.nodes(".external").unselectify();
    synchronizing.current = false;
    if (first) graph.fit(undefined, 32);
  }, [data, environment]);
  useEffect(() => {
    const graph = cy.current;
    if (!graph) return;
    const visible = new Set(graphElements(data, environment, filters).map(e => e.data.id));
    graph.elements().forEach(e => { e.toggleClass("hidden", !e.hasClass("group") && !visible.has(e.id())); });
    graph.nodes(".group").forEach(g => { g.toggleClass("group-active", g.id() === activeGroup); });
    synchronizing.current = true;
    graph.nodes().not(".group").forEach(n => { selectedIds.has(n.id()) ? n.select() : n.unselect(); });
    synchronizing.current = false;
    graph.nodes().removeClass("dimmed");
    setLocked(Boolean(selected && graph.getElementById(selected).locked()));
    graph.nodes().forEach(n => { n.toggleClass("pinned", n.locked()); });

    if (highlight)
      graph.nodes().forEach((n) => {
        if (!n.hasClass("group") &&
          data.components.find((c) => c.id === n.id())?.component_type_id !==
          highlight
        )
          n.addClass("dimmed");
      });
  }, [selected, selectedIds, activeGroup, highlight, data, environment, filters]);
  return (
    <div className="graph-wrap">
      <div
        className="graph-canvas"
        ref={container}
        role="img"
        aria-label="Infrastructure relationship graph. Use the list view for keyboard-accessible component details."
      />
      <div className="diagram-save" role="status">{saveState}{saveState.startsWith("Not saved") && <button onClick={() => cy.current && void persist(cy.current)}>Retry save</button>}</div>
      <div className="graph-actions">
        <button className="secondary" onClick={() => onEditGroup(null)}><FolderPlus size={16}/>New group</button>
        {(data.diagram_views[environment]?.groups.length || 0) > 0 && <select aria-label="Diagram group" value={activeGroup} onChange={e => setActiveGroup(e.target.value)}><option value="">Select group</option>{data.diagram_views[environment].groups.map(g => <option key={g.id} value={`__group__${g.id}`}>{g.name}</option>)}</select>}
        {activeGroup && <button className="secondary" onClick={() => onEditGroup(activeGroup.replace(/^__group__/,""))}><Pencil size={16}/>Edit group</button>}

        <button className="secondary" title="Arrange the full diagram. Groups containing locked nodes stay in place." onClick={() => { const graph = cy.current; if (!graph) return; graph.elements().removeClass("hidden"); layoutGraph(graph); graph.fit(undefined, 32); void persist(graph); }}><Wand2 size={16}/>Arrange</button>
        {selected && <button className="secondary" onClick={() => { const graph = cy.current; if (!graph) return; const n = graph.getElementById(selected); locked ? n.unlock() : n.lock(); n.toggleClass("pinned", !locked); setLocked(!locked); void persist(graph); }}>{locked ? <Unlock size={16}/> : <LockKeyhole size={16}/>} {locked ? "Unlock position" : "Lock position"}</button>}
      </div>
      {activeGroup && groupBox && <button className="group-resize" aria-label="Resize diagram group" title="Drag to resize; members remain enclosed" style={{left:groupBox.x2-12,top:groupBox.y2-12}} onPointerDown={e => {
        const graph=cy.current, node=graph?.getElementById(activeGroup); if(!graph || !node?.length)return;
        resizing.current={x:e.clientX,y:e.clientY,width:node.width(),height:node.height(),zoom:graph.zoom()}; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
      }} onPointerMove={e=>{ const start=resizing.current, node=cy.current?.getElementById(activeGroup); if(!start||!node?.length)return; node.data({minWidth:Math.min(100000,Math.max(100,start.width+(e.clientX-start.x)/start.zoom)),minHeight:Math.min(100000,Math.max(80,start.height+(e.clientY-start.y)/start.zoom))}); }} onPointerUp={()=>{if(resizing.current&&cy.current){resizing.current=null;void persist(cy.current);}}} onPointerCancel={()=>{resizing.current=null;}}/>}
      <div className="graph-hint">
        <span className="dashed-line" /> Cross-environment connection{" "}
        <span>·</span> Ctrl/Cmd-click to select · Double-click to launch
      </div>
      <div className="graph-controls">
        <button
          aria-label="Zoom in"
          onClick={() => cy.current?.zoom(cy.current.zoom() * 1.2)}
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => cy.current?.zoom(cy.current.zoom() / 1.2)}
        >
          <Minus size={16} />
        </button>
        <button
          aria-label="Fit diagram"
          onClick={() => cy.current?.fit(undefined, 32)}
        >
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
