"""Safe arithmetic calculator tool using Python's AST evaluator."""

import ast
import math
import operator as op
from typing import Any

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

# Whitelist of safe AST node types and operators
_SAFE_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Num,        # Python < 3.8
    ast.Constant,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow,
    ast.Mod, ast.FloorDiv,
    ast.USub, ast.UAdd,
    ast.Call, ast.Name, ast.Load,
)

_SAFE_FUNCS: dict[str, Any] = {
    "abs": abs, "round": round,
    "sqrt": math.sqrt, "log": math.log, "log10": math.log10,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "pi": math.pi, "e": math.e,
    "floor": math.floor, "ceil": math.ceil,
}

_OPS: dict[type, Any] = {
    ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul,
    ast.Div: op.truediv, ast.Pow: op.pow, ast.Mod: op.mod,
    ast.FloorDiv: op.floordiv, ast.USub: op.neg, ast.UAdd: op.pos,
}


def _safe_eval(node: ast.AST) -> float:
    if not isinstance(node, _SAFE_NODES):
        raise ValueError(f"Unsupported operation: {type(node).__name__}")
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant):
        return float(node.value)
    if isinstance(node, ast.Num):  # Python < 3.8 compat
        return float(node.n)
    if isinstance(node, ast.BinOp):
        fn = _OPS.get(type(node.op))
        if fn is None:
            raise ValueError(f"Unsupported binary operator: {type(node.op).__name__}")
        return fn(_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp):
        fn = _OPS.get(type(node.op))
        if fn is None:
            raise ValueError(f"Unsupported unary operator: {type(node.op).__name__}")
        return fn(_safe_eval(node.operand))
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only simple function calls are allowed.")
        fn = _SAFE_FUNCS.get(node.func.id)
        if fn is None:
            raise ValueError(f"Function '{node.func.id}' is not allowed.")
        args = [_safe_eval(a) for a in node.args]
        return fn(*args)
    if isinstance(node, ast.Name):
        val = _SAFE_FUNCS.get(node.id)
        if val is None:
            raise ValueError(f"Name '{node.id}' is not allowed.")
        return val
    raise ValueError(f"Cannot evaluate node type: {type(node).__name__}")


class CalculatorInput(BaseModel):
    expression: str = Field(
        description="A mathematical expression to evaluate, e.g. '2 ** 10 + sqrt(144)'"
    )


class CalculatorTool(BaseTool):
    @property
    def name(self) -> str:
        return "calculator"

    @property
    def description(self) -> str:
        return (
            "Evaluate a safe mathematical expression. "
            "Supports +, -, *, /, **, %, //, sqrt, log, sin, cos, tan, abs, round, pi, e."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return CalculatorInput

    async def execute(self, expression: str, **_: Any) -> dict[str, Any]:
        try:
            tree = ast.parse(expression.strip(), mode="eval")
            result = _safe_eval(tree)
            return {"expression": expression, "result": result}
        except Exception as exc:
            return {"expression": expression, "error": str(exc)}
