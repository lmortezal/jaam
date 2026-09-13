import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { Maximize, Minus, Plus } from "lucide-react";
import { graphElements, type Inventory, type Filters } from "./model";
cytoscape.use(dagre);
export function Graph({
  data,
  environment,
  filters,
  selected,
  highlight,
  onSelect,
  onLaunch,
  onNavigate,
}: {
  data: Inventory;
  environment: string;
  filters: Filters;
  selected: string | null;
  highlight: string;
  onSelect: (id: string) => void;
  onLaunch: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    cy = useRef<cytoscape.Core | null>(null);
  const callbacks = useRef({ onSelect, onLaunch, onNavigate });
  callbacks.current = { onSelect, onLaunch, onNavigate };
  useEffect(() => {
    if (!container.current) return;
    const graph = cytoscape({
      container: container.current,
      elements: graphElements(data, environment, filters),
      layout: {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 45,
        rankSep: 75,
        padding: 55,
      } as cytoscape.LayoutOptions,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            shape: "round-rectangle",
            width: 225,
            height: 104,
            "background-color": "#20222e",
            "background-image": "data(icon)",
            "background-width": 17,
            "background-height": 17,
            "background-position-x": "10px",
            "background-position-y": "12px",
            "text-max-width": "175px",
            "border-width": 1.5,
            "border-color": "data(color)",
            label: "data(label)",
            color: "#e9e9f2",
            "font-family": "system-ui",
            "font-size": 11,
            "text-wrap": "wrap",
            "text-valign": "center",
            "text-halign": "center",
            "line-height": 1.65,
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
          selector: ".chosen",
          style: {
            "border-width": 3,
            "border-color": "#d1c4ff",
            "background-color": "#302a48",
          },
        },
        { selector: ".dimmed", style: { opacity: 0.2 } },
      ],
    });
    cy.current = graph;
    graph.on("tap", "node", (e) => callbacks.current.onSelect(e.target.id()));
    graph.on("dbltap", "node", (e) =>
      callbacks.current.onLaunch(e.target.id()),
    );
    graph.on("tap", "edge.cross", (e) =>
      callbacks.current.onNavigate(e.target.data("targetEnvironment")),
    );
    const observer = new ResizeObserver(() => {
      graph.resize();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      graph.destroy();
      cy.current = null;
    };
  }, [data, environment, filters]);
  useEffect(() => {
    const graph = cy.current;
    if (!graph) return;
    graph.nodes().removeClass("chosen dimmed");
    if (selected) graph.getElementById(selected).addClass("chosen");
    if (highlight)
      graph.nodes().forEach((n) => {
        if (
          data.components.find((c) => c.id === n.id())?.component_type_id !==
          highlight
        )
          n.addClass("dimmed");
      });
  }, [selected, highlight, data, environment, filters]);
  return (
    <div className="graph-wrap">
      <div
        className="graph-canvas"
        ref={container}
        role="img"
        aria-label="Infrastructure relationship graph. Use the list view for keyboard-accessible component details."
      />
      <div className="graph-hint">
        <span className="dashed-line" /> Cross-environment connection{" "}
        <span>·</span> Double-click a node to launch
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
          onClick={() => cy.current?.fit(undefined, 55)}
        >
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
