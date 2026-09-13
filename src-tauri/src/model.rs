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
    if d.version != 1 {
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
    ids(d.relationships.iter().map(|r| r.id.as_str()))?;
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

#[cfg(test)]
mod tests {
    use super::*;
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
