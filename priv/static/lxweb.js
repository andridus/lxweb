/**
 * lxweb.js — LxVM WebSocket client (~3KB)
 *
 * Connects to the lxweb Live server over WebSocket using the LxVM protocol.
 * Applies server-pushed HTML patches using morphdom.
 *
 * Served by lxweb_cowboy at /lxweb/lxweb.js
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    var morphdom = require('./morphdom.min.js');
    module.exports = factory(morphdom);
  } else {
    root.LxWeb = factory(root.morphdom);
  }
}(typeof self !== 'undefined' ? self : this, function (morphdom) {
  'use strict';

  var socket = null;
  var channels = {};   // topic -> { rootEl, ref, pending }
  var refCounter = 0;
  var wsUrl = null;
  var reconnectDelay = 1000;
  var heartbeatInterval = null;

  function nextRef() {
    refCounter += 1;
    return String(refCounter);
  }

  function send(topic, event, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    var ref = nextRef();
    var frame = JSON.stringify([ref, topic, event, payload]);
    socket.send(frame);
    return ref;
  }

  function connect(url) {
    wsUrl = url || '/lv/ws';
    socket = new WebSocket(wsUrl);

    socket.onopen = function () {
      reconnectDelay = 1000;
      // Rejoin all registered channels
      Object.keys(channels).forEach(function (topic) {
        joinChannel(topic);
      });
      // Start heartbeat
      heartbeatInterval = setInterval(function () {
        send('lv:heartbeat', 'lv:heartbeat', {});
      }, 30000);
    };

    socket.onmessage = function (e) {
      var frame;
      try { frame = JSON.parse(e.data); } catch (_) { return; }
      var ref = frame[0], topic = frame[1], event = frame[2], payload = frame[3];
      var ch = channels[topic];

      if (event === 'lv:joined') {
        if (ch) {
          ch.rootEl.innerHTML = payload.rendered;
          ch.dynNodes = collectDynNodes(ch.rootEl);
        }
      } else if (event === 'lv:diff') {
        if (ch) {
          if (payload.diff) {
            // Indexed patch: set textContent on each changed dynamic node.
            var dyn = ch.dynNodes;
            if (dyn) {
              Object.keys(payload.diff).forEach(function (k) {
                var el = dyn[k];
                if (el) el.textContent = payload.diff[k];
              });
            }
          } else {
            // Full HTML (legacy or attribute-change fallback) -> morphdom.
            var tmp = document.createElement('div');
            tmp.innerHTML = payload.html;
            if (tmp.firstChild && ch.rootEl.firstChild) {
              morphdom(ch.rootEl.firstChild, tmp.firstChild, {
                onBeforeElUpdated: function (from, to) {
                  return !from.hasAttribute('data-lx-static');
                }
              });
            } else {
              ch.rootEl.innerHTML = payload.html;
            }
            ch.dynNodes = collectDynNodes(ch.rootEl);
          }
        }
      } else if (event === 'lv:redirect') {
        window.location.href = payload.url;
      } else if (event === 'lv:push_event') {
        window.dispatchEvent(new CustomEvent(payload.name, { detail: payload.payload }));
      } else if (event === 'lv:flash') {
        window.dispatchEvent(new CustomEvent('lxweb:flash', { detail: { key: payload.key, msg: payload.msg } }));
      } else if (event === 'lv:data') {
        window.dispatchEvent(new CustomEvent('lxweb:data', { detail: { key: payload.key, data: payload.data } }));
      } else if (event === 'lv:error') {
        console.error('[lxweb] server error:', payload.reason);
        scheduleReconnect();
      } else if (event === 'lv:pong') {
        // keep-alive acknowledged
      }

      void ref; // silence unused variable
    };

    socket.onclose = function () {
      clearInterval(heartbeatInterval);
      scheduleReconnect();
    };

    socket.onerror = function (err) {
      console.error('[lxweb] WebSocket error', err);
    };
  }

  function scheduleReconnect() {
    setTimeout(function () {
      connect(wsUrl);
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function joinChannel(topic) {
    var params = {};
    try {
      new URLSearchParams(window.location.search).forEach(function (v, k) {
        params[k] = v;
      });
    } catch (_) {}
    send(topic, 'lv:join', { params: params, session: getSession() });
  }

  function getSession() {
    // reads meta[name="lxweb-session"] content if present
    var meta = document.querySelector('meta[name="lxweb-session"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Build a {index: element} map from all <span data-lx-dyn="N"> markers
  // inside a root element. Enables indexed textContent patching.
  function collectDynNodes(rootEl) {
    var nodes = {};
    var els = rootEl.querySelectorAll('[data-lx-dyn]');
    els.forEach(function (el) {
      nodes[el.getAttribute('data-lx-dyn')] = el;
    });
    return nodes;
  }

  // Apply an indexed diff: set textContent on each referenced dyn node.
  function applyIndexedDiff(ch, diff) {
    if (!ch.dynNodes) return;
    Object.keys(diff).forEach(function (k) {
      var el = ch.dynNodes[k];
      if (el) el.textContent = diff[k];
    });
  }

  // Build a map of data-lx-dyn index -> element, for indexed patching.
  function collectDynNodes(root) {
    var nodes = {};
    if (!root || !root.querySelectorAll) return nodes;
    var els = root.querySelectorAll('[data-lx-dyn]');
    els.forEach(function (el) {
      nodes[el.getAttribute('data-lx-dyn')] = el;
    });
    return nodes;
  }

  // Auto-mount: find all elements with data-lx-topic and register them
  function mount() {
    var wsMeta = document.querySelector('meta[name="lxweb-ws-url"]');
    var url = wsMeta ? wsMeta.getAttribute('content') : '/lv/ws';
    var els = document.querySelectorAll('[data-lx-topic]');
    els.forEach(function (el) {
      var topic = el.getAttribute('data-lx-topic');
      channels[topic] = { rootEl: el, ref: null };
    });
    connect(url);
  }

  // Event delegation — lx-click
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest('[lx-click]');
    if (!el) return;
    var topicEl = el.closest('[data-lx-topic]');
    if (!topicEl) return;
    var topic = topicEl.getAttribute('data-lx-topic');
    send(topic, 'lv:event', {
      type: 'click',
      name: el.getAttribute('lx-click'),
      value: {}
    });
  });

  // Event delegation — lx-change (input/select)
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute('lx-change')) return;
    var topicEl = el.closest('[data-lx-topic]');
    if (!topicEl) return;
    var topic = topicEl.getAttribute('data-lx-topic');
    send(topic, 'lv:event', {
      type: 'change',
      name: el.getAttribute('lx-change'),
      value: { value: el.value }
    });
  });

  // Event delegation — lx-submit
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.hasAttribute('lx-submit')) return;
    e.preventDefault();
    var topicEl = form.closest('[data-lx-topic]');
    if (!topicEl) return;
    var topic = topicEl.getAttribute('data-lx-topic');
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    send(topic, 'lv:event', {
      type: 'submit',
      name: form.getAttribute('lx-submit'),
      value: data
    });
  });

  // Auto-mount on DOMContentLoaded if data-lx-topic elements are present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  return {
    connect: connect,
    send: send,
    channels: channels
  };
}));
