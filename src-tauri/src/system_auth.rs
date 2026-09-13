pub fn challenge() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn opsportal_authenticate() -> i32;
        }
        if unsafe { opsportal_authenticate() } == 1 {
            Ok(())
        } else {
            Err("Authentication was cancelled, timed out, or is unavailable. Unlock with your system account to try again.".into())
        }
    }
    #[cfg(target_os = "linux")]
    {
        // A dedicated non-retaining auth_self policy is shipped in deb/rpm packages.
        // Never use pkexec: it can authenticate an administrator instead of this user.
        let stat = std::fs::read_to_string("/proc/self/stat").map_err(|e| e.to_string())?;
        let start = stat
            .rsplit_once(')')
            .and_then(|(_, rest)| rest.split_whitespace().nth(19))
            .ok_or("Cannot identify process")?;
        let subject = format!("{},{},{}", std::process::id(), start, unsafe {
            libc::getuid()
        });
        let status = std::process::Command::new("/usr/bin/pkcheck")
            .args([
                "--action-id",
                "dev.opsportal.unlock",
                "--process",
                &subject,
                "--allow-user-interaction",
            ])
            .status()
            .map_err(|_| "Install polkit and a desktop authentication agent")?;
        if status.success() {
            Ok(())
        } else {
            Err("Authentication failed. Ensure the OpsPortal polkit policy and your desktop authentication agent are installed.".into())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("This platform is not supported".into())
    }
}
