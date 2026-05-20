# AGENTS.md - Lx Language Syntax Reference

When writing `.lx` code, follow these syntax rules exactly. This is the authoritative reference for Lx code generation.

## File Structure

- File extension: `.lx`
- Entry point function: `def main do ... end`
- One module per file by default; use `defmodule` for submodules (generates separate `.erl` files)

## Comments

```lx
# Single-line comments only
x = 42  # inline comment
```

## Literals

```lx
42              # integer
0xFF            # hex (255)
0o77            # octal (63)
0b1010          # binary (10)
3.14            # float
"hello"         # string (double-quoted)
'hello'         # charlist (single-quoted, compiles to Erlang charlist)
:ok             # atom
true / false    # booleans
nil             # nil
```

### String Interpolation

```lx
name = "World"
"Hello #{name}!"         # "Hello World!"
num = 42
"The answer is #{num}"   # "The answer is 42"
```

### Escape Sequences in Strings

`\n`, `\t`, `\r`, `\"`, `\\`

## Variables

```lx
x = 42                  # lowercase, immutable bindings
result = x * 2
_unused = 1             # _ prefix suppresses unused variable warnings
```

## Collections

```lx
[]                      # empty list
[1, 2, 3]              # list
[head | tail]           # cons (prepend)

{}                      # empty tuple
{1, 2}                  # 2-tuple
{:ok, 42, "hello"}     # 3-tuple

%{}                     # empty map
%{a: 1}                # map with atom key
%{a: 1, b: 2}          # map with multiple keys
%{x => y}              # map with expression key
```

### Map Access

```lx
m = %{x: 10, y: 20}
m.x                     # 10 (dot access)
m.y                     # 20
```

### Map Spread (`...`)

Merge a map into another using the spread operator inside a map update:

```lx
base = %{host: "localhost", port: 5432}
config = %{base | ...%{port: 5433, database: "mydb"}}
```

## Structs

### Definition

```lx
struct User {
  name :: string
  age :: integer
}
```

### Field Defaults

```lx
struct Config {
  host :: string
  port :: integer
  debug :: boolean = true
}
```

### Field with Function Reference

```lx
struct User {
  name :: string
  age :: integer
  action :: (_self, string) :: string = &action/2
}
```

IMPORTANT: Struct literals use `%StructName{key: value}` syntax:

```lx
user = %User{name: "Alice", age: 30}
```

DO NOT use `%{StructName, key: value}` -- that is incorrect.

### Struct Update

```lx
updated = %{user | age: 31}
```

### Struct Access

```lx
user.name               # dot access
user.age
```

### Struct Pattern Matching

```lx
case item do
  %Item{value: v} when v > 50 -> {:high, v}
  %Item{value: v} when v <= 50 -> {:low, v}
end
```

### External Module Struct

```lx
%lxapp:Column{
  children: [
    %lxapp:Text{content: "Hello from LX!"},
  ]
}
```

## Functions

### Public Function

```lx
def add(a, b) do
  a + b
end
```

### Private Function

```lx
defp helper(x) do
  x * 2
end
```

### Function with Type Annotations

```lx
def add(a :: integer, b :: integer) :: integer do
  a + b
end
```

Return type goes after the parameter list: `def name(params) :: return_type do ... end`

### Function Default Parameters

```lx
def greet(name, prefix \\ "Hello") do
  "#{prefix}, #{name}!"
end
```

### Multi-Head Function

```lx
def classify do
  (0) -> :zero
  (n) when n > 0 -> :positive
  (n) -> :negative
end
```

### Lambda (Anonymous Function)

```lx
fn(x) -> x * 2 end
fn(a, b) -> a + b end

# Multi-line lambda
fn(x, y) do
  temp = x * 2
  temp + y
end

# Lambda call (requires dot syntax)
f = fn(x) -> x * 2 end
f.(5)         # returns 10
```

### FFI (Foreign Function Interface) Function

Append `$` after params to mark a function as FFI. The body string is emitted directly as native code with `#{param}` interpolation:

```lx
def write(path :: string, content :: string)$ :: :ok do
  "file:write_file(#{path}, #{content})"
end
```

DO NOT use multi-line bodies in FFI functions — the first expression must be a string template or string interpolation.

### External Function Call

```lx
io:format("Hello~n")
erlang:list_to_atom("ok")
module:function(args)
```

## Operators

### Arithmetic

```lx
a + b          # addition
a - b          # subtraction
a * b          # multiplication
a / b          # float division
a div b        # integer division
a rem b        # integer remainder
```

### String Concatenation

```lx
"hello" <> " world"     # "hello world" (binary concatenation)
```

Prefer string interpolation `"#{x}"` for single values; use `<>` to join pre-formed strings.

### Comparison

```lx
a == b    a != b    a < b    a > b    a <= b    a >= b
a === b   a !== b
```

### Logical

```lx
a and b        a or b        not a
a andalso b    a orelse b
a xor b
```

### Bitwise

```lx
a band b       a bor b       a bxor b
a bsl b        a bsr b       bnot a
```

### Membership

```lx
x in list      # true if x is in list
3 in [1, 2, 3] # true
```

### List Operations

```lx
list1 ++ list2   # concatenation
list1 -- list2   # subtraction
```

### Unary

```lx
-42             # negation
not true        # logical not
bnot 0          # bitwise not
```

## Control Flow

### If/Else

```lx
if condition do
  :yes
else
  :no
end
```

### Case

```lx
case value do
  {:ok, data} -> data
  {:error, _} -> nil
  n when n > 0 -> :positive
  _ -> :default
end
```

Guards use `when`. Wildcard is `_`.

### With

```lx
result = with x <- {:ok, 42} do
  x * 2
end
```

### Match

```lx
match {:ok, val} <- some_expr
# On mismatch, function returns the failed value immediately

# With rescue clause
match {:ok, val} <- some_expr rescue reason do
  {:handled, reason}
end
```

### For Comprehensions

```lx
# Map
for x in [1, 2, 3] do
  x * 2
end

# Map with filter
for x in [1, 2, 3, 4, 5] when x > 2 do
  x * 2
end

# Multiple iterators
for x in [1, 2, 3], y in [4, 5] do
  x * y
end

# Reduce
for x in [1, 2, 3, 4, 5], acc = 0 do
  acc + x
end

# Reduce with filter
for x in [1, 2, 3, 4, 5] when x > 2, acc = 0 do
  acc + x
end
```

## Concurrency

```lx
# Spawn a process
spawn(fn() -> :ok end)

# Send a message
pid ! :hello

# Receive messages
receive do
  {:ok, data} -> data
  {:error, _} -> :error
end
```

## Pattern Matching

Pattern matching is the primary control flow mechanism. It works in:

- `=` binding: `{:ok, x} = {:ok, 42}`
- `=` destructuring: `{a, b} = some_function()`
- `case` clauses: `{:ok, data} -> data`
- Function heads (multi-head): `(0) -> :zero`
- `match` expressions: `match {:ok, val} <- expr`
- `with` expressions: `with x <- {:ok, 42} do ... end`
- `receive` blocks

Wildcard: `_` or `_name` (unused variable)

## Types

```lx
type status :: :ok | :error
type count :: integer
type point :: {integer, integer}
type result(T) :: {:some, T} | :none
type pair(A, B) :: {A, B}
type empty_list :: []
type opaque user_id :: integer
```

## Directives

```lx
@moduledoc "Module description"
@doc "Function description"
```

## Module Declarations

### Require

```lx
require "cowboy"                  # local library
require "lxapp"                   # local library (identifier form)
require "@lx/file"                # LX native library (prefix @lx/)
require "@lx/io"                  # LX native library
require "@lx/enum"                # LX native library
require "@lx/string"              # LX native library
require "@lx/erlang"              # LX native library
require "@lx/re"                  # LX native library (regex)
require "../app1/app1_helper"     # relative path (multi-app projects)
```

### Available Standard Libraries (`@lx/`)

| Library | Description |
|---------|-------------|
| `@lx/io` | IO: `puts`, `write`, `format`, `inspect`, `warn` |
| `@lx/file` | File: `read`, `write`, `append`, `delete`, `mkdir`, `list_dir` |
| `@lx/enum` | Enumeration: `map`, `filter`, `reduce`, `find`, `sort`, `group_by`, `map_while`, … |
| `@lx/string` | Strings: `split`, `join`, `trim`, `upcase`, `replace`, `to_integer`, … |
| `@lx/erlang` | BIFs: `apply`, `is_integer`, `list_to_atom`, `term_to_binary`, … |
| `@lx/gen_server` | GenServer: `start_link`, `call`, `cast`, `stop`, `reply` |
| `@lx/re` | Regex: `match`, `run`, `replace`, `split`, `compile`, `named_captures` |

### Defmodule (Submodule)

```lx
defmodule my_worker do
  def init(args) do
    {:ok, args}
  end
end
```

Module names must be snake_case (lowercase). Generates a separate `.erl` file.

### Behavior Declaration

```lx
as behavior "gen_server"

def init(args) do
  {:ok, args}
end
```

### Application Config

```lx
as "application"

name :my_app
description "My App"
vsn "0.1.0"
mod my_app
```

### Supervisor Config

```lx
as "supervisor"

name :my_sup
strategy :one_for_one
intensity 3
period 5
```

### Macro Invocation

```lx
as "gen_server"
as "supervisor"
as "application"
as "@lx/app/view"          # LX native macro (prefix @lx/)
```

## Library Projects

Libraries use `library.yml` instead of `project.yml` and expose modules from `src/`:

```yaml
name: mylibrary
version: "0.1.0"
description: "My Lx library"
dependencies: {}
dev_dependencies: {}
```

Reference a local library from a project's `project.yml`:

```yaml
dependencies:
  mylibrary:
    path: "../../lx_libs/mylibrary"
```

Create a library scaffold with: `lx new mylibrary --lib`

## Testing

```lx
describe "Math tests" do
  test "addition" do
    1 + 1 == 2
  end

  test "multiple" do
    assert true
  end
end
```

`assert` can also be used outside test blocks.

## Common Pitfalls

- Struct literals: use `%StructName{field: value}`, NOT `%{StructName, field: value}`
- Lambda calls: use `f.(5)` with dot, NOT `f(5)`
- String concatenation: use `"Hello #{name}!"` interpolation, NOT `"Hello " ++ name`; use `<>` to join strings
- External calls: use `module:function(args)` with colon, NOT `module.function(args)`
- Atoms: use `:ok` with colon prefix, NOT `ok`
- Booleans: `true` and `false` are literals, NOT `:true` / `:false`
- Nil: `nil` is a literal, NOT `:nil`
- Comments: `#` only, NOT `//` or `/* */`
- Blocks: use `do ... end`, NOT curly braces
- Function keyword: `fn`, NOT `fun` or `func`
- Private functions: `defp`, NOT `def private`
- FFI functions: `$` goes AFTER params, NOT before: `def foo(x)$ do ... end`
- Require: use string paths `"@lx/file"`, NOT atoms for native LX libraries
- Behavior: use string name `as behavior "gen_server"`, NOT bare identifier
- Default params: use `\\` NOT `=` in function signatures: `def f(x, y \\ 0)`
