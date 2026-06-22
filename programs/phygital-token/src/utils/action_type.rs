#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActionType {
    Transfer,
    Verify,
}

impl ActionType {
    pub fn to_bytes(self) -> &'static [u8] {
        match self {
            ActionType::Transfer => "transfer".as_bytes(),
            ActionType::Verify => "verify".as_bytes(),
        }
    }
}
