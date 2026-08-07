#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActionType {
    Transfer,
}

impl ActionType {
    pub fn to_bytes(self) -> &'static [u8] {
        match self {
            ActionType::Transfer => "transfer".as_bytes(),
        }
    }
}
