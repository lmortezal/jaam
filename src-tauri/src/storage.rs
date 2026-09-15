use crate::model::{validate, Document};
use rand::RngCore;
use rusqlite::{params, Connection};
use std::path::Path;
use zeroize::Zeroizing;

pub fn unlock(path: &Path) -> Result<Connection, String> {
    let entry = keyring::Entry::new("dev.opsportal.desktop", "database-key-v1")
        .map_err(|e| e.to_string())?;
    let key = match entry.get_password() {
        Ok(key) => Zeroizing::new(key),
        Err(keyring::Error::NoEntry) if !path.exists() => {
            let mut bytes = Zeroizing::new([0u8; 32]);
            rand::rngs::OsRng.fill_bytes(bytes.as_mut());
            let key = Zeroizing::new(bytes.iter().map(|b| format!("{b:02x}")).collect::<String>());
            entry.set_password(&key).map_err(|e| format!("Cannot save key to system key store: {e}"))?;
            key
        }
        Err(keyring::Error::NoEntry) => return Err("Database key is missing from the OS key store. The existing database has not been changed.".into()),
        Err(e) => return Err(format!("Cannot access system key store: {e}")),
    };
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid database key in system key store".into());
    }
    open(path, &key).map_err(|e| format!("Cannot open encrypted database: {e}"))
}

pub fn open(path: &Path, key: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    let pragma = Zeroizing::new(format!("PRAGMA key = \"x'{key}'\";"));
    conn.execute_batch(&pragma)?;
    let cipher: String = conn.query_row("PRAGMA cipher_version", [], |r| r.get(0))?;
    if cipher.is_empty() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    conn.execute_batch("PRAGMA cipher_memory_security=ON; PRAGMA temp_store=MEMORY; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);")?;
    conn.execute(
        "INSERT OR IGNORE INTO inventory(id, document) VALUES(1, ?1)",
        params![serde_json::to_string(&Document::default()).unwrap()],
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(conn)
}
pub fn read(conn: &Connection) -> Result<Document, String> {
    let json: String = conn
        .query_row("SELECT document FROM inventory WHERE id=1", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    crate::model::decode(&json)
}
pub fn save(conn: &mut Connection, mut document: Document) -> Result<Document, String> {
    validate(&document)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let old = read(&tx)?;
    if old.revision != document.revision {
        return Err("The inventory changed. Lock and unlock to reload before saving.".into());
    }
    document.revision += 1;
    let json = serde_json::to_string(&document).map_err(|e| e.to_string())?;
    if json.len() > 16 * 1024 * 1024 {
        return Err("Inventory exceeds 16 MB".into());
    }
    tx.execute("UPDATE inventory SET document=?1 WHERE id=1", [json])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_restart_wrong_key_and_revision() {
        let path = std::env::temp_dir().join(format!("opsportal-test-{}.db", std::process::id()));
        let key = "a".repeat(64);
        let mut conn = open(&path, &key).unwrap();
        // Existing version-1 inventories migrate on the next successful transaction.
        let mut legacy = serde_json::to_value(Document::default()).unwrap();
        legacy["version"] = 1.into();
        legacy.as_object_mut().unwrap().remove("diagram_views");
        conn.execute(
            "UPDATE inventory SET document=?1 WHERE id=1",
            [legacy.to_string()],
        )
        .unwrap();
        let mut d = read(&conn).unwrap();
        assert_eq!(d.version, 2);
        let stored: String = conn
            .query_row("SELECT document FROM inventory WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&stored).unwrap()["version"],
            1
        );
        d.settings.auto_lock_minutes = 7;
        let saved = save(&mut conn, d.clone()).unwrap();
        assert_eq!(saved.revision, 1);
        assert!(save(&mut conn, d).is_err());
        let mut invalid = saved.clone();
        invalid.settings.auto_lock_minutes = 0;
        assert!(save(&mut conn, invalid).is_err());
        assert_eq!(read(&conn).unwrap().revision, 1);
        assert_eq!(read(&conn).unwrap().settings.auto_lock_minutes, 7);

        drop(conn);
        assert!(!std::fs::read(&path)
            .unwrap()
            .windows(6)
            .any(|w| w == b"SQLite"));
        assert!(open(&path, &"b".repeat(64)).is_err());
        let conn = open(&path, &key).unwrap();
        assert_eq!(read(&conn).unwrap().settings.auto_lock_minutes, 7);
        drop(conn);
        std::fs::remove_file(path).unwrap();
    }
}
