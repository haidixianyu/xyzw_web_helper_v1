/**
 * account-switcher.js — game2 上号器(账号切换面板)
 *
 * 面板样式与交互对齐 v1 上号器(sh1.readable.js): 图标、可拖动、弹框、可收起。
 * 数据来源与 v1 相同, 读 localStorage 里的 bin_file_list / bin_data_<id> / current_bin_id
 * (由助手 token 页写入, 均已 convertBinToLx 成 lx 格式 hex)。
 *
 * 切换原理: 更新 current_bin_id + URL ?bin= 后整页 reload, bridge-shim.resolveBinHex()
 * 读到新账号 bin 并重走登录链(含防串号 lockServerId)。显式写 ?bin= 是因为 urlBinId
 * 优先级高于 current_bin_id, 只改 current_bin_id 而 URL 仍带旧参数会切不动。
 *
 * 批量模式(每个 iframe 固定一个账号)下不启用。
 */
(function () {
  "use strict";
  if (window.__MULTI_GAME_BRIDGE_READY__) return;

  // ==================== 工具 ====================

  function loadBinFileList() {
    try {
      var list = JSON.parse(window.localStorage.getItem("bin_file_list") || "[]");
      list = list || [];
      list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return list;
    } catch (e) { return []; }
  }

  function saveBinFileList(list) {
    try { window.localStorage.setItem("bin_file_list", JSON.stringify(list)); } catch (e) {}
  }

  function getCurrentBinId() {
    try {
      return new URLSearchParams(window.location.search).get("bin") ||
        window.localStorage.getItem("current_bin_id") || "";
    } catch (e) { return ""; }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showToast(msg, type) {
    var toast = document.getElementById("binToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "binToast";
      toast.style.cssText =
        "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:1000000;" +
        "background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:8px;" +
        "font:13px/1.6 sans-serif;pointer-events:none;transition:opacity .3s;";
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    if (type === "error") toast.style.background = "rgba(200,40,40,.85)";
    else if (type === "success") toast.style.background = "rgba(40,160,60,.85)";
    else toast.style.background = "rgba(0,0,0,.8)";
    clearTimeout(toast.__t);
    toast.__t = setTimeout(function () { toast.style.opacity = "0"; }, 2200);
  }

  // ==================== 核心切换 ====================

  function switchTo(id) {
    if (!id) return;
    try { window.localStorage.setItem("current_bin_id", id); } catch (e) {}
    try {
      var url = new URL(window.location.href);
      url.searchParams.set("bin", id);
      window.location.href = url.toString();
    } catch (e) {
      window.location.reload();
    }
  }

  function removeBinFile(id) {
    try { window.localStorage.removeItem("bin_data_" + id); } catch (e) {}
    var list = loadBinFileList().filter(function (item) { return item.id !== id; });
    saveBinFileList(list);
    if (getCurrentBinId() === id) {
      try { window.localStorage.removeItem("current_bin_id"); } catch (e) {}
    }
  }

  function renameBinFile(id, newName) {
    var list = loadBinFileList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i].name = newName; break; }
    }
    saveBinFileList(list);
  }

  // ==================== 拖拽(对齐 v1, 记忆位置) ====================

  function setupDrag(element) {
    var DRAG_THRESHOLD = 5; // 位移超过 5px 才算拖动, 以区分点击(展开/按钮)与拖拽
    var isDragging = false;
    var startX = -1, startY = -1, startLeft, startTop;

    try {
      var pos = JSON.parse(window.localStorage.getItem("bin_tool_position"));
      if (pos && pos.left !== undefined && pos.top !== undefined) {
        element.style.left = pos.left + "px";
        element.style.top = pos.top + "px";
      }
    } catch (e) {}

    function savePosition() {
      var rect = element.getBoundingClientRect();
      try {
        window.localStorage.setItem("bin_tool_position", JSON.stringify({ left: rect.left, top: rect.top }));
      } catch (e) {}
    }

    function clampLeft(left) {
      return Math.max(0, Math.min(window.innerWidth - element.offsetWidth, left));
    }
    function clampTop(top) {
      return Math.max(0, Math.min(window.innerHeight - element.offsetHeight, top));
    }

    function beginDrag(clientX, clientY) {
      startX = clientX; startY = clientY;
      var rect = element.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
    }

    function canStartDrag(target) {
      if (!target) return false;
      // 收起态: 整个圆形图标都可拖动
      if (element.classList.contains("minimized")) return true;
      // 展开态: 仅标题栏可拖动
      return !!target.closest(".title");
    }

    function moveTo(clientX, clientY) {
      if (startX < 0) return;
      if (!isDragging) {
        if (Math.abs(clientX - startX) < DRAG_THRESHOLD && Math.abs(clientY - startY) < DRAG_THRESHOLD) return;
        isDragging = true;
        element._justDragged = true;
        // 拖动时去掉 transition, 避免 left/top 变更带 0.2s 过渡造成拖拽滞后
        element.style.transition = "none";
      }
      element.style.left = clampLeft(startLeft + clientX - startX) + "px";
      element.style.top = clampTop(startTop + clientY - startY) + "px";
    }

    function endDrag() {
      startX = -1; startY = -1;
      if (isDragging) {
        isDragging = false;
        element.style.transition = "";
        savePosition();
      }
    }

    element.addEventListener("mousedown", function (e) {
      if (e.target.closest("button")) return;   // 按钮(切换/重命名/删除/刷新/收起)不拖
      if (!canStartDrag(e.target)) return;       // 展开态仅标题栏; 点击列表不再误触拖拽
      beginDrag(e.clientX, e.clientY);
    });

    document.addEventListener("mousemove", function (e) {
      moveTo(e.clientX, e.clientY);
      if (isDragging) e.preventDefault();
    });

    document.addEventListener("mouseup", function () { endDrag(); });

    element.addEventListener("touchstart", function (e) {
      if (e.target.closest("button")) return;
      if (!canStartDrag(e.target)) return;
      if (e.touches.length === 1) beginDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (e.touches.length !== 1) return;
      moveTo(e.touches[0].clientX, e.touches[0].clientY);
      if (isDragging && e.cancelable) e.preventDefault(); // 拖动中阻止页面滚动
    }, { passive: false });

    document.addEventListener("touchend", function () { endDrag(); });
  }

  // ==================== 面板(样式对齐 v1 上号器) ====================

  function createPanel() {
    var style = document.createElement("style");
    style.type = "text/css";
    style.textContent = [
      "#binTool{position:fixed;left:20px;top:20px;z-index:999999;",
      "background:#fff;color:#333;padding:12px;border-radius:12px;",
      "box-shadow:0 0 12px rgba(0,0,0,0.12);width:320px;max-height:80vh;",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;",
      "border:1px solid #e8e8e8;transition:all 0.2s ease;box-sizing:border-box;",
      "user-select:none;touch-action:none;overflow:hidden;",
      "display:flex;flex-direction:column;}",
      "#binTool.minimized{width:36px!important;height:36px!important;padding:0!important;",
      "border-radius:50%!important;opacity:0.9!important;cursor:pointer;overflow:hidden!important;background:#fff;}",
      "#binTool.minimized .title,#binTool.minimized .content,#binTool.minimized .author-info{display:none!important;}",
      "#binTool.minimized::after{content:'\ud83d\udce6';font-size:16px;line-height:36px;display:block;",
      "text-align:center;width:100%;height:100%;}",
      "#binTool .title{font-size:15px;font-weight:bold;margin-bottom:10px;display:flex;",
      "justify-content:space-between;align-items:center;padding-bottom:6px;",
      "border-bottom:1px solid #f0f0f0;cursor:move;}",
      "#binTool .content{overflow-y:auto;flex:1;}",
      ".binItem{padding:8px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;",
      "display:flex;justify-content:space-between;align-items:center;",
      "font-size:12px;transition:background 0.15s;gap:6px;}",
      ".binItem:hover{background:#f5f5f5;}",
      ".binItem.active{background:#e6f7ff;border-left:3px solid #4a90d9;}",
      ".binItemName{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".binItemInfo{color:#999;font-size:11px;margin-left:6px;white-space:nowrap;}",
      ".binItemToggle,.binItemEdit,.binItemDelete{width:22px;height:22px;border-radius:3px;",
      "border:none;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;",
      "cursor:pointer;margin-left:3px;}",
      ".binItemToggle{background:#4a90d9;}",
      ".binItemEdit{background:#52c41a;}",
      ".binItemDelete{background:#ff4d4f;}",
      "#binTool button{background:#4a90d9;color:#fff;border:none;padding:7px 12px;",
      "border-radius:6px;cursor:pointer;margin-right:6px;font-size:13px;}",
      "#binTool #clearBtn{background:#ff6b6b;}",
      "#binStatus{margin-top:10px;font-size:12px;color:#666;}",
      "#binStatus.success{color:#52c41a;}",
      "#binStatus.error{color:#ff4d4f;}",
      "#currentLoginInfo{margin-top:10px;padding:8px;background:#fafafa;",
      "border:1px solid #e8e8e8;border-radius:6px;font-size:12px;}",
      "#currentLoginInfo.empty{color:#bbb;text-align:center;}",
      ".author-info{font-size:11px;color:#999;text-align:center;",
      "margin-top:8px;padding-top:6px;border-top:1px solid #f0f0f0;}",
      "#refreshBtn,#minimizeBtn{background:#f5f5f5;border:1px solid #e0e0e0;color:#666;",
      "width:26px;height:26px;border-radius:4px;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;font-size:16px;}"
    ].join("");
    document.head.appendChild(style);

    var panel = document.createElement("div");
    panel.id = "binTool";
    panel.innerHTML =
      '<div class="title"><span>\ud83d\udce6 上号器</span>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
      '<button id="refreshBtn" title="刷新网页">\u21bb</button>' +
      '<button id="minimizeBtn" title="收起">\u2227</button></div></div>' +
      '<div class="content">' +
      '<button id="clearBtn">清空 BIN</button>' +
      '<div id="currentLoginInfo" class="empty">未选择登录BIN</div>' +
      '<div id="binList"></div>' +
      '<div id="binStatus">未加载 BIN 文件</div>' +
      '</div>' +
      '<div class="author-info">免费脚本禁止售卖</div>';
    document.documentElement.appendChild(panel);

    var binListEl = document.getElementById("binList");
    var binStatusEl = document.getElementById("binStatus");
    var currentLoginInfoEl = document.getElementById("currentLoginInfo");
    var clearBtn = document.getElementById("clearBtn");
    var refreshBtn = document.getElementById("refreshBtn");
    var minimizeBtn = document.getElementById("minimizeBtn");

    function renderBinList() {
      var list = loadBinFileList();
      var currentId = getCurrentBinId();

      if (list.length === 0) {
        binListEl.innerHTML = "";
        binListEl.style.display = "none";
        currentLoginInfoEl.className = "empty";
        currentLoginInfoEl.innerHTML = "未选择登录BIN";
        binStatusEl.textContent = "未加载 BIN 文件";
        binStatusEl.className = "";
        return;
      }

      binListEl.style.display = "block";
      binListEl.innerHTML = "";

      list.forEach(function (item) {
        var id = String(item.id || "");
        var isActive = id === currentId;
        var el = document.createElement("div");
        el.className = "binItem" + (isActive ? " active" : "");
        el.innerHTML =
          '<div class="binItemName">' + escapeHtml(item.name) + "</div>" +
          '<div class="binItemInfo">' + (item.size || formatSize(item.byteLength || 0)) + "</div>" +
          '<button class="binItemToggle" data-id="' + id + '" title="切换登录">\u27f3</button>' +
          '<button class="binItemEdit" data-id="' + id + '" title="重命名">\u270e</button>' +
          '<button class="binItemDelete" data-id="' + id + '" title="删除">\u00d7</button>';

        el.querySelector(".binItemToggle").onclick = function (e) {
          e.stopPropagation();
          switchTo(id);
        };
        el.querySelector(".binItemEdit").onclick = function (e) {
          e.stopPropagation();
          var newName = prompt("重命名 BIN", item.name);
          if (newName && newName.trim()) {
            renameBinFile(id, newName.trim());
            showToast("已重命名: " + newName.trim(), "success");
            renderBinList();
          }
        };
        el.querySelector(".binItemDelete").onclick = function (e) {
          e.stopPropagation();
          if (confirm("确定删除「" + item.name + "」吗？")) {
            removeBinFile(id);
            showToast("已清除 BIN", "success");
            renderBinList();
          }
        };

        binListEl.appendChild(el);
      });

      if (currentId) {
        var current = list.find(function (i) { return i.id === currentId; });
        if (current) {
          currentLoginInfoEl.className = "";
          currentLoginInfoEl.innerHTML =
            '<div class="label">\ud83d\udcbf 当前登录BIN:</div>' +
            '<div class="binName">' + escapeHtml(current.name) + "</div>";
        } else {
          currentLoginInfoEl.className = "empty";
          currentLoginInfoEl.innerHTML = "未选择登录BIN";
        }
      } else {
        currentLoginInfoEl.className = "empty";
        currentLoginInfoEl.innerHTML = "未选择登录BIN";
      }

      binStatusEl.textContent = "共 " + list.length + " 个账号";
      binStatusEl.className = "success";
    }

    clearBtn.onclick = function () {
      if (!confirm("确定清空所有BIN吗？")) return;
      var list = loadBinFileList();
      list.forEach(function (item) {
        try { window.localStorage.removeItem("bin_data_" + item.id); } catch (e) {}
      });
      try {
        window.localStorage.removeItem("bin_file_list");
        window.localStorage.removeItem("current_bin_id");
      } catch (e) {}
      showToast("已清空", "success");
      renderBinList();
    };

    refreshBtn.onclick = function () { window.location.reload(); };

    minimizeBtn.onclick = function (e) {
      e.stopPropagation();
      panel.classList.add("minimized");
    };

    // 收起后: 点击圆形图标即展开(此时 .title/.content 已 display:none, 只能靠 panel 自身点击)
    panel.addEventListener("click", function () {
      if (panel._justDragged) { panel._justDragged = false; return; } // 刚拖动过, 不误判为点击展开
      if (panel.classList.contains("minimized")) {
        panel.classList.remove("minimized");
      }
    });

    setupDrag(panel);
    renderBinList();

    // 进游戏默认收起, 只留一个小图标, 避免遮挡游戏画面
    panel.classList.add("minimized");
  }

  function boot() {
    try { createPanel(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();