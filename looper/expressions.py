"""A bounded JavaScript numeric/boolean subset. Never executes source code."""
import math
import re


class ExpressionError(ValueError):
    pass


TOKEN = re.compile(r'\s*(?:(\$[A-Za-z0-9_]+)|((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|(true|false)\b|(===|!==|==|!=|>=|<=|&&|\|\||[+*/%()!<>-]))')
PRECEDENCE = {'||':1, '&&':2, '==':3, '!=':3, '===':3, '!==':3,
              '>':4, '>=':4, '<':4, '<=':4, '+':5, '-':5, '*':6, '/':6, '%':6}


def evaluate(expression, values):
    if not expression or not expression.strip():
        return True
    if len(expression) > 4096:
        raise ExpressionError('表达式过长')
    tokens, offset = [], 0
    source = expression.strip()
    while offset < len(source):
        match = TOKEN.match(source, offset)
        if not match:
            raise ExpressionError('不支持的语法（函数、属性、索引和代码执行均禁止）')
        tokens.append(next(group for group in match.groups() if group is not None))
        offset = match.end()
    if len(tokens) > 256:
        raise ExpressionError('表达式过于复杂')
    position = 0

    def parse(minimum=1, depth=0):
        nonlocal position
        if depth > 64 or position >= len(tokens):
            raise ExpressionError('表达式结构无效或嵌套过深')
        token = tokens[position]
        position += 1
        if token in ('!', '+', '-'):
            left = ('unary', token, parse(7, depth + 1))
        elif token == '(':
            left = parse(1, depth + 1)
            if position >= len(tokens) or tokens[position] != ')':
                raise ExpressionError('括号不匹配')
            position += 1
        elif token.startswith('$'):
            left = ('variable', token)
        elif token in ('true', 'false'):
            left = ('literal', token == 'true')
        else:
            try:
                left = ('literal', float(token))
            except ValueError as exc:
                raise ExpressionError('不支持的表达式语法') from exc
        while position < len(tokens) and PRECEDENCE.get(tokens[position], 0) >= minimum:
            operator = tokens[position]
            position += 1
            right = parse(PRECEDENCE[operator] + 1, depth + 1)
            left = ('binary', operator, left, right)
        return left

    tree = parse()
    if position != len(tokens):
        raise ExpressionError('表达式含有未支持的语法')

    def walk(node):
        if node[0] == 'literal': return node[1]
        if node[0] == 'variable':
            if node[1] not in values: raise ExpressionError(f'未知或随机变量：{node[1]}')
            return values[node[1]]
        if node[0] == 'unary':
            value = walk(node[2])
            if node[1] == '!': return not value
            if node[1] == '-': return -value
            return +value
        operator, left = node[1], walk(node[2])
        if operator == '&&': return walk(node[3]) if left else left
        if operator == '||': return left if left else walk(node[3])
        right = walk(node[3])
        if operator == '+': return left + right
        if operator == '-': return left - right
        if operator == '*': return left * right
        if operator == '/': return left / right
        if operator == '%': return math.fmod(left, right)
        if operator == '==': return left == right
        if operator == '!=': return left != right
        if operator in ('===', '!=='):
            equal = (isinstance(left, bool) == isinstance(right, bool)) and left == right
            return equal if operator == '===' else not equal
        if operator == '>': return left > right
        if operator == '>=': return left >= right
        if operator == '<': return left < right
        if operator == '<=': return left <= right
        raise ExpressionError('不支持的运算符')

    try:
        result = walk(tree)
        if not math.isfinite(result) or abs(result) > 1e12:
            raise ExpressionError('变量数值超出分析范围')
        return result
    except (ArithmeticError, RecursionError, TypeError) as exc:
        raise ExpressionError('表达式运算失败') from exc


def execute(command, values):
    updated = dict(values)
    for statement in (command or '').split(';'):
        if not statement.strip(): continue
        match = re.fullmatch(r'\s*(\$[A-Za-z0-9_]+)\s*(=|\+=|-=|\*=|/=|%=)\s*(.+?)\s*', statement)
        if not match: raise ExpressionError('不支持的变量更新语句')
        key, operator, expression = match.groups()
        if key not in updated: raise ExpressionError(f'未知或随机变量：{key}')
        if operator != '=': expression = f'{key}{operator[0]}({expression})'
        updated[key] = evaluate(expression, updated)
    return updated
