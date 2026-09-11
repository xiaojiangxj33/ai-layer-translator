const cs = new CSInterface();
const https = require('https');
const http = require('http');
const urlMod = require('url');
const fs = require('fs');
const path = require('path');

// 配置保存在插件自身目录内，随插件一起携带（搬家/拷贝插件文件夹即带走配置）
const cfgPath = path.join(cs.getSystemPath(SystemPath.EXTENSION), 'ai_layer_translator.json');

let scanned = [];      // [{id, name}]
let existingNames = []; // 文档现有所有图层名（用于去重）
let translated = [];   // [{id, original, newName}]

function log(msg) {
    const el = document.getElementById('log');
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
}

function setStatus(text) {
    const el = document.getElementById('statusTxt');
    if (el) el.textContent = text;
}

function loadCfg() {
    try {
        if (fs.existsSync(cfgPath)) {
            const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            document.getElementById('baseUrl').value = c.baseUrl || '';
            document.getElementById('apiKey').value = c.apiKey || '';
            document.getElementById('model').value = c.model || 'gpt-4o-mini';
            document.getElementById('prompt').value = c.prompt || '翻译为简洁的英文图层名，使用 snake_case 风格，不要解释。';
            log('已加载配置 ← ' + cfgPath);
        } else {
            document.getElementById('prompt').value = '翻译为简洁的英文图层名，使用 snake_case 风格，不要解释。';
            document.getElementById('model').value = 'gpt-4o-mini';
            log('未找到配置文件，使用默认值（保存后生成：' + cfgPath + '）');
        }
    } catch(e) { log('读取配置失败: ' + e.message); }
}

function saveCfg() {
    const c = {
        baseUrl: document.getElementById('baseUrl').value.trim().replace(/\/$/, ''),
        apiKey: document.getElementById('apiKey').value.trim(),
        model: document.getElementById('model').value.trim(),
        prompt: document.getElementById('prompt').value
    };
    try {
        fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2), 'utf8');
        log('配置已保存 → ' + cfgPath);
    } catch(e) {
        log('保存配置失败: ' + e.message);
    }
}

// 输入时自动保存（500ms 防抖）
let _saveTimer = null;
function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveCfg, 500);
}
['baseUrl', 'apiKey', 'model', 'prompt'].forEach(id => {
    document.getElementById(id).addEventListener('input', scheduleSave);
});

function callAI(cfg, messages) {
    return new Promise((resolve, reject) => {
        const u = urlMod.parse(cfg.baseUrl + '/chat/completions');
        const lib = u.protocol === 'https:' ? https : http;
        const body = JSON.stringify({
            model: cfg.model,
            messages: messages,
            temperature: 0.2,
            response_format: { type: "json_object" }
        });
        const req = lib.request({
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + cfg.apiKey,
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(buf);
                    if (j.error) return reject(new Error(j.error.message || JSON.stringify(j.error)));
                    resolve(j.choices[0].message.content);
                } catch(e) { reject(new Error('解析响应失败: ' + buf.slice(0,200))); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// 清洗 AI 返回的命名：只保留安全字符
function sanitize(name) {
    if (!name) return 'layer';
    name = String(name).trim();
    name = name.replace(/[\r\n"'`]/g, '');
    name = name.replace(/[\\\/:\*\?<>\|]/g, '_');
    if (!name) name = 'layer';
    return name.slice(0, 80);
}

// 去重：在已有名单基础上，重复的加 _2, _3 …
function dedupe(items, reserved) {
    const used = new Set(reserved.map(n => n.toLowerCase()));
    items.forEach(it => used.delete(String(it.original).toLowerCase()));
    return items.map(it => {
        let base = sanitize(it.newName);
        let candidate = base;
        let n = 2;
        while (used.has(candidate.toLowerCase())) {
            candidate = base + '_' + n;
            n++;
        }
        used.add(candidate.toLowerCase());
        return { id: it.id, original: it.original, newName: candidate };
    });
}

function renderTable(rows) {
    const tbl = document.getElementById('preview');
    tbl.innerHTML = '';
    const tip = document.getElementById('emptyTip');
    if (tip) tip.style.display = rows.length ? 'none' : '';
    const cnt = document.getElementById('countTxt');
    if (cnt) cnt.textContent = rows.length + ' 层';
    rows.forEach(r => {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td'); td1.textContent = r.original;
        const td2 = document.createElement('td'); td2.textContent = r.newName;
        tr.appendChild(td1); tr.appendChild(td2);
        tbl.appendChild(tr);
    });
}

document.getElementById('saveCfg').addEventListener('click', saveCfg);
document.getElementById('toggleKey').addEventListener('click', () => {
    const el = document.getElementById('apiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
});

document.getElementById('scan').addEventListener('click', () => {
    log('扫描中…');
    setStatus('扫描中…');
    cs.evalScript('getChineseLayers()', res => {
        try {
            const data = JSON.parse(res);
            if (data.error) { log('错误: ' + data.error); setStatus('扫描失败'); return; }
            scanned = data.layers;
            existingNames = data.allNames;
            log('共发现 ' + scanned.length + ' 个含中文图层（文档共 ' + existingNames.length + ' 层）');
            renderTable(scanned.map(l => ({original:l.name, newName:'(待翻译)'})));
            setStatus('发现 ' + scanned.length + ' 个中文图层');
            document.getElementById('translate').disabled = scanned.length === 0;
            document.getElementById('apply').disabled = true;
        } catch(e) { log('扫描失败: ' + e.message + ' / ' + res); setStatus('扫描失败'); }
    });
});

document.getElementById('translate').addEventListener('click', async () => {
    const cfg = {
        baseUrl: document.getElementById('baseUrl').value.trim().replace(/\/$/, ''),
        apiKey: document.getElementById('apiKey').value.trim(),
        model: document.getElementById('model').value.trim(),
        prompt: document.getElementById('prompt').value
    };
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) { log('请先填写并保存 API 配置'); return; }

    const names = scanned.map(l => l.name);
    const sysMsg = '你是一个图层名翻译助手。严格按用户要求把中文图层名翻译为英文。只输出 JSON，键为 "result"，值为字符串数组，顺序与输入一致，长度相同。';
    const userMsg = '风格要求：' + cfg.prompt + '\n\n请翻译下面的图层名（保持顺序，数量一致），以 JSON 形式返回 {"result": ["...", "..."]}：\n' + JSON.stringify(names, null, 2);

    log('调用 AI 翻译 ' + names.length + ' 项…');
    setStatus('AI 翻译中…');
    document.getElementById('translate').disabled = true;
    try {
        const content = await callAI(cfg, [
            { role: 'system', content: sysMsg },
            { role: 'user', content: userMsg }
        ]);
        let parsed;
        try { parsed = JSON.parse(content); }
        catch(e) {
            const m = content.match(/\{[\s\S]*\}/);
            if (m) parsed = JSON.parse(m[0]);
            else throw new Error('AI 未返回有效 JSON');
        }
        const arr = parsed.result || parsed.results || parsed.data;
        if (!Array.isArray(arr) || arr.length !== names.length) {
            throw new Error('AI 返回的数组长度不匹配，期望 ' + names.length + ' 实际 ' + (arr ? arr.length : 'null'));
        }
        const raw = scanned.map((l, i) => ({ id: l.id, original: l.name, newName: arr[i] }));
        translated = dedupe(raw, existingNames);
        renderTable(translated);
        log('翻译完成，已自动去重');
        setStatus('翻译完成 · 待应用');
        document.getElementById('apply').disabled = false;
    } catch(e) {
        log('翻译失败: ' + e.message);
        setStatus('翻译失败');
    } finally {
        document.getElementById('translate').disabled = false;
    }
});

document.getElementById('apply').addEventListener('click', () => {
    if (!translated.length) return;
    const payload = JSON.stringify(translated.map(t => ({ id: t.id, name: t.newName })));
    const escaped = payload.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    setStatus('正在应用…');
    cs.evalScript('batchRename("' + escaped + '")', res => {
        log('应用结果: ' + res);
        try {
            const r = JSON.parse(res);
            if (r.ok !== undefined) setStatus('已应用 ' + r.ok + ' 层');
            else if (r.error) setStatus('应用失败');
        } catch(e) { setStatus('应用完成'); }
    });
});

// ===== 图层工具：检查重名/中文 =====
document.getElementById('checkBtn').addEventListener('click', () => {
    log('检查图层中…');
    setStatus('检查中…');
    cs.evalScript('checkLayers()', res => {
        try {
            const r = JSON.parse(res);
            if (r.error) { log('检查失败: ' + r.error); setStatus('检查失败'); return; }
            const msg = '检查完成：共 ' + r.total + ' 层，标红 ' + r.hit + ' 层（中文 ' + r.chinese + '，重名 ' + r.duplicate + '）';
            log(msg);
            setStatus('检查完成：标红 ' + r.hit + ' 层');
            const el = document.getElementById('checkResult');
            el.style.display = '';
            el.innerHTML = '✓ 已将 <b>' + r.hit + '</b> 个问题图层标红（中文 ' + r.chinese + '，重名 ' + r.duplicate + '）';
        } catch(e) { log('检查失败: ' + e.message); setStatus('检查失败'); }
    });
});

// ===== 图层工具：文件夹内图层重命名（一键，作用于选中的图层组）=====
document.getElementById('folderRenameBtn').addEventListener('click', () => {
    const payload = { mode: 'folder' };
    const escaped = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    setStatus('重命名中…');
    log('文件夹内图层重命名中…（选中的图层组内部所有图层改名为文件夹名，不加后缀）');
    cs.evalScript('batchRenameSelected("' + escaped + '")', res => {
        try {
            const r = JSON.parse(res);
            if (r.error) { log('重命名失败: ' + r.error); setStatus('重命名失败'); return; }
            var msg = '重命名完成：成功 ' + r.ok + ' 个图层';
            if (r.fail && r.fail > 0) msg += '，失败 ' + r.fail + ' 个';
            log(msg);
            setStatus(r.ok > 0 ? '已重命名 ' + r.ok + ' 层' : '重命名失败');
        } catch(e) { log('重命名失败: ' + e.message); setStatus('重命名失败'); }
    });
});

// ===== 图层工具：批量重命名 =====
const renameForm = document.getElementById('renameForm');
const exportForm = document.getElementById('exportForm');

function closeOtherForms(openForm) {
    if (openForm !== renameForm) renameForm.style.display = 'none';
    if (openForm !== exportForm) exportForm.style.display = 'none';
}

document.getElementById('renameBtn').addEventListener('click', () => {
    renameForm.style.display = renameForm.style.display === 'none' ? '' : 'none';
    if (renameForm.style.display !== 'none') closeOtherForms(renameForm);
});
document.getElementById('renameCancel').addEventListener('click', () => {
    renameForm.style.display = 'none';
});
document.querySelectorAll('input[name="renameMode"]').forEach(r => {
    r.addEventListener('change', () => {
        const mode = document.querySelector('input[name="renameMode"]:checked').value;
        document.getElementById('seqFields').style.display = mode === 'seq' ? '' : 'none';
        document.getElementById('prefixFields').style.display = mode === 'prefix' ? '' : 'none';
        document.getElementById('folderNote').style.display = mode === 'folder' ? '' : 'none';
    });
});
document.getElementById('renameConfirm').addEventListener('click', () => {
    const mode = document.querySelector('input[name="renameMode"]:checked').value;
    const payload = {
        mode: mode,
        baseName: document.getElementById('baseName').value,
        startNum: document.getElementById('startNum').value,
        prefix: document.getElementById('prefixInput').value
    };
    const escaped = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    setStatus('重命名中…');
    log('批量重命名中…');
    cs.evalScript('batchRenameSelected("' + escaped + '")', res => {
        try {
            const r = JSON.parse(res);
            if (r.error) { log('重命名失败: ' + r.error); setStatus('重命名失败'); return; }
            var msg = '重命名完成：成功 ' + r.ok + ' 个图层';
            if (r.fail && r.fail > 0) msg += '，失败 ' + r.fail + ' 个';
            log(msg);
            setStatus(r.ok > 0 ? '已重命名 ' + r.ok + ' 层' : '重命名失败');
            if (r.ok > 0) renameForm.style.display = 'none';
        } catch(e) { log('重命名失败: ' + e.message); setStatus('重命名失败'); }
    });
});

// ===== 图层工具：智能化图层 =====
document.getElementById('smartBtn').addEventListener('click', () => {
    log('智能化中…');
    setStatus('智能化中…');
    cs.evalScript('smartObjectSelectedLayers()', res => {
        try {
            const r = JSON.parse(res);
            if (r.error) { log('智能化失败: ' + r.error); setStatus('智能化失败'); return; }
            var msg = '智能化完成：成功 ' + r.ok + ' 个图层';
            if (r.fail && r.fail > 0) msg += '，失败 ' + r.fail + ' 个';
            log(msg);
            setStatus(r.ok > 0 ? '已智能化 ' + r.ok + ' 层' : '智能化失败');
        } catch(e) { log('智能化失败: ' + e.message); setStatus('智能化失败'); }
    });
});

// ===== 图层工具：批量导出PNG =====
document.getElementById('exportBtn').addEventListener('click', () => {
    exportForm.style.display = exportForm.style.display === 'none' ? '' : 'none';
    if (exportForm.style.display !== 'none') closeOtherForms(exportForm);
});
document.getElementById('exportCancel').addEventListener('click', () => {
    exportForm.style.display = 'none';
});

document.getElementById('browseFolder').addEventListener('click', () => {
    cs.evalScript('pickExportFolder()', res => {
        try {
            const r = JSON.parse(res);
            if (r.cancelled) return;
            if (r.error) { log('选择文件夹失败: ' + r.error); return; }
            document.getElementById('exportFolder').value = r.path;
        } catch(e) { log('选择文件夹失败: ' + e.message); }
    });
});

document.querySelectorAll('input[name="exportMode"]').forEach(r => {
    r.addEventListener('change', () => {
        const prefix = document.querySelector('input[name="exportMode"][value="prefix"]').checked;
        document.getElementById('exportPrefixFields').style.display = prefix ? '' : 'none';
    });
});

document.getElementById('exportConfirm').addEventListener('click', () => {
    const folderPath = document.getElementById('exportFolder').value.trim();
    if (!folderPath) { log('请先选择导出文件夹'); setStatus('请选择文件夹'); return; }

    const namingMode = document.querySelector('input[name="exportMode"]:checked').value;
    const payload = {
        folderPath: folderPath,
        namingMode: namingMode,
        prefix: document.getElementById('exportPrefix').value,
        startNum: document.getElementById('exportStartNum').value
    };
    const escaped = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    setStatus('导出中…');
    log('批量导出PNG中…（完整画布，不裁切）');
    document.getElementById('exportConfirm').disabled = true;

    cs.evalScript('exportLayersToPNG("' + escaped + '")', res => {
        document.getElementById('exportConfirm').disabled = false;
        try {
            const r = JSON.parse(res);
            if (r.error) { log('导出失败: ' + r.error); setStatus('导出失败'); return; }
            var msg = '导出完成：成功 ' + r.ok + ' 个';
            if (r.fail && r.fail > 0) msg += '，失败 ' + r.fail + ' 个';
            msg += '\n保存目录：' + r.folder;
            log(msg);
            setStatus(r.ok > 0 ? '已导出 ' + r.ok + ' 个PNG' : '导出失败');
            if (r.ok > 0) exportForm.style.display = 'none';
        } catch(e) { log('导出失败: ' + e.message); setStatus('导出失败'); }
    });
});

// ===== 页签切换 =====
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        const target = document.getElementById(tab.dataset.page);
        if (target) target.style.display = '';
    });
});

// ===== 折叠/展开可折叠卡片 =====
document.querySelectorAll('.collapsible-title').forEach(title => {
    title.addEventListener('click', () => {
        const target = document.getElementById(title.dataset.target);
        if (target) {
            target.classList.toggle('collapsed');
            title.classList.toggle('collapsed');
        }
    });
});

loadCfg();
setStatus('配置已就绪');
log('就绪。AI图层翻译 / 图层工具两个页面已就绪。');
