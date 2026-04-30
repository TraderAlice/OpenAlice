// Formula AST — mirrors the TS ASTNode union (calculator.ts, types.ts).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
}

impl BinaryOp {
    pub fn as_char(self) -> char {
        match self {
            BinaryOp::Add => '+',
            BinaryOp::Sub => '-',
            BinaryOp::Mul => '*',
            BinaryOp::Div => '/',
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BinaryOpNode {
    pub op: BinaryOp,
    pub left: Box<AstNode>,
    pub right: Box<AstNode>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FunctionNode {
    pub name: String,
    pub args: Vec<AstNode>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArrayAccessNode {
    pub array: Box<AstNode>,
    pub index: Box<AstNode>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AstNode {
    Number(f64),
    String(String),
    Function(FunctionNode),
    BinaryOp(BinaryOpNode),
    ArrayAccess(ArrayAccessNode),
}
