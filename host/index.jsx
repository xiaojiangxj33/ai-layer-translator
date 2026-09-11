// host/index.jsx — ES3, 无 JSON 依赖

function _esc(s) {
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var code = s.charCodeAt(i);
        if (c === '"') out += '\\"';
        else if (c === '\\') out += '\\\\';
        else if (c === '\n') out += '\\n';
        else if (c === '\r') out += '\\r';
        else if (c === '\t') out += '\\t';
        else if (code < 0x20) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
        else out += c;
    }
    return out;
}

function _cleanFileName(str) {
    return String(str).replace(/[\\\/:*?"<>|]/g, "_");
}

function _padZero(num, len) {
    var s = num.toString();
    while (s.length < len) s = "0" + s;
    return s;
}

function _hasChinese(s) {
    if (!s) return false;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0x4e00 && c <= 0x9fff) return true;
        if (c >= 0x3400 && c <= 0x4dbf) return true;
    }
    return false;
}

var _allNames = [];
var _hits = [];

function _walk(layers) {
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        _allNames.push(L.name);
        if (_hasChinese(L.name)) {
            _hits.push({ id: L.id, name: L.name });
        }
        if (L.typename === 'LayerSet') {
            _walk(L.layers);
        }
    }
}

function getChineseLayers() {
    try {
        if (app.documents.length === 0) {
            return '{"error":"未打开任何文档"}';
        }
        _allNames = [];
        _hits = [];
        var doc = app.activeDocument;
        _walk(doc.layers);

        var s = '{"layers":[';
        for (var i = 0; i < _hits.length; i++) {
            if (i > 0) s += ',';
            s += '{"id":' + _hits[i].id + ',"name":"' + _esc(_hits[i].name) + '"}';
        }
        s += '],"allNames":[';
        for (var j = 0; j < _allNames.length; j++) {
            if (j > 0) s += ',';
            s += '"' + _esc(_allNames[j]) + '"';
        }
        s += ']}';
        return s;
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    }
}

function _findLayerById(layers, id) {
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        if (L.id === id) return L;
        if (L.typename === 'LayerSet') {
            var r = _findLayerById(L.layers, id);
            if (r) return r;
        }
    }
    return null;
}

// payload 是 JSON 字符串，形如 [{"id":123,"name":"new_name"}, ...]
// 为了不依赖 JSON.parse，这里用 eval（ExtendScript 里安全可用）
function batchRename(payloadStr) {
    try {
        if (app.documents.length === 0) return '{"error":"未打开任何文档"}';
        var arr = eval('(' + payloadStr + ')');
        var doc = app.activeDocument;
        var ok = 0, fail = 0;
        for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            var L = _findLayerById(doc.layers, item.id);
            if (L) { L.name = item.name; ok++; }
            else { fail++; }
        }
        return '{"ok":' + ok + ',"fail":' + fail + '}';
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    }
}

// 递归收集某个图层/图层组下的所有普通图层（ArtLayer）
function _collectArtLayers(layer, out) {
    if (layer.typename === 'LayerSet') {
        for (var i = 0; i < layer.layers.length; i++) {
            _collectArtLayers(layer.layers[i], out);
        }
    } else {
        out.push(layer);
    }
}

// ===== 检查重名和中文（命中图层标红）=====
function checkLayers() {
    var prevDisplay = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    try {
        if (app.documents.length === 0) return '{"error":"未打开任何文档"}';
        var doc = app.activeDocument;
        var allLayers = [];
        function collectLayers(container) {
            for (var i = 0; i < container.layers.length; i++) {
                var layer = container.layers[i];
                allLayers.push(layer);
                if (layer.typename === "LayerSet") collectLayers(layer);
            }
        }
        collectLayers(doc);

        var chineseReg = /[\u4e00-\u9fff\u3400-\u4dbf]/;
        var nameCount = {};
        for (var j = 0; j < allLayers.length; j++) {
            var n = allLayers[j].name;
            nameCount[n] = (nameCount[n] || 0) + 1;
        }

        // 用图层 ID 直接引用，不切换 activeLayer，更稳定
        function setLayerColorRed(layer) {
            var idsetd = charIDToTypeID("setd");
            var desc = new ActionDescriptor();
            var idnull = charIDToTypeID("null");
            var ref = new ActionReference();
            ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
            desc.putReference(idnull, ref);
            var idT = charIDToTypeID("T   ");
            var layerDesc = new ActionDescriptor();
            var idClr = charIDToTypeID("Clr ");
            layerDesc.putEnumerated(idClr, charIDToTypeID("Clr "), charIDToTypeID("Rd  "));
            desc.putObject(idT, charIDToTypeID("Lyr "), layerDesc);
            executeAction(idsetd, desc, DialogModes.NO);
        }

        var hitCount = 0, chineseHits = 0, duplicateHits = 0;
        for (var k = 0; k < allLayers.length; k++) {
            var lyr = allLayers[k];
            var hasChinese = chineseReg.test(lyr.name);
            var isDuplicate = nameCount[lyr.name] > 1;
            if (hasChinese || isDuplicate) {
                try { setLayerColorRed(lyr); hitCount++; } catch (e) {}
                if (hasChinese) chineseHits++;
                if (isDuplicate) duplicateHits++;
            }
        }
        return '{"total":' + allLayers.length + ',"hit":' + hitCount + ',"chinese":' + chineseHits + ',"duplicate":' + duplicateHits + '}';
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    } finally {
        app.displayDialogs = prevDisplay;
    }
}

// ===== 获取选中的多个图层（兼容 CC 2019 多选）=====
function getSelectedLayers() {
    var selLayers = [];
    try {
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);
        if (desc.hasKey(stringIDToTypeID("targetLayers"))) {
            var targetLayers = desc.getList(stringIDToTypeID("targetLayers"));
            for (var i = 0; i < targetLayers.count; i++) {
                try {
                    var idx = targetLayers.getReference(i).getIndex();
                    var lyr = app.activeDocument.layers[idx];
                    if (lyr) selLayers.push(lyr);
                } catch (e) {}
            }
        }
        if (selLayers.length === 0) {
            selLayers.push(app.activeDocument.activeLayer);
        }
    } catch (e) {
        try { selLayers.push(app.activeDocument.activeLayer); } catch (e2) {}
    }
    return selLayers;
}

// ===== 批量重命名选中图层（顺序命名 / 添加前缀 / 文件夹内图层重命名）=====
function batchRenameSelected(payloadStr) {
    var prevDisplay = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    try {
        if (app.documents.length === 0) return '{"error":"未打开任何文档"}';
        var opts = eval('(' + payloadStr + ')');
        var selLayers = getSelectedLayers();
        if (!selLayers || selLayers.length === 0) return '{"error":"请先在图层面板中选择至少一个图层"}';

        var ok = 0, fail = 0, lastErr = "";

        // ===== 文件夹内图层重命名：选中图层组，其内部所有图层重命名为文件夹名（不加后缀）=====
        if (opts.mode === "folder") {
            var folders = [];
            for (var f = 0; f < selLayers.length; f++) {
                if (selLayers[f].typename === 'LayerSet') folders.push(selLayers[f]);
            }
            if (folders.length === 0) return '{"error":"请先在图层面板中选择至少一个图层组（文件夹）"}';

            for (var fi = 0; fi < folders.length; fi++) {
                var folderName = folders[fi].name;
                var inner = [];
                _collectArtLayers(folders[fi], inner);
                for (var ii = 0; ii < inner.length; ii++) {
                    var wasLocked = false;
                    try { wasLocked = inner[ii].allLocked; } catch (e) {}
                    try { inner[ii].allLocked = true; } catch (e) {}
                    try {
                        inner[ii].name = folderName;
                        ok++;
                    } catch (e) {
                        fail++;
                        lastErr = e.message || String(e);
                    }
                    try { inner[ii].allLocked = wasLocked; } catch (e) {}
                }
            }

            if (ok === 0 && fail > 0) {
                return '{"error":"重命名失败: ' + _esc(lastErr) + '","ok":0,"fail":' + fail + '}';
            }
            return '{"ok":' + ok + ',"fail":' + fail + '}';
        }

        // ===== 顺序命名 / 添加前缀（作用于选中图层）=====
        var layerData = [];
        for (var i = 0; i < selLayers.length; i++) {
            var wasLocked = false;
            try { wasLocked = selLayers[i].allLocked; } catch (e) {}
            layerData.push({
                layer: selLayers[i],
                oldName: selLayers[i].name,
                wasLocked: wasLocked
            });
            // 锁定改为尽力而为，不阻断流程
            try { selLayers[i].allLocked = true; } catch (e) {}
        }

        try {
            if (opts.mode === "seq") {
                var baseName = opts.baseName || "Layer_";
                var startNum = parseInt(opts.startNum);
                if (isNaN(startNum) || startNum < 0) startNum = 1;
                for (var j = 0; j < layerData.length; j++) {
                    try {
                        layerData[j].layer.name = baseName + startNum;
                        startNum++;
                        ok++;
                    } catch (e) {
                        fail++;
                        lastErr = e.message || String(e);
                    }
                }
            } else {
                var prefix = opts.prefix || "";
                for (var k = 0; k < layerData.length; k++) {
                    try {
                        layerData[k].layer.name = prefix + layerData[k].oldName;
                        ok++;
                    } catch (e) {
                        fail++;
                        lastErr = e.message || String(e);
                    }
                }
            }
        } finally {
            // 恢复锁定状态，尽力而为
            for (var m = 0; m < layerData.length; m++) {
                try { layerData[m].layer.allLocked = layerData[m].wasLocked; } catch (e) {}
            }
        }

        if (ok === 0 && fail > 0) {
            return '{"error":"重命名失败: ' + _esc(lastErr) + '","ok":0,"fail":' + fail + '}';
        }
        return '{"ok":' + ok + ',"fail":' + fail + '}';
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    } finally {
        app.displayDialogs = prevDisplay;
    }
}

// ===== 智能化选中图层（每个图层各自成为独立智能对象）=====
function smartObjectSelectedLayers() {
    var prevDisplay = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    try {
        if (app.documents.length === 0) return '{"error":"未打开任何文档"}';
        var selLayers = getSelectedLayers();
        if (!selLayers || selLayers.length === 0) return '{"error":"请先在图层面板中选择至少一个图层"}';

        // 递归收集所有 ArtLayer（进入图层组）
        var artLayers = [];
        function collectArt(layer) {
            if (layer.typename === 'LayerSet') {
                for (var i = 0; i < layer.layers.length; i++) {
                    collectArt(layer.layers[i]);
                }
            } else {
                artLayers.push(layer);
            }
        }
        for (var s = 0; s < selLayers.length; s++) {
            collectArt(selLayers[s]);
        }

        var ok = 0, fail = 0, lastErr = "";
        var idAction = stringIDToTypeID("newSmartObjectViaLayer");
        var idnull = charIDToTypeID("null");
        var idLyr = charIDToTypeID("Lyr ");

        // 逐个图层智能化，每个成为独立的智能对象
        for (var j = 0; j < artLayers.length; j++) {
            var lyr = artLayers[j];
            try {
                // 已经是智能对象，跳过并计为成功
                if (lyr.kind === LayerKind.SMARTOBJECT) { ok++; continue; }

                var ref = new ActionReference();
                ref.putIdentifier(idLyr, lyr.id);
                var desc = new ActionDescriptor();
                desc.putReference(idnull, ref);
                executeAction(idAction, desc, DialogModes.NO);
                ok++;
            } catch (e) {
                fail++;
                lastErr = e.message || String(e);
            }
        }

        if (ok === 0 && fail > 0) {
            return '{"error":"智能化失败: ' + _esc(lastErr) + '","ok":0,"fail":' + fail + '}';
        }
        return '{"ok":' + ok + ',"fail":' + fail + '}';
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    } finally {
        app.displayDialogs = prevDisplay;
    }
}

// ===== 选择导出文件夹（原生系统文件夹选择器）=====
function pickExportFolder() {
    try {
        var f = Folder.selectDialog("选择 PNG 导出文件夹");
        if (f == null) return '{"cancelled":true}';
        return '{"path":"' + _esc(f.fsName) + '"}';
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    }
}

// ===== 批量导出顶层图层为 PNG（完整画布，不裁切）=====
function exportLayersToPNG(payloadStr) {
    var prevDisplay = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    try {
        if (app.documents.length === 0) return '{"error":"未打开任何文档"}';
        var opts = eval('(' + payloadStr + ')');
        var folderPath = opts.folderPath || "";
        if (!folderPath) return '{"error":"请先选择导出文件夹"}';

        var saveFolder = new Folder(folderPath);
        if (!saveFolder.exists) return '{"error":"文件夹不存在: ' + _esc(folderPath) + '"}';

        var doc = app.activeDocument;
        var layerCount = doc.layers.length;
        if (layerCount === 0) return '{"error":"文档没有图层"}';

        var pngOpts = new PNGSaveOptions();
        pngOpts.compression = 6;
        pngOpts.interlaced = false;

        var useLayerName = opts.namingMode !== "prefix";
        var prefix = opts.prefix || "frame";
        var currentIndex = parseInt(opts.startNum);
        if (isNaN(currentIndex)) currentIndex = 0;

        // 保存原始可见性，导出后恢复
        var originalVisible = [];
        for (var v = 0; v < layerCount; v++) {
            originalVisible.push(doc.layers[v].visible);
        }

        var ok = 0, fail = 0, lastErr = "";
        try {
            for (var i = 0; i < layerCount; i++) {
                var targetLayer = doc.layers[i];
                // 隐藏所有图层，只显示当前导出图层
                for (var l = 0; l < layerCount; l++) doc.layers[l].visible = false;
                targetLayer.visible = true;

                // 生成文件名
                var fileName;
                if (useLayerName) {
                    fileName = _cleanFileName(targetLayer.name) + ".png";
                } else {
                    fileName = prefix + "_" + _padZero(currentIndex, 4) + ".png";
                    currentIndex++;
                }
                var savePath = new File(saveFolder.fsName + "/" + fileName);
                try {
                    // 完整文档尺寸导出，不裁切
                    doc.saveAs(savePath, pngOpts, true, Extension.LOWERCASE);
                    ok++;
                } catch (e) {
                    fail++;
                    lastErr = e.message || String(e);
                }
            }
        } finally {
            // 恢复原始可见性
            for (var r = 0; r < layerCount; r++) {
                try { doc.layers[r].visible = originalVisible[r]; } catch (e) {}
            }
        }

        if (ok === 0 && fail > 0) {
            return '{"error":"导出失败: ' + _esc(lastErr) + '","ok":0,"fail":' + fail + ',"folder":"' + _esc(folderPath) + '"}';
        }
        return '{"ok":' + ok + ',"fail":' + fail + ',"folder":"' + _esc(folderPath) + '"}';
    } catch (e) {
        return '{"error":"' + _esc(e.message || String(e)) + '"}';
    } finally {
        app.displayDialogs = prevDisplay;
    }
}
