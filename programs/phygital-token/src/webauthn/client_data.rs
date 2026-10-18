//! Reading fields of a WebAuthn `clientDataJSON` without a JSON parser.
//!
//! The signature covers `SHA256(clientDataJSON)`, so these bytes are fixed by
//! whoever produced the assertion. Browsers serialize `type` first, then
//! `challenge`, then `origin` (WebAuthn §5.8.1.1), so the first occurrence of
//! each key is the real field. A client talking CTAP2 to the authenticator
//! directly writes its own `clientDataJSON`; see `docs/program/THREAT_MODEL.md`.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

pub(super) const JSON_CHALLENGE_KEY: &[u8] = br#""challenge":""#;
pub(super) const JSON_ORIGIN_KEY: &[u8] = br#""origin":""#;
pub(super) const JSON_TYPE_KEY: &[u8] = br#""type":""#;
/// Unpadded base64url of a 32-byte challenge.
const CHALLENGE_B64URL_LEN: usize = 43;

pub(super) fn extract_challenge_from_client_data_json(client_data_json: &[u8]) -> Result<[u8; 32]> {
    let challenge_b64 = json_quoted_value(client_data_json, JSON_CHALLENGE_KEY)?;
    decode_base64url_32(challenge_b64)
}

/// The raw (still escaped) string value following the first occurrence of
/// `key_with_colon_quote`, e.g. `"origin":"`.
pub(super) fn json_quoted_value<'a>(
    json: &'a [u8],
    key_with_colon_quote: &[u8],
) -> Result<&'a [u8]> {
    let start = json
        .windows(key_with_colon_quote.len())
        .position(|window| window == key_with_colon_quote)
        .ok_or(PhygitalError::UnableToParseClientData)?;
    let val_start = start
        .checked_add(key_with_colon_quote.len())
        .ok_or(PhygitalError::UnableToParseClientData)?;
    let mut i = val_start;
    while i < json.len() {
        match json[i] {
            b'\\' => {
                i = i
                    .checked_add(2)
                    .ok_or(PhygitalError::UnableToParseClientData)?;
            }
            b'"' => return Ok(&json[val_start..i]),
            _ => i += 1,
        }
    }
    err!(PhygitalError::UnableToParseClientData)
}

fn b64url_val(c: u8) -> Result<u8> {
    Ok(match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'-' => 62,
        b'_' => 63,
        _ => return err!(PhygitalError::UnableToParseClientData),
    })
}

/// Decodes exactly 43 unpadded base64url characters into 32 bytes.
fn decode_base64url_32(input: &[u8]) -> Result<[u8; 32]> {
    require!(
        input.len() == CHALLENGE_B64URL_LEN,
        PhygitalError::UnableToParseClientData
    );

    let mut out = [0u8; 32];
    let mut o = 0usize;
    let mut i = 0usize;
    while i + 4 <= 40 {
        let a = b64url_val(input[i])?;
        let b = b64url_val(input[i + 1])?;
        let c = b64url_val(input[i + 2])?;
        let d = b64url_val(input[i + 3])?;
        out[o] = (a << 2) | (b >> 4);
        out[o + 1] = (b << 4) | (c >> 2);
        out[o + 2] = (c << 6) | d;
        o += 3;
        i += 4;
    }

    let a = b64url_val(input[40])?;
    let b = b64url_val(input[41])?;
    let c = b64url_val(input[42])?;
    out[30] = (a << 2) | (b >> 4);
    out[31] = (b << 4) | (c >> 2);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use proptest::prelude::*;

    #[test]
    fn finds_the_first_occurrence_of_each_field() {
        let json = br#"{"type":"webauthn.get","challenge":"abc","origin":"https://a.example","crossOrigin":false,"other":{"origin":"x"}}"#;
        assert_eq!(
            json_quoted_value(json, JSON_TYPE_KEY).unwrap(),
            b"webauthn.get"
        );
        assert_eq!(
            json_quoted_value(json, JSON_ORIGIN_KEY).unwrap(),
            b"https://a.example"
        );
    }

    #[test]
    fn keeps_escapes_and_stops_at_the_closing_quote() {
        let json = br#"{"origin":"a\"b","x":1}"#;
        assert_eq!(
            json_quoted_value(json, JSON_ORIGIN_KEY).unwrap(),
            br#"a\"b"#
        );
        assert!(json_quoted_value(br#"{"origin":"unterminated"#, JSON_ORIGIN_KEY).is_err());
        assert!(json_quoted_value(br#"{"type":"x"}"#, JSON_ORIGIN_KEY).is_err());
    }

    #[test]
    fn rejects_challenges_of_the_wrong_length_or_alphabet() {
        let good = URL_SAFE_NO_PAD.encode([5u8; 32]);
        assert!(decode_base64url_32(good.as_bytes()).is_ok());
        assert!(decode_base64url_32(&good.as_bytes()[..42]).is_err());
        let mut padded = good.clone();
        padded.push('=');
        assert!(decode_base64url_32(padded.as_bytes()).is_err());
        let standard = good.replace('-', "+").replace('_', "/");
        if standard != good {
            assert!(decode_base64url_32(standard.as_bytes()).is_err());
        }
    }

    proptest! {
        #[test]
        fn decodes_what_base64url_encodes(bytes in any::<[u8; 32]>()) {
            let encoded = URL_SAFE_NO_PAD.encode(bytes);
            prop_assert_eq!(decode_base64url_32(encoded.as_bytes()).unwrap(), bytes);
        }

        #[test]
        fn scanning_never_panics(json in proptest::collection::vec(any::<u8>(), 0..300)) {
            let _ = json_quoted_value(&json, JSON_ORIGIN_KEY);
            let _ = extract_challenge_from_client_data_json(&json);
        }
    }
}
