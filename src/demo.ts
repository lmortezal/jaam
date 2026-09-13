import {
  freshInventory,
  type Component,
  type Environment,
  type Inventory,
} from "./model";
export function demoInventory(): Inventory {
  const d = freshInventory();
  d.environments = [
    [
      "dc-a",
      "Datacenter A",
      "Primary production infrastructure. Public edge, compute, and core services.",
      "#a395f6",
      "building",
    ],
    [
      "dc-b",
      "Datacenter B",
      "Secondary region and disaster recovery. Connected to the primary datacenter.",
      "#74c8bb",
      "building",
    ],
    [
      "staging",
      "Staging",
      "A safe place to validate releases before they reach production.",
      "#e9bb76",
      "flask",
    ],
    [
      "lab",
      "Homelab",
      "Experiments, side projects, and the occasional rabbit hole.",
      "#87b6e8",
      "box",
    ],
  ].map(
    ([id, name, description, color, icon]) =>
      ({ id, name, description, color, icon, parent_id: null }) as Environment,
  );
  const add = (
    id: string,
    name: string,
    type: string,
    env: string,
    properties: Component["properties"],
  ) =>
    d.components.push({
      id,
      name,
      component_type_id: type,
      environment_id: env,
      properties,
      launch_action: null,
      updated_at: "2026-09-13T09:00:00Z",
    });
  add("domain-api", "api.acme.internal", "domain", "dc-a", {
    hostname: "api.acme.internal",
    url: "https://api.acme.internal",
    internet_facing: true,
    criticality: "high",
    notes:
      "Public entry point for the core API. TLS terminates on the edge load balancer.",
  });
  add("domain-app", "app.acme.internal", "domain", "dc-a", {
    hostname: "app.acme.internal",
    url: "https://app.acme.internal",
    internet_facing: true,
    criticality: "high",
  });
  add("f5", "edge-lb-01", "loadbalancer", "dc-a", {
    hostname: "10.10.0.10",
    version: "BIG-IP 17.1",
    url: "https://10.10.0.10",
    criticality: "high",
    internet_facing: true,
    notes:
      "Primary ingress load balancer. Routes app and API traffic into the production cluster.",
  });
  add("k8s", "production-k8s", "kubernetes", "dc-a", {
    hostname: "https://10.10.1.10:6443",
    kube_context: "dc-a-production",
    version: "v1.32.2",
    criticality: "high",
    internet_facing: false,
  });
  add("worker1", "prod-worker-01", "server", "dc-a", {
    hostname: "10.10.1.21",
    ssh_user: "ops",
    ssh_port: 22,
    os_version: "Ubuntu 24.04",
    criticality: "medium",
    internet_facing: false,
  });
  add("worker2", "prod-worker-02", "server", "dc-a", {
    hostname: "10.10.1.22",
    ssh_user: "ops",
    ssh_port: 22,
    os_version: "Ubuntu 24.04",
    criticality: "medium",
    internet_facing: false,
  });
  add("pg", "postgres-primary", "database", "dc-a", {
    hostname: "10.10.2.10",
    engine: "PostgreSQL",
    version: "16.6",
    criticality: "high",
    internet_facing: false,
    notes:
      "Primary database. Replication target lives in Datacenter B.\n\nBefore maintenance, verify replication lag and take a backup.",
  });
  add("dns", "api-dns-record", "dns", "dc-a", {
    hostname: "api.acme.internal",
    record_type: "A",
    value: "10.10.0.10",
    criticality: "medium",
  });
  add("replica", "postgres-replica", "database", "dc-b", {
    hostname: "10.20.2.10",
    engine: "PostgreSQL",
    version: "16.6",
    criticality: "high",
  });
  add("bastion", "bastion-02", "server", "dc-b", {
    hostname: "10.20.0.5",
    ssh_user: "ops",
    os_version: "Debian 12",
    criticality: "high",
  });
  add("stage-k8s", "staging-k8s", "kubernetes", "staging", {
    hostname: "https://10.30.1.10:6443",
    kube_context: "staging",
    version: "v1.32.2",
    criticality: "low",
  });
  add("lab-node", "lab-node-01", "server", "lab", {
    hostname: "192.168.1.40",
    ssh_user: "ops",
    os_version: "Ubuntu 24.04",
    criticality: "low",
  });
  d.relationships = [
    ["domain-api", "f5", "points_to"],
    ["domain-app", "f5", "points_to"],
    ["dns", "f5", "resolves_to"],
    ["f5", "k8s", "load_balances"],
    ["worker1", "k8s", "member_of"],
    ["worker2", "k8s", "member_of"],
    ["k8s", "pg", "connects_to"],
    ["pg", "replica", "replicates_to"],
    ["bastion", "worker1", "connects_to"],
  ].map(([source_component_id, target_component_id, relation_type], i) => ({
    id: `r${i}`,
    source_component_id,
    target_component_id,
    relation_type,
    label: "",
  }));
  return d;
}
