use serde::Serialize;
use serde_json::{Map, Value};
use std::{collections::HashSet, io::Read, path::Path};

#[derive(Serialize)]
pub struct Suggestion {
    pub id: String,
    pub source: String,
    pub name: String,
    pub component_type_id: String,
    pub properties: Map<String, Value>,
}
#[derive(Serialize, Default)]
pub struct Scan {
    pub suggestions: Vec<Suggestion>,
    pub warnings: Vec<String>,
}
fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::File::open(path) {
        Ok(file) => {
            let mut text = String::new();
            file.take(2 * 1024 * 1024 + 1)
                .read_to_string(&mut text)
                .map_err(|e| e.to_string())?;
            if text.len() > 2 * 1024 * 1024 {
                return Err("Config exceeds 2 MB".into());
            }
            Ok(Some(text))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub fn scan(home: &Path) -> Scan {
    let mut result = Scan::default();
    for (source, path) in [
        ("SSH", home.join(".ssh/config")),
        ("Kubernetes", home.join(".kube/config")),
    ] {
        match read(&path) {
            Ok(Some(text)) => {
                if source == "SSH" {
                    ssh(&text, &mut result)
                } else {
                    kube(&text, &mut result)
                }
            }
            Ok(None) => result.warnings.push(format!("{source} config not found")),
            Err(e) => result
                .warnings
                .push(format!("Cannot read {source} config: {e}")),
        }
    }
    result
}
pub fn ssh(text: &str, result: &mut Scan) {
    // Suggestions use literal aliases so OpenSSH resolves Include/Match/wildcards at launch.
    // We do not execute `ssh -G`: Match exec can run arbitrary local commands.
    let mut aliases = Vec::<String>::new();
    let mut blocks: Vec<(Vec<String>, Map<String, Value>)> = Vec::new();
    let mut props = Map::new();
    let mut limited = false;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let split = line.find(|c: char| c.is_whitespace() || c == '=');
        let Some(pos) = split else {
            continue;
        };
        let key = line[..pos].to_lowercase();
        let value = line[pos..].trim_start_matches(|c: char| c.is_whitespace() || c == '=');
        let Some(tokens) = shlex::split(value) else {
            result
                .warnings
                .push("Skipped an SSH line with invalid quoting".into());
            continue;
        };
        if key == "host" || key == "match" {
            blocks.push((std::mem::take(&mut aliases), std::mem::take(&mut props)));
            if key == "host" {
                aliases = tokens
                    .into_iter()
                    .filter(|s| {
                        let literal = !s.contains(['*', '?', '!']);
                        if !literal {
                            limited = true;
                        }
                        literal
                    })
                    .collect();
            } else {
                limited = true;
            }
        } else if key == "include" {
            limited = true;
        } else if let Some(value) = tokens.first() {
            let field = match key.as_str() {
                "hostname" => "resolved_hostname",
                "user" => "ssh_user",
                "port" => "ssh_port",
                "identityfile" => "ssh_identity_file",
                _ => continue,
            };
            let parsed = if field == "ssh_port" {
                match value.parse::<u16>() {
                    Ok(p) if p > 0 => Value::from(p),
                    _ => {
                        result.warnings.push("Skipped invalid SSH port".into());
                        continue;
                    }
                }
            } else {
                Value::from(value.as_str())
            };
            props.entry(field).or_insert(parsed);
        }
    }
    blocks.push((aliases, props));
    let mut seen = HashSet::new();
    for (aliases, props) in blocks {
        for alias in aliases {
            if !seen.insert(alias.clone()) {
                continue;
            }
            // Informational values use source_* names; do not override OpenSSH's actual config.
            let mut properties = Map::from_iter(
                props
                    .iter()
                    .map(|(k, v)| (format!("source_{k}"), v.clone())),
            );
            properties.insert("hostname".into(), alias.clone().into());
            result.suggestions.push(Suggestion {
                id: format!("ssh:{alias}"),
                source: "~/.ssh/config".into(),
                name: alias,
                component_type_id: "server".into(),
                properties,
            });
        }
    }
    if limited {
        result.warnings.push("SSH Include, Match and wildcard rules are not evaluated. Suggestions show literal aliases only; SSH applies your full config when launched.".into());
    }
}
pub fn kube(text: &str, result: &mut Scan) {
    let doc: Value = match serde_yaml::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            result
                .warnings
                .push("Kubernetes config is not valid YAML".into());
            return;
        }
    };
    let clusters = doc.get("clusters").and_then(Value::as_array);
    let Some(contexts) = doc.get("contexts").and_then(Value::as_array) else {
        return;
    };
    for context in contexts {
        let Some(name) = context.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(details) = context.get("context") else {
            continue;
        };
        let mut properties = Map::new();
        properties.insert("kube_context".into(), name.into());
        if let Some(namespace) = details.get("namespace").and_then(Value::as_str) {
            properties.insert("namespace".into(), namespace.into());
        }
        if let Some(cluster) = details.get("cluster").and_then(Value::as_str) {
            properties.insert("cluster".into(), cluster.into());
            if let Some(server) = clusters
                .and_then(|cs| {
                    cs.iter()
                        .find(|c| c.get("name").and_then(Value::as_str) == Some(cluster))
                })
                .and_then(|c| c.get("cluster"))
                .and_then(|c| c.get("server"))
                .and_then(Value::as_str)
            {
                if let Ok(parsed) = url::Url::parse(server) {
                    if parsed.username().is_empty() && parsed.password().is_none() {
                        properties.insert("hostname".into(), server.into());
                    }
                }
            }
        }
        result.suggestions.push(Suggestion {
            id: format!("kube:{name}"),
            source: "~/.kube/config".into(),
            name: name.into(),
            component_type_id: "kubernetes".into(),
            properties,
        });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_files_are_unchanged() {
        let home =
            std::env::temp_dir().join(format!("opsportal-import-test-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::create_dir_all(home.join(".kube")).unwrap();
        let ssh_path = home.join(".ssh/config");
        let kube_path = home.join(".kube/config");
        let ssh_text = "Host test\n HostName 127.0.0.1\n";
        let kube_text = "contexts:\n- name: test\n  context: {cluster: test}\n";
        std::fs::write(&ssh_path, ssh_text).unwrap();
        std::fs::write(&kube_path, kube_text).unwrap();
        let result = scan(&home);
        assert_eq!(result.suggestions.len(), 2);
        assert_eq!(std::fs::read_to_string(ssh_path).unwrap(), ssh_text);
        assert_eq!(std::fs::read_to_string(kube_path).unwrap(), kube_text);
        std::fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn import_is_data_only() {
        let mut s = Scan::default();
        ssh("Host prod alias\n HostName 10.0.0.1\n User root\n IdentityFile \"~/.ssh/my key\"\nMatch exec touch /tmp/no\nHost *\nUser nobody\nInclude other", &mut s);
        assert_eq!(s.suggestions.len(), 2);
        assert_eq!(s.suggestions[0].properties["hostname"], "prod");
        assert!(!s.suggestions[0].properties.contains_key("ssh_user"));
        assert!(!s.warnings.is_empty());
        kube("contexts:\n- name: prod\n  context: {cluster: main}\nclusters:\n- name: main\n  cluster: {server: 'https://127.0.0.1:6443', certificate-authority-data: SECRET}\nusers:\n- name: root\n  user: {token: SECRET, exec: {command: evil}}", &mut s);
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("SECRET"));
        assert!(!json.contains("evil"));
        assert_eq!(
            s.suggestions[2].properties["hostname"],
            "https://127.0.0.1:6443"
        );
    }
}
