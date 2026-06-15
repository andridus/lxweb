# lxweb

Framework web completo para Lx, inspirado no Phoenix/Plug. Construído sobre o Cowboy como adapter padrão.

Oferece um modelo de requisição/resposta baseado em pipelines composíveis, roteador com match de rotas e path params, abstração de controllers, views renderizadas no servidor e um sistema de componentes em tempo real (Live) via WebSockets.

> **Status das macros**: as diretivas `as "lxweb/router"`, `as "lxweb/controller"`, `as "lxweb/live"` e `as "lxweb/view"` (macros `.mlx`) estão planejadas mas ainda não implementadas. Por enquanto, routers, controllers e módulos Live são escritos manualmente — veja [Uso Rápido](#uso-rápido) abaixo.

O subsistema Live usa um **protocolo WebSocket proprietário LxVM** para transportar patches HTML do servidor ao cliente. O cliente aplica os patches cirurgicamente usando [morphdom](https://github.com/patrick-steele-idem/morphdom). Sem virtual DOM, sem framework no cliente.

---

## Estrutura

```
lx_libs/lxweb/
├── library.yml
├── README.md
├── AGENTS.md
├── priv/
│   └── static/
│       ├── lxweb.js              # Cliente WS LxVM + morphdom (~6KB)
│       └── morphdom.min.js       # morphdom vendorizado v2.7.4
├── src/
│   ├── lxweb.lx                  # ServerConfig + API pública (start_link, stop, child_spec)
│   ├── lxweb_conn.lx             # Struct Conn, new/4, put_status, put_resp_header, halt…
│   ├── lxweb_router.lx           # dispatch/5, match_path/2, strip_prefix/2, extract_path_params/2
│   ├── lxweb_pipeline.lx         # run/2 + plugs embutidos (put_secure_headers, fetch_params…)
│   ├── lxweb_controller.lx       # render, json, text, redirect, send_resp…
│   ├── lxweb_view.lx             # render/3
│   ├── lxweb_request.lx          # Cliente de requests: build_conn, get/post/put/patch/delete
│   ├── lxweb_live.lx             # gen_server do Live + Socket + diff/2
│   ├── lxweb_live_controller.lx  # Controller Live: mount → render → HTML
│   ├── lxweb_live_socket.lx      # cowboy_websocket — protocolo WS LxVM
│   ├── lxweb_server.lx           # gen_server do servidor HTTP
│   ├── lxweb_cowboy.lx           # Adapter Cowboy: start/stop do listener
│   ├── lxweb_cowboy_handler.lx   # Handler Cowboy: req → conn → dispatch → reply
│   ├── lxweb_error.lx            # Página de erro HTML com stacktrace (dev)
│   └── pages/
│       └── error.html            # Template de erro estático
├── test/
│   ├── support/                  # Módulos auxiliares de teste (test_router, page_controller…)
│   ├── lxweb_conn_test.lx
│   ├── lxweb_router_test.lx
│   ├── lxweb_pipeline_test.lx
│   ├── lxweb_controller_test.lx
│   ├── lxweb_view_test.lx
│   ├── lxweb_request_test.lx     # Testes E2E: lxweb_request get/post/put → page_controller
│   ├── lxweb_live_test.lx
│   ├── lxweb_live_controller_test.lx
│   ├── lxweb_live_socket_test.lx
│   ├── lxweb_server_test.lx
│   └── lxweb_smoke_test.lx       # Smoke test
```

---

## Uso Rápido

Como as macros `as "lxweb/router"` ainda não existem, o router é escrito manualmente com uma função `dispatch/3` que delega para `lxweb_router:dispatch/5`. O controller e o módulo Live também são módulos Lx comuns.

```lx
require "lxweb"
require "lxweb_router"
require "lxweb_pipeline"
require "lxweb_controller"
require "lxweb_live"

defmodule my_router do
  def dispatch(conn, method, path) do
    pipelines = %{
      browser: [
        {:lxweb_pipeline, :fetch_params, []},
        {:lxweb_pipeline, :put_secure_headers, []}
      ]
    }
    routes = [
      {:scope, "/", :browser, [
        {:get,  "/",          :page_controller, :index},
        {:get,  "/users/:id", :user_controller, :show},
        {:post, "/users",     :user_controller, :create},
        {:live, "/contador",  :counter_live}
      ]}
    ]
    lxweb_router:dispatch(conn, method, path, pipelines, routes)
  end
end

defmodule page_controller do
  def index(conn, _params) do
    lxweb_controller:text(conn, "Hello, world!")
  end
end

defmodule counter_live do
  def mount(_params, _session, socket) do
    {:ok, lxweb_live:assign(socket, %{count: 0})}
  end

  def handle_event("inc", _p, socket) do
    {:noreply, lxweb_live:assign(socket, %{count: socket.assigns.count + 1})}
  end

  def render(assigns) do
    "<div data-lx-topic=\"lv:contador\"><button lx-click=\"inc\">#{assigns.count}</button></div>"
  end
end

def main do
  config = %lxweb:ServerConfig{
    adapter: :lxweb_cowboy,
    router: :my_router,
    port: 4000
  }
  {:ok, _server} = lxweb:start_link(config)
  receive do
    :stop -> :ok
  end
end
```

---

## Conceitos

### Conn

A estrutura central que flui por todos os pipelines, plugs e controllers.

```lx
struct Conn {
  method :: string          # "GET", "POST", …
  path :: string            # "/users/42"
  params :: map = %{}       # path + query + body
  req_headers :: list = []
  resp_headers :: list = []
  status :: integer = 200
  body :: string = ""
  assigns :: map = %{}
  halted :: boolean = false
  private :: map = %{}
  websocket :: boolean = false
}
```

### Plugs (Middleware)

Um plug é `(conn, opts) -> conn`. Pipelines são listas de plugs.

Plugs embutidos em `lxweb_pipeline`:
- `put_secure_headers/2` — cabeçalhos de segurança
- `fetch_params/2` — no-op (adapter já preenche conn.params)
- `fetch_session/2` — carrega sessão (stub)
- `accept_json/2` — define Content-Type JSON
- `logger/2` — loga a requisição

### Roteador

O roteador é um módulo com uma função `dispatch/3` que recebe `(conn, method, path)` e delega para `lxweb_router:dispatch/5` com as pipelines e rotas definidas:

```lx
defmodule my_router do
  def dispatch(conn, method, path) do
    pipelines = %{
      browser: [{:lxweb_pipeline, :fetch_params, []}, ...],
      api:     [{:lxweb_pipeline, :accept_json, []}]
    }
    routes = [
      {:scope, "/",    :browser, [
        {:get,  "/",       :page_controller, :index},
        {:live, "/chat",   :chat_live}
      ]},
      {:scope, "/api", :api, [
        {:get, "/status", :api_controller, :status}
      ]}
    ]
    lxweb_router:dispatch(conn, method, path, pipelines, routes)
  end
end
```

Este `dispatch/3` é o **exato ponto de entrada** chamado pelo handler HTTP (`lxweb_cowboy_handler`) em produção — e também pelo cliente de testes `lxweb_request`. Isso garante que testes e requests reais percorrem o mesmo caminho.

### Tipos de Rota

| Forma | Descrição |
|---|---|
| `{:get, path, controller, action}` | Rota GET |
| `{:post, path, controller, action}` | Rota POST |
| `{:put, path, controller, action}` | Rota PUT |
| `{:patch, path, controller, action}` | Rota PATCH |
| `{:delete, path, controller, action}` | Rota DELETE |
| `{:live, path, live_module}` | Rota Live ( WebSocket) |
| `{:live, path, live_module, layout_module}` | Rota Live com layout customizado |

> **Nota**: `{:resources, path, ctrl}` (expansão automática de CRUD) será disponibilizada via macro `as "lxweb/router"` no futuro.

### Controller

```lx
defmodule user_controller do
  def index(conn, _params) do
    lxweb_controller:json(conn, %{users: []})
  end

  def show(conn, %{id: id}) do
    lxweb_controller:json(conn, %{id: id})
  end
end
```

**Helpers:**
```lx
lxweb_controller:render(conn, view_module, template, assigns)
lxweb_controller:json(conn, data)
lxweb_controller:text(conn, text)
lxweb_controller:redirect(conn, url)
lxweb_controller:send_resp(conn, status, body)
lxweb_controller:put_status(conn, status)
lxweb_controller:get_param(conn, key)
lxweb_controller:halt(conn)
```

### View

```lx
defmodule my_views do
  def render("page/index.html", assigns) do
    "<html><body><h1>#{assigns.title}</h1></body></html>"
  end

  def render("user/show.html", assigns) do
    "<html><body><p>#{assigns.user.name}</p></body></html>"
  end
end
```

### Live

```lx
defmodule counter_live do
  def mount(_params, _session, socket) do
    {:ok, lxweb_live:assign(socket, %{count: 0})}
  end

  def handle_event("inc", _p, socket) do
    {:noreply, lxweb_live:assign(socket, %{count: socket.assigns.count + 1})}
  end

  def render(assigns) do
    "<div><button lx-click=\"inc\">#{assigns.count}</button></div>"
  end
end
```

**Helpers:**
```lx
lxweb_live:assign(socket, map)
lxweb_live:push_event(socket, event, payload)
lxweb_live:redirect(socket, url)
lxweb_live:put_flash(socket, key, msg)
```

---

## Protocolo WebSocket LxVM

Frames JSON: `[ref, topic, event, payload]`

**Cliente → Servidor:**
| Evento | Descrição |
|---|---|
| `lv:join` | Entrar no canal; dispara `mount/3` |
| `lv:event` | Interação do usuário → `handle_event/3` |
| `lv:heartbeat` | Keep-alive a cada 30s |
| `lv:leave` | Saída do cliente |

**Servidor → Cliente:**
| Evento | Descrição |
|---|---|
| `lv:joined` | HTML completo após `mount` |
| `lv:diff` | Patch HTML aplicado via morphdom |
| `lv:redirect` | Navegar para URL |
| `lv:push_event` | Evento JS customizado |
| `lv:flash` | Mensagem flash |
| `lv:pong` | Resposta ao heartbeat |

---

## Assets Estáticos

O JS do cliente é servido em `/lxweb/lxweb.js`. Inclua na sua view:

```html
<script src="/lxweb/lxweb.js"></script>
```

Elementos Live devem ter `data-lx-topic` com o nome do tópico. Eventos são declarados com `lx-click`, `lx-change`, `lx-submit`.

---

## Testes

O módulo `lxweb_request` é um cliente que simula requisições HTTP **ponta a ponta**. Cada chamada (`get`, `post`, etc.) constrói um `Conn` via `lxweb_conn:new/4` — a mesma função usada pelo handler Cowboy em produção — e dispara `router:dispatch/3`, o exato ponto de entrada do pipeline de requisição real. Isso garante que o teste percorre **todo** o fluxo: pipeline → match de rota → path params → controller → resposta.

### API

```lx
require "lxweb/lxweb_request"

conn = lxweb_request:build_conn(:my_router)

result = lxweb_request:get(conn, "/")
result = lxweb_request:get(conn, "/users/42")
result = lxweb_request:post(conn, "/users", %{name: "alice"})
result = lxweb_request:put(conn, "/users/1", %{name: "bob"})
result = lxweb_request:delete(conn, "/users/1")
```

| Função | Descrição |
|---|---|
| `build_conn(router)` | Cria um Conn template com o router armazenado em `private` |
| `build_conn(router, headers)` | Idem, com headers de request iniciais |
| `get(conn, path)` | Simula um GET |
| `post(conn, path, params)` | Simula um POST |
| `put(conn, path, params)` | Simula um PUT |
| `patch(conn, path, params)` | Simula um PATCH |
| `delete(conn, path)` | Simula um DELETE |
| `head(conn, path)` | Simula um HEAD |
| `options(conn, path)` | Simula um OPTIONS |
| `request(conn, method, path, params)` | Dispatch arbitrário |
| `response_status(conn)` | Extrai o status da resposta |
| `response_body(conn)` | Extrai o body da resposta |
| `response_header(conn, name)` | Busca um header de resposta |

### Exemplo

```lx
require "lxweb/lxweb_request"

describe "page routes" do
  test "GET / returns text body" do
    conn = lxweb_request:build_conn(:my_router)
    result = lxweb_request:get(conn, "/")
    assert result.status == 200
    assert result.body == "Hello, world!"
  end

  test "GET /users/:id extracts path params" do
    conn = lxweb_request:build_conn(:my_router)
    result = lxweb_request:get(conn, "/users/42")
    assert result.body == "User: 42"
  end

  test "POST /api/users returns 201 JSON" do
    conn = lxweb_request:build_conn(:my_router)
    result = lxweb_request:post(conn, "/api/users", %{name: "alice"})
    assert result.status == 201
    assert lxweb_request:response_header(result, "content-type") == "application/json"
  end

  test "browser pipeline adds secure headers" do
    conn = lxweb_request:build_conn(:my_router)
    result = lxweb_request:get(conn, "/")
    assert lxweb_request:response_header(result, "x-frame-options") == "SAMEORIGIN"
  end
end
```

### Por que é ponta a ponta?

O fluxo do handler Cowboy em produção é:

```
cowboy_req → lxweb_conn:new/4 → router:dispatch/3 → pipeline → controller → reply
```

O `lxweb_request` faz exatamente o mesmo, pulando apenas a camada TCP/HTTP:

```
build_conn → lxweb_conn:new/4 → router:dispatch/3 → pipeline → controller → retorna Conn
```

Como ambas as vias usam a mesma função `new/4` e o mesmo `router:dispatch/3`, qualquer mudança no roteador, pipeline ou controller é coberta pelos testes automaticamente.

---

## Dependências

`lxweb` depende de:
- `cowboy ~> 2.0` — servidor HTTP e WebSocket
- `ranch ~> 1.8` — aceitador de TCP (dependência do Cowboy)
- `cowlib ~> 2.11` — utilitários HTTP (dependência do Cowboy)
- `jsx ~> 3.1` — encode/decode JSON

---

## Adapter

O adapter padrão (`lxweb_cowboy`) está embutido em `src/lxweb_cowboy.lx` + `src/lxweb_cowboy_handler.lx`. Ele inicia o listener Cowboy e encaminha cada request para `router:dispatch/3`.

Para criar um adapter customizado, implemente as funções `start/2` e `stop/1` com a mesma assinatura e referencie-o em `ServerConfig.adapter`:

```lx
def start(config, router) :: {:ok, any} | {:error, any} do
  # inicia o servidor HTTP
end

def stop(server) :: :ok do
  # para o servidor
end
```

> **Nota**: o behavior formal `lxweb_adapter` (com `as behavior`) será disponibilizado no futuro junto com as macros `.mlx`.
