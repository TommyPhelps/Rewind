//! API keys and tokens are encrypted with Windows' Data Protection API (DPAPI) before
//! they're stored, so they can only be read back by your Windows account on this PC.
//! The front end keeps only the encrypted form ("dpapi:<hex>") in its database.

/// Hex keeps the stored value plain ASCII (no extra crate needed).
fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("bad secret encoding".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "bad secret encoding".to_string()))
        .collect()
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        v
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
            let ok = CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out);
            if ok == 0 {
                return Err("Windows couldn't encrypt the key".into());
            }
            Ok(take(out))
        }
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
            let ok = CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out);
            if ok == 0 {
                return Err("Windows couldn't decrypt the key (was it saved by another Windows account?)".into());
            }
            Ok(take(out))
        }
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI is only available on Windows".into())
    }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI is only available on Windows".into())
    }
}

pub fn protect_str(plain: &str) -> Result<String, String> {
    Ok(format!("dpapi:{}", to_hex(&dpapi::protect(plain.as_bytes())?)))
}

pub fn unprotect_str(stored: &str) -> Result<String, String> {
    let hex = stored.strip_prefix("dpapi:").ok_or("not an encrypted value")?;
    String::from_utf8(dpapi::unprotect(&from_hex(hex)?)?).map_err(|_| "bad secret".to_string())
}

#[tauri::command]
pub async fn secret_protect(plain: String) -> Result<String, String> {
    protect_str(&plain)
}

#[tauri::command]
pub async fn secret_unprotect(stored: String) -> Result<String, String> {
    unprotect_str(&stored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trip() {
        let b = vec![0u8, 1, 127, 128, 255];
        assert_eq!(from_hex(&to_hex(&b)).unwrap(), b);
        assert!(from_hex("abc").is_err());
        assert!(from_hex("zz").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_round_trip() {
        let enc = protect_str("0123456789ABCDEF-secret").unwrap();
        assert!(enc.starts_with("dpapi:"));
        assert!(!enc.contains("secret"));
        assert_eq!(unprotect_str(&enc).unwrap(), "0123456789ABCDEF-secret");
    }
}
