use crate::model::{decode, validate, Document};
use age::secrecy::SecretString;
use std::io::{Read, Write};
use zeroize::Zeroizing;

const MAX_PLAIN: u64 = 16 * 1024 * 1024;
pub const MAX_FILE: usize = 17 * 1024 * 1024;
const FAILURE: &str = "Unable to decrypt: incorrect password or damaged backup";

pub fn encrypt(document: &Document, password: String) -> Result<Vec<u8>, String> {
    let password = Zeroizing::new(password);
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err("Use a backup password of at least 12 characters (at most 1024 bytes)".into());
    }
    validate(document)?;
    let plaintext = Zeroizing::new(serde_json::to_vec(document).map_err(|e| e.to_string())?);
    if plaintext.len() as u64 > MAX_PLAIN { return Err("Backup is too large".into()); }
    let mut recipient = age::scrypt::Recipient::new(SecretString::from(password.to_string()));
    // A fixed interoperable profile bounds memory on both platforms (128 MiB).
    recipient.set_work_factor(17);
    let encryptor = age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
        .map_err(|e| e.to_string())?;
    let mut encrypted = Vec::new();
    let mut writer = encryptor.wrap_output(&mut encrypted).map_err(|e| e.to_string())?;
    writer.write_all(&plaintext).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(encrypted)
}

pub fn decrypt(bytes: &[u8], password: String) -> Result<Document, String> {
    let password = Zeroizing::new(password);
    if bytes.len() > MAX_FILE || password.len() > 1024 { return Err("Backup or password exceeds limits".into()); }
    let decryptor = age::Decryptor::new(bytes).map_err(|_| FAILURE)?;
    if !decryptor.is_scrypt() { return Err("Expected a password-encrypted OpsPortal backup".into()); }
    let mut identity = age::scrypt::Identity::new(SecretString::from(password.to_string()));
    identity.set_max_work_factor(18);
    let reader = decryptor.decrypt(std::iter::once(&identity as &dyn age::Identity)).map_err(|_| FAILURE)?;
    let mut plaintext = Zeroizing::new(Vec::new());
    // Read through the authenticated final chunk before parsing or exposing any data.
    reader.take(MAX_PLAIN + 1).read_to_end(&mut plaintext).map_err(|_| FAILURE)?;
    if plaintext.len() as u64 > MAX_PLAIN { return Err("Decrypted backup is too large".into()); }
    decode(std::str::from_utf8(&plaintext).map_err(|_| FAILURE)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authenticated_backup_and_migration() {
        let mut value = serde_json::to_value(Document::default()).unwrap();
        value["version"] = 1.into();
        value["revision"] = 7.into();
        let document = decode(&value.to_string()).unwrap();
        assert_eq!(document.version, 2);
        assert_eq!(document.revision, 7);
        let pass = "a long test passphrase";
        let bytes = encrypt(&document, pass.into()).unwrap();
        assert!(!bytes.windows(12).any(|x| x == b"environments"));
        assert_eq!(decrypt(&bytes, pass.into()).unwrap().revision, 7);
        assert!(decrypt(&bytes, "incorrect password".into()).is_err());
        assert!(decrypt(&bytes[..bytes.len()-1], pass.into()).is_err());
        let mut corrupt = bytes.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(decrypt(&corrupt, pass.into()).is_err());
        value["version"] = 99.into();
        assert!(decode(&value.to_string()).is_err());
    }
}
