use keyring::Entry;

const SERVICE: &str = "ai.scratch.app";

pub fn get(key: &str) -> Result<Option<String>, keyring::Error> {
    let entry = Entry::new(SERVICE, key)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set(key: &str, value: &str) -> Result<(), keyring::Error> {
    Entry::new(SERVICE, key)?.set_password(value)
}

pub fn delete(key: &str) -> Result<(), keyring::Error> {
    match Entry::new(SERVICE, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn has(key: &str) -> Result<bool, keyring::Error> {
    Ok(get(key)?.is_some())
}
