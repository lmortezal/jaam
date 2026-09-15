use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub icon: String,
    pub parent_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Field {
    pub key: String,
    pub label: String,
    pub field_type: String,
    #[serde(default)]
    pub options: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct LaunchAction {
    pub action_type: String,
    pub template: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ComponentType {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub fields: Vec<Field>,
    pub launch_action: Option<LaunchAction>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Component {
    pub id: String,
    pub environment_id: String,
    pub component_type_id: String,
    pub name: String,
    pub properties: Map<String, Value>,
    pub launch_action: Option<LaunchAction>,
    pub updated_at: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Relationship {
    pub id: String,
    pub source_component_id: String,
    pub target_component_id: String,
    pub relation_type: String,
    pub label: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Settings {
    pub auto_lock_minutes: u64,
    pub terminal: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Document {
    pub version: u32,
    pub revision: u64,
    pub environments: Vec<Environment>,
    pub component_types: Vec<ComponentType>,
    pub components: Vec<Component>,
    pub relationships: Vec<Relationship>,
    pub settings: Settings,
    #[serde(default)]
    pub diagram_views: HashMap<String, DiagramView>,
}
#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct DiagramView {
    pub nodes: HashMap<String, NodePosition>,
    #[serde(default)]
    pub groups: Vec<DiagramGroup>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DiagramGroup {
    pub id: String,
    pub name: String,
    pub members: Vec<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
    pub locked: bool,
}

// Reference only; no secret values or retrieval commands exist in v1.
#[allow(dead_code)]
pub struct SecretRef {
    pub item_id: String,
}

impl Default for Document {
    fn default() -> Self {
        serde_json::from_str(include_str!("../defaults.json")).expect("valid bundled defaults")
    }
}

fn ids<'a>(items: impl Iterator<Item = &'a str>) -> Result<HashSet<&'a str>, String> {
    let mut result = HashSet::new();
    for id in items {
        if id.is_empty() || id.len() > 128 || !result.insert(id) {
            return Err("IDs must be nonempty and unique".into());
        }
    }
    Ok(result)
}
fn name(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 256 {
        Err("Names must contain 1–256 characters".into())
    } else {
        Ok(())
    }
}
fn action(value: &Option<LaunchAction>) -> Result<(), String> {
    if let Some(a) = value {
        if !["open_url", "ssh_terminal", "custom_command", "none"].contains(&a.action_type.as_str())
            || a.template.len() > 4096
        {
            return Err("Invalid launch action".into());
        }
    }
    Ok(())
}
pub fn validate(d: &Document) -> Result<(), String> {
    if d.version != 2 {
        return Err("Unsupported backup version".into());
    }
    if !(1..=120).contains(&d.settings.auto_lock_minutes) {
        return Err("Auto-lock must be 1–120 minutes".into());
    }
    if !["auto", "terminal", "iterm"].contains(&d.settings.terminal.as_str()) {
        return Err("Invalid terminal preference".into());
    }
    if d.components.len() > 20000
        || d.relationships.len() > 50000
        || d.environments.len() > 1000
        || d.component_types.len() > 500
    {
        return Err("Inventory exceeds supported limits".into());
    }
    let envs = ids(d.environments.iter().map(|e| e.id.as_str()))?;
    let types = ids(d.component_types.iter().map(|t| t.id.as_str()))?;
    let comps = ids(d.components.iter().map(|c| c.id.as_str()))?;
    let rels = ids(d.relationships.iter().map(|r| r.id.as_str()))?;
    if d.diagram_views.len() > d.environments.len() {
        return Err("Too many diagram views".into());
    }
    for (env, view) in &d.diagram_views {
        if !envs.contains(env.as_str()) || view.nodes.len() > d.components.len() {
            return Err("Invalid diagram view".into());
        }
        for (id, p) in &view.nodes {
            if !comps.contains(id.as_str())
                || !p.x.is_finite()
                || !p.y.is_finite()
                || p.x.abs() > 1e7
                || p.y.abs() > 1e7
            {
                return Err("Invalid diagram coordinates or component reference".into());
            }
        }
        if view.groups.len() > 1000 {
            return Err("Too many diagram groups".into());
        }
        ids(view.groups.iter().map(|g| g.id.as_str()))?;
        let mut members = HashSet::new();
        for g in &view.groups {
            name(&g.name)?;
            if comps.contains(format!("__group__{}", g.id).as_str())
                || rels.contains(format!("__group__{}", g.id).as_str())
                || [g.x, g.y, g.width, g.height]
                    .iter()
                    .any(|n| !n.is_finite() || n.abs() > 1e7)
                || !(100.0..=100000.0).contains(&g.width)
                || !(80.0..=100000.0).contains(&g.height)
            {
                return Err("Invalid diagram group bounds".into());
            }
            for id in &g.members {
                if !members.insert(id)
                    || !d
                        .components
                        .iter()
                        .any(|c| &c.id == id && &c.environment_id == env)
                {
                    return Err(
                        "Diagram membership must be unique and local to its environment".into(),
                    );
                }
            }
        }
    }
    let parents: HashMap<_, _> = d
        .environments
        .iter()
        .map(|e| (e.id.as_str(), e.parent_id.as_deref()))
        .collect();
    for e in &d.environments {
        name(&e.name)?;
        let mut visited = HashSet::from([e.id.as_str()]);
        let mut parent = e.parent_id.as_deref();
        while let Some(id) = parent {
            if !envs.contains(id) || !visited.insert(id) {
                return Err("Environment parent is missing or forms a cycle".into());
            }
            parent = parents[id];
        }
    }
    for t in &d.component_types {
        name(&t.name)?;
        action(&t.launch_action)?;
        ids(t.fields.iter().map(|f| f.key.as_str()))?;
        for f in &t.fields {
            if !["text", "bool", "number", "enum"].contains(&f.field_type.as_str())
                || (f.field_type == "enum" && f.options.is_empty())
            {
                return Err("Invalid field schema".into());
            }
        }
    }
    for c in &d.components {
        name(&c.name)?;
        action(&c.launch_action)?;
        if !envs.contains(c.environment_id.as_str())
            || !types.contains(c.component_type_id.as_str())
        {
            return Err("Component references a missing environment or type".into());
        }
        for (key, value) in &c.properties {
            if key.is_empty()
                || key.len() > 128
                || !(value.is_string()
                    || value.is_boolean()
                    || value.is_number()
                    || value.is_null())
            {
                return Err("Properties must have a key and a scalar value".into());
            }
            if [
                "password",
                "private_key",
                "token",
                "secret",
                "access_token",
                "client_key_data",
                "client-key-data",
            ]
            .contains(&key.to_lowercase().as_str())
            {
                return Err(
                    "Credential fields are not supported. Reference existing key paths only."
                        .into(),
                );
            }
        }
        let t = d
            .component_types
            .iter()
            .find(|t| t.id == c.component_type_id)
            .unwrap();
        for field in &t.fields {
            if let Some(v) = c.properties.get(&field.key) {
                if v.is_null() {
                    continue;
                }
                let valid = match field.field_type.as_str() {
                    "text" => v.is_string(),
                    "number" => v.is_number(),
                    "bool" => v.is_boolean(),
                    "enum" => v
                        .as_str()
                        .is_some_and(|s| field.options.iter().any(|o| o == s)),
                    _ => false,
                };
                if !valid {
                    return Err(format!("{}: invalid value for {}", c.name, field.key));
                }
            }
        }
    }
    for r in &d.relationships {
        name(&r.relation_type)?;
        if !comps.contains(r.source_component_id.as_str())
            || !comps.contains(r.target_component_id.as_str())
        {
            return Err("Relationship references a missing component".into());
        }
    }
    Ok(())
}

// Upgrade only in memory. The next successful whole-document transaction persists it.
pub fn decode(json: &str) -> Result<Document, String> {
    if json.len() > 16 * 1024 * 1024 {
        return Err("Inventory exceeds 16 MB".into());
    }
    let mut value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    match value.get("version").and_then(Value::as_u64) {
        Some(1) => value["version"] = Value::from(2),
        Some(2) => {}
        _ => return Err("Unsupported inventory version".into()),
    }
    let document: Document = serde_json::from_value(value).map_err(|e| e.to_string())?;
    validate(&document)?;
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagram_state_migrates_and_rejects_invalid_membership() {
        let json = serde_json::json!({
            "id": "e", "name": "Env", "description": "", "color": "", "icon": "", "parent_id": null
        });
        let mut value = serde_json::to_value(Document::default()).unwrap();
        value["version"] = 1.into();
        value["environments"] = serde_json::json!([json]);
        value["components"] = serde_json::json!([{"id":"c","name":"Server","environment_id":"e","component_type_id":"server","properties":{},"launch_action":null,"updated_at":""}]);
        value.as_object_mut().unwrap().remove("diagram_views");
        let migrated = decode(&value.to_string()).unwrap();
        assert!(migrated.diagram_views.is_empty());
        assert_eq!(migrated.components[0].id, "c");
        value["diagram_views"] = serde_json::json!({"e":{"nodes":{"c":{"x":10,"y":20,"locked":true}},"groups":[{"id":"g","name":"Cluster","members":["c"],"x":0,"y":0,"width":400,"height":240}]}});
        assert!(decode(&value.to_string()).is_ok());
        value["relationships"] = serde_json::json!([{"id":"__group__g","source_component_id":"c","target_component_id":"c","relation_type":"test","label":""}]);
        assert!(decode(&value.to_string()).is_err());
        value["relationships"] = serde_json::json!([]);
        value["diagram_views"]["e"]["groups"][0]["members"] = serde_json::json!(["c", "c"]);
        assert!(decode(&value.to_string()).is_err());
        value["diagram_views"]["e"]["groups"][0]["members"] = serde_json::json!(["missing"]);
        assert!(decode(&value.to_string()).is_err());
        value["diagram_views"]["e"]["groups"][0]["members"] = serde_json::json!(["c"]);
        value["diagram_views"]["e"]["nodes"]["c"]["x"] = serde_json::json!(1e20);
        assert!(decode(&value.to_string()).is_err());
    }
    #[test]
    fn rejects_cycles_and_secret_fields() {
        let mut d = Document::default();
        d.environments.push(Environment {
            id: "e".into(),
            name: "E".into(),
            description: "".into(),
            color: "".into(),
            icon: "".into(),
            parent_id: Some("e".into()),
        });
        assert!(validate(&d).is_err());
        d.environments[0].parent_id = None;
        assert!(validate(&d).is_ok());
        d.components.push(Component {
            id: "c".into(),
            environment_id: "e".into(),
            component_type_id: "server".into(),
            name: "C".into(),
            properties: serde_json::from_str(r#"{"password":"no"}"#).unwrap(),
            launch_action: None,
            updated_at: "".into(),
        });
        assert!(validate(&d).is_err());
    }
}
