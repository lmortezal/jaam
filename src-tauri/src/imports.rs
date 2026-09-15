use serde::Serialize;
use serde_json::{Map, Value};
use std::{io::Read, path::Path};

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
pub(crate) fn read(path: &Path) -> Result<Option<String>, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    match options.open(path) {
        Ok(file) => {
            if !file.metadata().map_err(|e| e.to_string())?.is_file() {
                return Err("Only regular configuration files are read".into());
            }
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
    crate::ssh_config::scan(home, Some(Path::new("/etc/ssh/ssh_config")), &mut result);
    match read(&home.join(".kube/config")) {
        Ok(Some(text)) => kube(&text, &mut result),
        Ok(None) => result.warnings.push("Kubernetes config not found".into()),
        Err(e) => result
            .warnings
            .push(format!("Cannot read Kubernetes config: {e}")),
    }
    result
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
        let mut result = Scan::default();
        crate::ssh_config::scan(&home, None, &mut result);
        kube(&std::fs::read_to_string(&kube_path).unwrap(), &mut result);
        assert_eq!(result.suggestions.len(), 2);
        assert_eq!(std::fs::read_to_string(ssh_path).unwrap(), ssh_text);
        assert_eq!(std::fs::read_to_string(kube_path).unwrap(), kube_text);
        std::fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn import_is_data_only() {
        let mut s = Scan::default();
        crate::ssh_config::parse_text("Host prod alias\n HostName 10.0.0.1\n User root\n IdentityFile \"~/.ssh/my key\"\nMatch exec touch /tmp/no\nHost *\nUser nobody\nInclude other", &mut s);
        assert_eq!(s.suggestions.len(), 2);
        assert!(s
            .suggestions
            .iter()
            .any(|s| s.properties["hostname"] == "prod"));
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
