# lxweb

Framework web completo para Lx, inspirado no Phoenix/Plug. Construído sobre o Cowboy como adapter padrão.

Oferece um modelo de requisição/resposta baseado em pipelines composíveis, um roteador orientado a macros (`router.mlx`), abstração de controllers, views renderizadas no servidor e um sistema de componentes em tempo real (Live) via WebSockets.

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
│   ├── lxweb.lx                  # ServerConfig + API pública
│   ├── lxweb_conn.lx             # Struct Conn e helpers
│   ├── lxweb_router.lx           # match_path/2, strip_prefix/2, has_prefix/2
│   ├── lxweb_pipeline.lx         # run/2 + plugs embutidos
│   ├── lxweb_controller.lx       # render, json, text, redirect, send_resp…
│   ├── lxweb_view.lx             # render/3
│   ├── lxweb_live.lx             # gen_server do Live + Socket + diff/2
│   ├── lxweb_live_socket.lx      # cowboy_websocket — protocolo WS LxVM
│   ├── lxweb_server.lx           # gen_server do servidor HTTP
│   └── macros/
│       ├── router.mlx            # Macro de roteador
│       ├── controller.mlx        # Macro de controller
│       ├── view.mlx              # Macro de view
│       ├── live.mlx              # Macro Live
│       └── lxweb_adapter.mlx     # Behavior do adapter
├── adapters/
│   └── cowboy/
│       ├── library.yml
│       └── src/
│           └── lxweb_cowboy.erl.lx
└── test/
    └── lxweb_test.lx
```

---

## Uso Rápido

```lx
require "lxweb"
require "lxweb_cowboy"
require "lxweb_pipeline"
require "lxweb_controller"
require "lxweb_live"

defmodule my_router do
  as "router"

  pipelines %{
    browser: [
      {lxweb_pipeline, :fetch_params, []},
      {lxweb_pipeline, :put_secure_headers, []}
    ]
  }

  routes [
    {:scope, "/", :browser, [
      {:get,       "/",         :page_controller, :index},
      {:resources, "/users",    :user_controller},
      {:live,      "/contador", :counter_live}
    ]}
  ]
end

defmodule page_controller do
  as "controller"

  def index(conn, _params) do
    lxweb_controller:text(conn, "Hello, world!")
  end
end

defmodule counter_live do
  as "live"

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

```lx
defmodule my_router do
  as "router"

  pipelines %{
    browser: [{lxweb_pipeline, :fetch_params, []}, ...],
    api:     [{lxweb_pipeline, :accept_json, []}]
  }

  routes [
    {:scope, "/",    :browser, [
      {:get,       "/",       :page_controller, :index},
      {:resources, "/users",  :user_controller},
      {:live,      "/chat",   :chat_live}
    ]},
    {:scope, "/api", :api, [
      {:get, "/status", :api_controller, :status}
    ]}
  ]
end
```

`{:resources, path, ctrl}` expande para:
- `GET /path` → `:index`
- `GET /path/:id` → `:show`
- `GET /path/new` → `:new`
- `POST /path` → `:create`
- `GET /path/:id/edit` → `:edit`
- `PUT /path/:id` → `:update`
- `PATCH /path/:id` → `:update`
- `DELETE /path/:id` → `:delete`

### Controller

```lx
defmodule user_controller do
  as "controller"

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
  as "view"

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
  as "live"

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

## Dependências

`lxweb` em si não tem dependências externas.

`lxweb_cowboy` (`adapters/cowboy/library.yml`) requer:
- `cowboy ~> 2.0`
- `jsx` (para encode/decode JSON — incluso com Cowboy via `cowlib`)

---

## Adapter

Para criar um adapter customizado, implemente o behavior `lxweb_adapter`:

```lx
as behavior "lxweb_adapter"

def start(config, router) :: {:ok, any} | {:error, any} do
  # inicia o servidor HTTP
end

def stop(server) :: :ok do
  # para o servidor
end
```
