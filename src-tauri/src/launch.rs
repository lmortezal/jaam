use crate::model::{Component, LaunchAction};
use std::process::Command;

fn property(c: &Component, key: &str) -> String {
    c.properties
        .get(key)
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        })
        .unwrap_or_default()
}
fn expand(template: &str, c: &Component) -> Result<String, String> {
    let mut rest = template;
    let mut output = String::new();
    while let Some((before, after)) = rest.split_once('{') {
        output.push_str(before);
        let (key, tail) = after
            .split_once('}')
            .ok_or("Unclosed template placeholder")?;
        let value = if key == "name" {
            c.name.clone()
        } else {
            property(c, key)
        };
        if value.is_empty() {
            return Err(format!("Missing property: {key}"));
        }
        output.push_str(&value);
        rest = tail;
    }
    output.push_str(rest);
    if output.contains(['\n', '\r', '\0']) {
        return Err("Launch values cannot contain control lines".into());
    }
    Ok(output)
}
pub fn url(template: &str, c: &Component) -> Result<String, String> {
    let value = expand(template, c)?;
    let parsed = url::Url::parse(&value).map_err(|_| "Enter a complete http:// or https:// URL")?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only HTTP(S) URLs without embedded credentials are allowed".into());
    }
    Ok(parsed.to_string())
}
fn host(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-:@[]%".contains(&b))
        && value.matches('@').count() <= 1
}
fn user(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
pub fn ssh_args(template: &str, c: &Component) -> Result<Vec<String>, String> {
    // Tokenize the template BEFORE substitution. A field can never add arguments.
    let tokens = shlex::split(template).ok_or("Invalid SSH template quoting")?;
    if tokens.first().map(String::as_str) != Some("ssh") {
        return Err("SSH templates must start with ssh".into());
    }
    let mut options = Vec::new();
    let mut destination = None;
    let mut i = 1;
    let mut explicit_user = false;
    let mut explicit_port = false;
    let mut explicit_identity = false;
    while i < tokens.len() {
        match tokens[i].as_str() {
            "-p" | "-i" | "-l" => {
                let flag = &tokens[i]; i += 1;
                let value = expand(tokens.get(i).ok_or("Missing SSH option value")?, c)?;
                match flag.as_str() {
                    "-p" => { value.parse::<u16>().ok().filter(|p| *p > 0).ok_or("SSH port must be 1–65535")?; explicit_port = true; },
                    "-l" => { if !user(&value) { return Err("Invalid SSH user".into()); } explicit_user = true; },
                    _ => { if value.is_empty() { return Err("Identity file path is empty".into()); } explicit_identity = true; }
                }
                options.extend([flag.clone(), value]);
            }
            token if token.starts_with('-') => return Err("SSH templates only allow -p, -i and -l. Configure other SSH options in ~/.ssh/config.".into()),
            token => { let value = expand(token, c)?; if !host(&value) || destination.replace(value).is_some() { return Err("SSH requires exactly one hostname and no remote command".into()); } }
        }
        i += 1;
    }
    let destination = destination.ok_or("SSH hostname is required")?;
    for (flag, key, explicit) in [
        ("-l", "ssh_user", explicit_user || destination.contains('@')),
        ("-p", "ssh_port", explicit_port),
        ("-i", "ssh_identity_file", explicit_identity),
    ] {
        let value = property(c, key);
        if !explicit && !value.is_empty() {
            if flag == "-l" && !user(&value) {
                return Err("Invalid SSH user".into());
            }
            if flag == "-p" && value.parse::<u16>().ok().filter(|p| *p > 0).is_none() {
                return Err("SSH port must be 1–65535".into());
            }
            if value.contains(['\n', '\r', '\0']) {
                return Err("Invalid SSH option".into());
            }
            options.extend([flag.into(), value]);
        }
    }
    // Preserve OpenSSH's own expansion rules for config paths; expand UI ~/ paths here.
    for i in 0..options.len().saturating_sub(1) {
        if options[i] == "-i" && options[i + 1].starts_with("~/") {
            if let Ok(home) = std::env::var("HOME") {
                options[i + 1] = format!("{home}/{}", &options[i + 1][2..]);
            }
        }
    }
    options.extend(["--".into(), destination]);
    Ok(options)
}
fn quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub fn preview(action: &LaunchAction, c: &Component) -> Result<String, String> {
    match action.action_type.as_str() {
        "open_url" => url(&action.template, c),
        "ssh_terminal" => Ok(std::iter::once("/usr/bin/ssh".to_owned()).chain(ssh_args(&action.template, c)?).map(|v| quoted(&v)).collect::<Vec<_>>().join(" ")),
        "custom_command" => Err("Custom commands are reserved for a later release; v1 permits browser and SSH launches only.".into()),
        _ => Err("No launch action configured".into())
    }
}
pub fn run(action: &LaunchAction, c: &Component, terminal: &str) -> Result<(), String> {
    let resolved = preview(action, c)?;
    if action.action_type == "open_url" {
        #[cfg(target_os = "macos")]
        let mut cmd = Command::new("/usr/bin/open");
        #[cfg(target_os = "linux")]
        let mut cmd = Command::new("xdg-open");
        let status = cmd.arg(resolved).status().map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("Could not open default browser".into())
        };
    }
    #[cfg(target_os = "macos")]
    {
        let iterm = std::path::Path::new("/Applications/iTerm.app").exists()
            || std::env::var("HOME").is_ok_and(|h| {
                std::path::Path::new(&h)
                    .join("Applications/iTerm.app")
                    .exists()
            });
        if terminal == "iterm" && !iterm {
            return Err("iTerm2 is not installed".into());
        }
        let script = if terminal == "iterm" || (terminal == "auto" && iterm) {
            "on run argv\ntell application \"iTerm\"\nactivate\nset newWindow to (create window with default profile)\ntell current session of newWindow to write text (item 1 of argv)\nend tell\nend run"
        } else {
            "on run argv\ntell application \"Terminal\"\nactivate\ndo script (item 1 of argv)\nend tell\nend run"
        };
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", script, "--", &resolved])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Terminal launch failed. Allow OpsPortal to control Terminal in System Settings → Privacy & Security → Automation.".into());
        }
    }
    #[cfg(target_os = "linux")]
    {
        let _ = terminal;
        let known = ["gnome-terminal", "konsole", "alacritty", "kitty", "xterm"];
        let preferred = std::env::var("TERMINAL")
            .ok()
            .filter(|v| known.contains(&v.as_str()));
        let names = preferred
            .into_iter()
            .chain(known.iter().map(|s| s.to_string()));
        let mut launched = false;
        for name in names {
            let flag = if name == "gnome-terminal" { "--" } else { "-e" };
            match Command::new(&name)
                .arg(flag)
                .arg("/usr/bin/ssh")
                .args(ssh_args(&action.template, c)?)
                .spawn()
            {
                Ok(mut child) => {
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    launched = true;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        if !launched {
            return Err("No supported terminal found. Install gnome-terminal, konsole, alacritty, kitty, or xterm.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn c() -> Component {
        serde_json::from_str(r#"{"id":"1","environment_id":"e","component_type_id":"server","name":"Host","properties":{"hostname":"prod","ssh_user":"alice","ssh_port":2222},"launch_action":null,"updated_at":""}"#).unwrap()
    }
    #[test]
    fn rejects_injection_and_preserves_arguments() {
        let mut c = c();
        assert_eq!(
            ssh_args("ssh {hostname}", &c).unwrap(),
            ["-l", "alice", "-p", "2222", "--", "prod"]
        );
        c.properties
            .insert("hostname".into(), "-oProxyCommand=touch /tmp/pwn".into());
        assert!(ssh_args("ssh {hostname}", &c).is_err());
        c.properties
            .insert("hostname".into(), "host; whoami".into());
        assert!(ssh_args("ssh {hostname}", &c).is_err());
        assert!(ssh_args("ssh -o ProxyCommand=x prod", &c).is_err());
        assert!(ssh_args("ssh prod whoami", &c).is_err());
        assert!(url("javascript:alert(1)", &c).is_err());
        assert!(url("https://user:pass@example.com", &c).is_err());
        assert_eq!(quoted("a'b"), "'a'\\''b'");
    }
}
