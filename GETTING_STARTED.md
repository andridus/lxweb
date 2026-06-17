# lxweb Quick Start Guide

A practical tutorial for building a complete web application with lxweb, from scratch to deployment.

---

## Table of Contents

1. [Create the Project](#1-create-the-project)
2. [File Structure](#2-file-structure)
3. [First Route: Hello World](#3-first-route-hello-world)
4. [Router with Scopes and Pipelines](#4-router-with-scopes-and-pipelines)
5. [Controllers: JSON, Text, Redirect](#5-controllers-json-text-redirect)
6. [Path Params](#6-path-params)
7. [Views: HTML Rendering](#7-views-html-rendering)
8. [Live: Real-Time with WebSockets](#8-live-real-time-with-websockets)
9. [Custom Layouts for Live](#9-custom-layouts-for-live)
10. [Serving Static Assets](#10-serving-static-assets)
11. [E2E Testing](#11-e2e-testing)
12. [Running the Server](#12-running-the-server)
13. [Quick Reference](#13-quick-reference)

---

## 1. Create the Project

Create a new web project using the Lx scaffolder:

```bash
lx new my_blog --web
cd my_blog
```

Then add lxweb as a dependency in `project.yml`:

```yaml
name: my_blog
version: "0.1.0"
description: "My blog built with Lx"
target: erlang

dependencies:
  lxweb:
    path: "../../lx_libs/lxweb"    # or git: "https://github.com/andridus/lxweb"
  cowboy: "~> 2.0"

apps:
  my_blog:
    main: "my_blog"
    description: "My Blog"
    vsn: "0.1.0"
    applications:
      - cowboy
```

Fetch dependencies:

```bash
lx deps get
```

---

## 2. File Structure

A typical lxweb application has this structure:

```
my_blog/
├── project.yml
├── config/
│   ├── config.yml
│   └── dev.yml
├── apps/
│   └── my_blog/
│       ├── my_blog.lx              # Entry point (def main)
│       ├── my_blog_router.lx       # Route definitions
│       ├── page_controller.lx      # Page controller
│       ├── post_controller.lx      # Post controller
│       └── counter_live.lx         # Live module
├── priv/
│   └── static/                     # CSS, JS, images
└── test/
    └── my_blog_test.lx
```

> **Convention**: each `.lx` file in `apps/<name>/` becomes a separate Erlang module. The file name is the module name.

---

## 3. First Route: Hello World

Create the entry point in `apps/my_blog/my_blog.lx`:

```lx
require "lxweb"
require "@lx/io"
require "@lx/logger"

def main do
  logger:info("Server started at http://localhost:4500")
  config = %lxweb:ServerConfig{
    adapter: :lxweb_cowboy,
    router: :my_blog_router,
    port: 4500,
    host: "0.0.0.0"
  }
  match {:ok, _} <- lxweb:start_link(config)
  receive do :stop -> :ok end
end
```

Create the router in `apps/my_blog/my_blog_router.lx`:

```lx
require "lxweb/lxweb_router"
require "lxweb/lxweb_pipeline"

def dispatch(conn, method, path) do
  lxweb_router:dispatch(conn, method, path, get_pipelines(), get_routes())
end

def get_pipelines do
  %{
    browser: [
      {:lxweb_pipeline, :fetch_params, []},
      {:lxweb_pipeline, :put_secure_headers, []}
    ]
  }
end

def get_routes do
  [
    {:scope, "/", :browser, [
      {:get, "/", :page_controller, :index}
    ]}
  ]
end
```

Create the controller in `apps/my_blog/page_controller.lx`:

```lx
require "lxweb/lxweb_controller"

def index(conn, _params) do
  lxweb_controller:text(conn, "Hello, world!")
end
```

Compile and run:

```bash
lx compile
lx run
```

Open <http://localhost:4500> — you'll see "Hello, world!".

---

## 4. Router with Scopes and Pipelines

The router organizes routes into **scopes** (groups with a URL prefix) that pass through **pipelines** (middleware):

```lx
def get_pipelines do
  %{
    browser: [
      {:lxweb_pipeline, :fetch_params, []},
      {:lxweb_pipeline, :fetch_session, []},
      {:lxweb_pipeline, :put_secure_headers, []}
    ],
    api: [
      {:lxweb_pipeline, :accept_json, []}
    ]
  }
end

def get_routes do
  [
    {:scope, "/", :browser, [
      {:get,  "/",            :page_controller, :index},
      {:get,  "/posts/:id",   :post_controller, :show},
      {:live, "/counter",     :counter_live}
    ]},
    {:scope, "/api", :api, [
      {:get,  "/posts",       :post_controller, :list},
      {:post, "/posts",       :post_controller, :create},
      {:delete, "/posts/:id", :post_controller, :delete}
    ]}
  ]
end
```

### Built-in Pipelines

| Plug | Description |
|------|-------------|
| `{:lxweb_pipeline, :fetch_params, []}` | Ensures `conn.params` is populated |
| `{:lxweb_pipeline, :fetch_session, []}` | Loads session into `conn.assigns[:session]` |
| `{:lxweb_pipeline, :put_secure_headers, []}` | Adds security headers (X-Frame-Options, etc.) |
| `{:lxweb_pipeline, :accept_json, []}` | Sets Content-Type to application/json |
| `{:lxweb_pipeline, :logger, []}` | Logs each request |

### Route Types

| Form | Description |
|------|-------------|
| `{:get, path, controller, action}` | GET route |
| `{:post, path, controller, action}` | POST route |
| `{:put, path, controller, action}` | PUT route |
| `{:patch, path, controller, action}` | PATCH route |
| `{:delete, path, controller, action}` | DELETE route |
| `{:live, path, live_module}` | Live route (WebSocket) |
| `{:live, path, live_module, layout_module}` | Live route with custom layout |

---

## 5. Controllers: JSON, Text, Redirect

A controller is a module with functions `(conn, params) -> conn`:

```lx
require "lxweb/lxweb_controller"

# Text response
def index(conn, _params) do
  lxweb_controller:text(conn, "Welcome!")
end

# JSON response
def list(conn, _params) do
  lxweb_controller:json(conn, %{posts: [%{id: 1, title: "Hello"}, %{id: 2, title: "World"}]})
end

# Create resource (201 Created)
def create(conn, params) do
  conn
  |> lxweb_controller:put_status(201)
  |> lxweb_controller:json(%{status: "created", title: params[:title]})
end

# Redirect
def old_url(conn, _params) do
  lxweb_controller:redirect(conn, "/posts/1")
end

# Custom status response
def not_found(conn, _params) do
  lxweb_controller:send_resp(conn, 404, "Not Found")
end
```

### Controller Helpers

```lx
lxweb_controller:text(conn, "text")                          # text/plain
lxweb_controller:json(conn, %{key: "value"})                 # application/json
lxweb_controller:render(conn, view_mod, "template", assigns) # text/html via view
lxweb_controller:redirect(conn, "/url")                      # 302 redirect
lxweb_controller:send_resp(conn, status, body)               # raw response
lxweb_controller:put_status(conn, 201)                       # set status
lxweb_controller:put_resp_header(conn, "x-custom", "val")    # add header
lxweb_controller:get_param(conn, :id)                        # get param
lxweb_controller:halt(conn)                                  # halt pipeline
```

---

## 6. Path Params

Routes with `:param` extract values from the path automatically:

```lx
# Route: {:get, "/posts/:id", :post_controller, :show}
# URL:  /posts/42

def show(conn, params) do
  id = params[:id]           # "42"
  lxweb_controller:text(conn, "Post #{id}")
end
```

Path params are merged into `conn.params` along with query params and body params.

---

## 7. Views: HTML Rendering

Views are modules with a `render(template, assigns) -> string` function:

```lx
# apps/my_blog/post_view.lx

def render("post/show.html", assigns) do
  post = assigns[:post]
  "<html><body>" <>
  "<h1>#{post[:title]}</h1>" <>
  "<p>#{post[:body]}</p>" <>
  "</body></html>"
end

def render("post/index.html", assigns) do
  posts = assigns[:posts]
  items = render_items(posts)
  "<html><body><ul>#{items}</ul></body></html>"
end

defp render_items(posts) do
  # Generate <li> for each post
  lxweb_helpers:list_items(posts)
end
```

Use it in the controller:

```lx
lxweb_controller:render(conn, :post_view, "post/show.html", %{post: post})
```

---

## 8. Live: Real-Time with WebSockets

Live is lxweb's reactive component system. The server holds state and pushes HTML patches to the client over WebSocket when the state changes.

Create a Live module in `apps/my_blog/counter_live.lx`:

```lx
require "lxweb/lxweb_live"

# Called when the user connects (mount)
def mount(_params, _session, socket) do
  {:ok, lxweb_live:assign(socket, %{count: 0})}
end

# Called when an lx-click/lx-change event arrives from the client
def handle_event("inc", _params, socket) do
  count = socket.assigns[:count]
  {:noreply, lxweb_live:assign(socket, %{count: count + 1})}
end

def handle_event("dec", _params, socket) do
  count = socket.assigns[:count]
  {:noreply, lxweb_live:assign(socket, %{count: count - 1})}
end

# Render the component's current HTML
def render(assigns) do
  "<div data-lx-topic=\"lv:counter\">" <>
  "<h2>Count: #{assigns[:count]}</h2>" <>
  "<button lx-click=\"inc\">+1</button>" <>
  "<button lx-click=\"dec\">-1</button>" <>
  "</div>"
end

# Optional: lifecycle hooks
def handle_cast(_msg, socket) do
  {:noreply, socket}
end

def handle_info(_msg, socket) do
  {:noreply, socket}
end

def terminate(_reason, _socket) do
  :ok
end
```

Register the Live route:

```lx
# In the router:
{:live, "/counter", :counter_live}
```

Open <http://localhost:4500/counter>. The HTML is rendered server-side on the first access (mount), and subsequent updates are pushed via WebSocket and applied with morphdom.

### How It Works

1. **First access (GET)**: `lxweb_live_controller` calls `mount/3` + `render/1`, delivers full HTML
2. **WebSocket connection**: the client (`lxweb.js`) connects and sends `lv:join`
3. **Interaction**: buttons with `lx-click="inc"` send `lv:event` over WS
4. **Patch**: server calls `handle_event/3` + `render/1`, sends `lv:diff` with the new HTML
5. **Client**: morphdom applies the diff surgically to the DOM

### Client Bindings

| Attribute | Description |
|-----------|-------------|
| `lx-click="event_name"` | Fires `handle_event` on click |
| `lx-change="event_name"` | Fires on input change |
| `lx-submit="event_name"` | Fires on form submit |
| `data-lx-topic="lv:name"` | Identifies the Live component root element |

### Live Helpers

```lx
lxweb_live:assign(socket, %{key: value})        # update assigns
lxweb_live:push_event(socket, "scroll", %{})     # push JS event to client
lxweb_live:redirect(socket, "/new-url")          # navigate client
lxweb_live:put_flash(socket, :info, "Saved!")    # flash message
```

---

## 9. Custom Layouts for Live

By default, Live routes use a built-in layout that includes `morphdom.min.js` and `lxweb.js`. To customize, pass a layout module as the 4th element of the route:

```lx
# In the router:
{:live, "/counter", :counter_live, :my_blog_layout}
```

The layout module receives `(inner_html, ws_url)`:

```lx
# apps/my_blog/my_blog_layout.lx

def render(inner_html, ws_url) do
  "<!DOCTYPE html>" <>
  "<html><head>" <>
  "<meta charset=\"UTF-8\">" <>
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" <>
  "<meta name=\"lxweb-ws-url\" content=\"#{ws_url}\">" <>
  "<script src=\"/lxweb/morphdom.min.js\"></script>" <>
  "<link rel=\"stylesheet\" href=\"/static/app.css\">" <>
  "</head><body>" <>
  "<nav>My Blog</nav>" <>
  inner_html <>
  "<script src=\"/lxweb/lxweb.js\"></script>" <>
  "</body></html>"
end
```

---

## 10. Serving Static Assets

lxweb automatically serves files from `priv/static/` under the `/static/` prefix (configurable via `ServerConfig.static_url_prefix`).

```
priv/
└── static/
    ├── app.css
    ├── app.js
    └── images/
        └── logo.png
```

Reference them in templates:

```html
<link rel="stylesheet" href="/static/app.css">
<img src="/static/images/logo.png">
```

The Live client JS is served automatically at `/lxweb/lxweb.js` and `/lxweb/morphdom.min.js`.

---

## 11. E2E Testing

The `lxweb_request` module simulates end-to-end HTTP requests, traversing the same path as the Cowboy handler in production (minus the TCP layer).

```lx
require "lxweb/lxweb_request"
require "lxweb/lxweb_conn"

describe "page routes" do
  test "GET / returns text body" do
    conn = lxweb_conn:test(:my_blog_router)
    result = lxweb_request:get(conn, "/")
    assert result.status == 200
    assert result.body == "Hello, world!"
  end

  test "GET /posts/:id extracts path params" do
    conn = lxweb_conn:test(:my_blog_router)
    result = lxweb_request:get(conn, "/posts/42")
    assert result.body == "Post 42"
  end

  test "POST /api/posts returns 201" do
    conn = lxweb_conn:test(:my_blog_router)
    result = lxweb_request:post(conn, "/api/posts", %{title: "Hello"})
    assert result.status == 201
    assert lxweb_request:response_header(result, "content-type") == "application/json"
  end

  test "browser pipeline adds secure headers" do
    conn = lxweb_conn:test(:my_blog_router)
    result = lxweb_request:get(conn, "/")
    assert lxweb_request:response_header(result, "x-frame-options") == "SAMEORIGIN"
  end
end
```

Run tests:

```bash
lx test
```

---

## 12. Running the Server

### Development

```bash
lx compile      # compile the project
lx run          # start the server on the ServerConfig port
```

### ServerConfig Options

```lx
config = %lxweb:ServerConfig{
  adapter: :lxweb_cowboy,        # adapter (default: lxweb_cowboy)
  router: :my_blog_router,       # router module
  port: 4500,                    # HTTP port
  host: "0.0.0.0",               # bind address
  static_url_prefix: "/static",  # static assets prefix
  pool_size: 100,                # acceptor pool size
  timeout: 30000                 # timeout in ms
}
```

### Stopping the Server

The server runs until it receives the `:stop` message:

```lx
receive do :stop -> :ok end
```

---

## 13. Quick Reference

### Conn Structure

```lx
%Conn{
  method: :get,              # HTTP method as atom
  path: "/posts/42",         # request path
  params: %{id: "42"},       # path + query + body params
  req_headers: [],           # request headers
  resp_headers: [],          # response headers
  status: 200,               # status code
  body: "",                  # response body
  assigns: %{},              # controller data
  halted: false,             # halts pipeline
  private: %{},              # internal data
  websocket: false           # WebSocket flag
}
```

### Request Lifecycle

```
HTTP Request
  → lxweb_cowboy_handler (adapter)
  → lxweb_conn:new/4 (creates Conn)
  → router:dispatch/3
    → lxweb_pipeline:run/2 (runs plugs)
    → lxweb_router:find_scope (finds scope)
    → lxweb_router:find_route (route match + path params)
    → controller:action(conn, params)  (or lxweb_live_controller:show)
  → reply (status + headers + body)
```

### Core Modules

| Module | Responsibility |
|--------|---------------|
| `lxweb` | ServerConfig, start_link/stop |
| `lxweb_conn` | Conn struct, headers, status, assigns |
| `lxweb_router` | dispatch, route matching, path params |
| `lxweb_pipeline` | run + built-in plugs |
| `lxweb_controller` | json, text, render, redirect, send_resp |
| `lxweb_view` | render/3 |
| `lxweb_live` | Live gen_server, assign, push_event |
| `lxweb_live_controller` | mount → render → HTML (first access) |
| `lxweb_live_socket` | cowboy_websocket (LxVM WS protocol) |
| `lxweb_request` | E2E test client |
| `lxweb_error` | error page with stacktrace |
