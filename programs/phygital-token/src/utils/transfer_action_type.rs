#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransferActionType {
    Transfer,
}

impl TransferActionType {
    pub fn to_bytes(self) -> &'static [u8] {
        match self {
            TransferActionType::Transfer => "transfer".as_bytes(),
        }
    }
}
