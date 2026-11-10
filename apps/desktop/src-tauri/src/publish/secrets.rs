use serde::{Deserialize, Serialize};

use crate::model::{Result, StudioError};

const SERVICE: &str = "studio.dtedit.desktop";
// Windows Credential Manager caps a credential blob at 2560 bytes.
const MAX_SECRET: usize = 2400;

/// Everything secret about one connected account. Stored only in the OS keychain.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secret {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
}

pub trait SecretStore: Send + Sync {
    fn set(&self, name: &str, value: &str) -> Result<()>;
    fn get(&self, name: &str) -> Result<String>;
    fn delete(&self, name: &str) -> Result<()>;
}

pub fn save(store: &dyn SecretStore, name: &str, secret: &Secret) -> Result<()> {
    let json = serde_json::to_string(secret)
        .map_err(|_| StudioError::Input("Không thể lưu thông tin đăng nhập."))?;
    if json.len() > MAX_SECRET {
        return Err(StudioError::Input(
            "Token quá dài để lưu vào keychain của hệ điều hành.",
        ));
    }
    store.set(name, &json)
}

pub fn load(store: &dyn SecretStore, name: &str) -> Result<Secret> {
    serde_json::from_str(&store.get(name)?).map_err(|_| {
        StudioError::Input("Thông tin đăng nhập trong keychain không đọc được. Hãy kết nối lại.")
    })
}

/// Windows Credential Manager, macOS Keychain or the Secret Service.
pub struct Keychain;

fn entry(name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, name)
        .map_err(|_| StudioError::Input("Không mở được keychain của hệ điều hành để lưu token."))
}

impl SecretStore for Keychain {
    fn set(&self, name: &str, value: &str) -> Result<()> {
        entry(name)?
            .set_password(value)
            .map_err(|_| StudioError::Input("Không lưu được token vào keychain của hệ điều hành."))
    }

    fn get(&self, name: &str) -> Result<String> {
        entry(name)?.get_password().map_err(|_| {
            StudioError::Input("Không tìm thấy token trong keychain. Hãy kết nối lại tài khoản.")
        })
    }

    fn delete(&self, name: &str) -> Result<()> {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(StudioError::Input(
                "Không xóa được token khỏi keychain của hệ điều hành.",
            )),
        }
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct MemorySecrets(pub std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemorySecrets {
    fn set(&self, name: &str, value: &str) -> Result<()> {
        self.0.lock().unwrap().insert(name.into(), value.into());
        Ok(())
    }

    fn get(&self, name: &str) -> Result<String> {
        self.0
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .ok_or(StudioError::Input("missing secret"))
    }

    fn delete(&self, name: &str) -> Result<()> {
        self.0.lock().unwrap().remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "writes a throwaway entry to the real OS keychain"]
    fn real_keychain_round_trips_and_forgets_a_secret() {
        let name = "social-selftest--0";
        let secret = Secret {
            access_token: "x".repeat(600),
            refresh_token: Some("r".repeat(200)),
            ..Secret::default()
        };
        save(&Keychain, name, &secret).unwrap();
        assert_eq!(
            load(&Keychain, name).unwrap().access_token,
            secret.access_token
        );
        Keychain.delete(name).unwrap();
        assert!(Keychain.get(name).is_err());
        Keychain.delete(name).unwrap();
        let oversized = Secret {
            access_token: "x".repeat(3000),
            ..Secret::default()
        };
        assert!(save(&Keychain, name, &oversized).is_err());
    }
}
