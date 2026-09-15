//! Static suggestions only: never invoke ssh, a shell, Match exec, DNS, or key files.
use crate::imports::{read, Scan, Suggestion};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeSet, HashSet},
    path::{Path, PathBuf},
};

#[derive(Debug)]
enum Rule {
    Option(String, Vec<String>),
    Include(Vec<Vec<Rule>>),
}
struct Parser<'a> {
    home: &'a Path,
    stack: HashSet<PathBuf>,
    files: usize,
    bytes: usize,
    lines: usize,
    complete: bool,
    warnings: BTreeSet<String>,
    aliases: BTreeSet<String>,
}
impl<'a> Parser<'a> {
    fn new(home: &'a Path) -> Self {
        Self {
            home,
            stack: HashSet::new(),
            files: 0,
            bytes: 0,
            lines: 0,
            complete: true,
            warnings: BTreeSet::new(),
            aliases: BTreeSet::new(),
        }
    }
    fn warn(&mut self, message: &str) {
        self.complete = false;
        self.warnings.insert(message.into());
    }
    fn file(&mut self, path: &Path, root: &Path) -> Vec<Rule> {
        if self.stack.len() >= 16 || self.files >= 128 || self.bytes >= 8 * 1024 * 1024 {
            self.warn(
                "SSH Include limit reached (16 levels, 128 files, 8 MB). Matching requires review.",
            );
            return vec![];
        }
        self.files += 1;
        let canonical = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                self.warn("An SSH configuration file could not be read. Matching requires review.");
                return vec![];
            }
        };
        if !self.stack.insert(canonical.clone()) {
            self.warn("Circular SSH Include skipped. Matching requires review.");
            return vec![];
        }
        let rules = match read(&canonical) {
            Ok(Some(text)) => {
                self.bytes += text.len();
                if self.bytes > 8 * 1024 * 1024 {
                    self.warn("SSH configuration exceeds 8 MB total.");
                    vec![]
                } else {
                    self.text(&text, root)
                }
            }
            _ => {
                self.warn("An SSH configuration file is unreadable or is not a regular file.");
                vec![]
            }
        };
        self.stack.remove(&canonical);
        rules
    }
    fn text(&mut self, text: &str, root: &Path) -> Vec<Rule> {
        let mut rules = vec![];
        for line in text.lines() {
            self.lines += 1;
            if self.lines > 20_000 {
                self.warn("SSH rule limit reached (20000 lines).");
                break;
            }
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some(pos) = line.find(|c: char| c.is_whitespace() || c == '=') else {
                self.warn("Malformed SSH option skipped.");
                continue;
            };
            let key = line[..pos].to_ascii_lowercase();
            let value = line[pos..]
                .trim_start()
                .strip_prefix('=')
                .unwrap_or(line[pos..].trim_start())
                .trim_start();
            let Some(tokens) = shlex::split(value).filter(|v| !v.is_empty()) else {
                self.warn("SSH option with invalid quoting or no value skipped.");
                continue;
            };
            if key == "include" {
                let mut included = vec![];
                for token in &tokens {
                    if token.contains(['%', '$'])
                        || (token.starts_with('~') && !token.starts_with("~/"))
                    {
                        self.warn("Dynamic or other-user SSH Include paths are not evaluated.");
                        continue;
                    }
                    let path = if let Some(suffix) = token.strip_prefix("~/") {
                        self.home.join(suffix)
                    } else {
                        root.join(token)
                    };
                    let Some(pattern) = path.to_str() else {
                        self.warn("SSH Include path is not UTF-8.");
                        continue;
                    };
                    match glob::glob(pattern) {
                        Ok(paths) => {
                            let mut paths: Vec<_> = paths.take(129).collect();
                            if paths.len() > 128 {
                                self.warn("SSH Include glob matched too many paths.");
                                paths.truncate(128);
                            }
                            paths.sort_by(|a, b| a.as_ref().ok().cmp(&b.as_ref().ok()));
                            for path in paths {
                                match path {
                                    Ok(path) => included.push(self.file(&path, root)),
                                    Err(_) => self.warn("SSH Include glob could not be read."),
                                }
                            }
                        }
                        Err(_) => self.warn("Invalid SSH Include glob skipped."),
                    }
                }
                rules.push(Rule::Include(included));
            } else {
                if key == "host" {
                    for alias in &tokens {
                        if !alias.contains(['*', '?', '!'])
                            && !alias.starts_with('-')
                            && alias.len() <= 253
                        {
                            if self.aliases.len() < 1000 {
                                self.aliases.insert(alias.clone());
                            } else {
                                self.warn("SSH host limit reached (1000 aliases).");
                            }
                        }
                    }
                }
                if key == "match" && tokens != ["all"] {
                    self.warn("Conditional Match rules are not evaluated, including Match exec. Connection matching requires review.");
                }
                rules.push(Rule::Option(key, tokens));
            }
        }
        rules
    }
    fn finish(self, rules: &[Rule], local_user: Option<&str>, scan: &mut Scan) {
        for alias in &self.aliases {
            let mut options = Map::new();
            let mut identities = vec![];
            let mut complete = self.complete;
            let mut declared = false;
            evaluate(
                rules,
                alias,
                true,
                &mut options,
                &mut identities,
                &mut complete,
                &mut declared,
            );
            if !declared {
                continue;
            }
            let hostname = options
                .remove("hostname")
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| alias.clone());
            // Only %h and %% are safe and unambiguous without a second/canonical pass.
            let hostname = hostname
                .replace("%%", "\0")
                .replace("%h", alias)
                .replace('\0', "%");
            if hostname.contains(['%', '$']) {
                complete = false;
            }
            let user = options
                .remove("user")
                .or_else(|| local_user.map(Value::from));
            if user
                .as_ref()
                .and_then(Value::as_str)
                .is_none_or(|s| s.contains(['%', '$']))
            {
                complete = false;
            }
            let port = options
                .remove("port")
                .and_then(|v| v.as_str().and_then(|p| p.parse::<u16>().ok()))
                .filter(|p| *p > 0);
            if options.remove("invalid_port").is_some() {
                complete = false;
            }
            let mut properties = Map::new();
            properties.insert("hostname".into(), alias.clone().into());
            properties.insert("source_ssh_alias".into(), alias.clone().into());
            properties.insert("source_resolved_hostname".into(), hostname.into());
            properties.insert("source_ssh_port".into(), port.unwrap_or(22).into());
            if let Some(user) = user {
                properties.insert("source_ssh_user".into(), user);
            }
            if !identities.is_empty() {
                properties.insert(
                    "source_ssh_identity_file".into(),
                    identities[0].clone().into(),
                );
            }
            // Scalar JSON string keeps the existing arbitrary-properties data model intact.
            properties.insert(
                "source_ssh_identity_files".into(),
                serde_json::to_string(&identities).unwrap().into(),
            );
            properties.insert(
                "source_ssh_proxy_jump".into(),
                options.remove("proxyjump").unwrap_or("none".into()),
            );
            properties.insert(
                "source_ssh_resolution".into(),
                if complete { "static-v1" } else { "review" }.into(),
            );
            scan.suggestions.push(Suggestion {
                id: format!("ssh:{alias}"),
                source: "~/.ssh/config + Includes + system defaults".into(),
                name: alias.clone(),
                component_type_id: "server".into(),
                properties,
            });
        }
        scan.warnings.extend(self.warnings);
        if scan.suggestions.iter().any(|s| {
            s.properties
                .get("source_ssh_resolution")
                .and_then(Value::as_str)
                == Some("review")
        }) {
            scan.warnings.push("Some SSH connections use unsupported or incomplete options. They can be imported, but will not be automatically matched by endpoint. OpenSSH applies the full configuration at launch.".into());
        }
    }
}
// OpenSSH Host patterns use * and ?, with negation overriding all positive matches.
fn wildcard(pattern: &str, value: &str) -> bool {
    let (p, v) = (pattern.as_bytes(), value.as_bytes());
    let (mut i, mut j, mut star, mut retry) = (0, 0, None, 0);
    while j < v.len() {
        if i < p.len() && (p[i] == b'?' || p[i].eq_ignore_ascii_case(&v[j])) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == b'*' {
            star = Some(i);
            i += 1;
            retry = j;
        } else if let Some(s) = star {
            retry += 1;
            j = retry;
            i = s + 1;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == b'*' {
        i += 1;
    }
    i == p.len()
}
fn host_matches(patterns: &[String], alias: &str) -> bool {
    let mut matched = false;
    for pattern in patterns {
        if let Some(negative) = pattern.strip_prefix('!') {
            if wildcard(negative, alias) {
                return false;
            }
        } else if wildcard(pattern, alias) {
            matched = true;
        }
    }
    matched
}
fn evaluate(
    rules: &[Rule],
    alias: &str,
    mut active: bool,
    props: &mut Map<String, Value>,
    identities: &mut Vec<String>,
    complete: &mut bool,
    declared: &mut bool,
) {
    for rule in rules {
        match rule {
            Rule::Include(files) if active => {
                // Included files inherit the active block; their ending block doesn't leak out.
                for rules in files {
                    evaluate(rules, alias, active, props, identities, complete, declared);
                }
            }
            Rule::Include(_) => {}
            Rule::Option(key, values) if key == "host" => {
                active = host_matches(values, alias);
                if active && values.iter().any(|value| value.eq_ignore_ascii_case(alias)) {
                    *declared = true;
                }
            }
            Rule::Option(key, values) if key == "match" => active = values == &["all"],
            Rule::Option(key, values) if active => {
                let value = &values[0];
                match key.as_str() {
                    "hostname" | "user" | "port" | "proxyjump" => {
                        if !props.contains_key(key) {
                            if values.len() != 1 {
                                *complete = false;
                            }
                            if key == "port"
                                && value.parse::<u16>().ok().filter(|p| *p > 0).is_none()
                            {
                                props.insert("invalid_port".into(), true.into());
                            }
                            if key == "proxyjump" && value != "none" {
                                *complete = false;
                            }
                            props.insert(key.clone(), value.clone().into());
                        }
                    }
                    "identityfile" => {
                        if values.len() != 1 || value.contains(['%', '$']) {
                            *complete = false;
                        }
                        if !identities.contains(value) {
                            identities.push(value.clone());
                        }
                    }
                    // No raw command text is copied into suggestions. These change routing,
                    // credentials, canonicalization, or session behavior: require human review.
                    "proxycommand"
                    | "canonicalizehostname"
                    | "canonicaldomains"
                    | "localcommand"
                    | "remotecommand"
                    | "certificatefile"
                    | "identityagent"
                    | "pkcs11provider"
                    | "securitykeyprovider"
                    | "localforward"
                    | "remoteforward"
                    | "dynamicforward"
                    | "hostkeyalias"
                    | "bindaddress"
                    | "bindinterface"
                    | "tag" => *complete = false,
                    "sendenv"
                    | "setenv"
                    | "serveraliveinterval"
                    | "serveralivecountmax"
                    | "connecttimeout"
                    | "connectionattempts"
                    | "loglevel"
                    | "syslogfacility"
                    | "tcpkeepalive"
                    | "compression"
                    | "hashknownhosts"
                    | "addkeystoagent"
                    | "usekeychain"
                    | "controlmaster"
                    | "controlpersist"
                    | "controlpath" => {}
                    _ => *complete = false,
                }
            }
            _ => {}
        }
    }
}
pub fn scan(home: &Path, system: Option<&Path>, result: &mut Scan) {
    let mut parser = Parser::new(home);
    let root = home.join(".ssh");
    let mut files = vec![parser.file(&root.join("config"), &root)];
    if let Some(path) = system {
        if path.exists() {
            files.push(parser.file(path, path.parent().unwrap_or(Path::new("/etc/ssh"))));
        }
    }
    // Read the account name, not a potentially stale/spoofed USER environment variable.
    let local_user = local_user();
    parser.finish(&[Rule::Include(files)], local_user.as_deref(), result);
}
fn local_user() -> Option<String> {
    #[cfg(unix)]
    unsafe {
        let mut pwd: libc::passwd = std::mem::zeroed();
        let mut result = std::ptr::null_mut();
        let mut buffer = vec![0u8; 65536];
        if libc::getpwuid_r(
            libc::geteuid(),
            &mut pwd,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        ) == 0
            && !result.is_null()
        {
            return std::ffi::CStr::from_ptr(pwd.pw_name)
                .to_str()
                .ok()
                .map(str::to_owned);
        }
    }
    None
}
#[cfg(test)]
pub fn parse_text(text: &str, result: &mut Scan) {
    let mut parser = Parser::new(Path::new("/nonexistent/opsportal-test"));
    let rules = parser.text(text, Path::new("/nonexistent/opsportal-test/.ssh"));
    parser.finish(&rules, Some("test-user"), result);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_rules_first_value_and_negation() {
        let mut scan = Scan::default();
        parse_text("Host prod alias\n HostName Server.EXAMPLE\n Port=2200\n IdentityFile '~/.ssh/a key'\nHost * !alias\n User ops\nHost *\n User fallback\n Port 22\n IdentityFile ~/.ssh/b\n", &mut scan);
        let alias = &scan.suggestions[0].properties;
        let prod = &scan.suggestions[1].properties;
        assert_eq!(alias["source_ssh_user"], "fallback");
        assert_eq!(prod["source_ssh_user"], "ops");
        assert_eq!(prod["source_ssh_port"], 2200);
        assert_eq!(prod["source_ssh_resolution"], "static-v1");
        assert_eq!(
            prod["source_ssh_identity_files"],
            "[\"~/.ssh/a key\",\"~/.ssh/b\"]"
        );
        assert!(host_matches(&["PRO?*".into()], "prod"));
    }
    #[test]
    fn includes_nested_globs_cycles_and_no_execution() {
        let home = std::env::temp_dir().join(format!("opsportal-ssh-{}", std::process::id()));
        let root = home.join(".ssh");
        std::fs::create_dir_all(root.join("parts")).unwrap();
        let original = "Include parts/*\nHost conditional\n Include conditional\n User after\nHost *\n Port 2222\n";
        std::fs::write(root.join("config"), original).unwrap();
        std::fs::write(
            root.join("parts/01"),
            "Host prod renamed\n HostName 10.0.0.8\nInclude ../not-relative-to-current-file\n",
        )
        .unwrap();
        std::fs::write(root.join("parts/02"), "Include nested\n").unwrap();
        std::fs::write(root.join("nested"), "Host prod\n User ops\n").unwrap();
        std::fs::write(
            root.join("conditional"),
            "User conditional-user\nHost other\nUser ignored\n",
        )
        .unwrap();
        let mut result = Scan::default();
        scan(&home, None, &mut result);
        let find = |name: &str| {
            &result
                .suggestions
                .iter()
                .find(|s| s.name == name)
                .unwrap()
                .properties
        };
        assert_eq!(find("prod")["source_ssh_user"], "ops");
        assert_eq!(find("conditional")["source_ssh_user"], "conditional-user");
        assert_ne!(find("renamed")["source_ssh_user"], "conditional-user");
        assert_eq!(find("prod")["source_ssh_port"], 2222);
        assert!(!result.suggestions.iter().any(|s| s.name == "other"));
        let system = home.join("system-config");
        std::fs::write(&system, "Port 2200\nUser system-user\n").unwrap();
        std::fs::write(
            root.join("config"),
            "Host first second\nHost first\n User explicit\n",
        )
        .unwrap();
        let mut defaults = Scan::default();
        scan(&home, Some(&system), &mut defaults);
        let second = &defaults
            .suggestions
            .iter()
            .find(|s| s.name == "second")
            .unwrap()
            .properties;
        assert_eq!(second["source_ssh_port"], 2200);
        assert_eq!(second["source_ssh_user"], "system-user");
        std::fs::write(root.join("config"), original).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("config")).unwrap(),
            original
        );
        let marker = home.join("should-not-exist");
        std::fs::write(
            root.join("nested"),
            format!(
                "Include config\nMatch exec \"touch {}\"\nHost evil\nProxyCommand SECRET\n",
                marker.display()
            ),
        )
        .unwrap();
        let mut result = Scan::default();
        scan(&home, None, &mut result);
        assert!(result.warnings.iter().any(|w| w.contains("Circular")));
        assert!(!marker.exists());
        assert!(!serde_json::to_string(&result).unwrap().contains("SECRET"));
        assert!(result
            .suggestions
            .iter()
            .all(|s| s.properties["source_ssh_resolution"] == "review"));
        std::fs::remove_dir_all(home).unwrap();
    }
}
