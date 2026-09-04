(function () {
    'use strict';

    // ===== 存储键 =====
    const KEY_TEMPLATES = 'sale-tool.templates';
    const KEY_SETTINGS = 'sale-tool.settings';
    const KEY_SEQ = 'sale-tool.seq';
    const KEY_PINNED = 'sale-tool.pinned';   // 置顶模板 id 数组
    const KEY_RECENT = 'sale-tool.recent';   // 最近使用模板 id 数组（倒序）
    const KEY_PRODUCTS_OLD = 'sale-tool.products'; // 旧数据，清空
    const RECENT_MAX = 5;

    // ===== 工具函数 =====
    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function saveJSON(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function fmtMoney(n) {
        const v = Number(n) || 0;
        return v.toFixed(2);
    }

    function fmtDateOnly(d) {
        const pad = (x) => String(x).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    // 数字转中文大写金额
    function amountToChinese(n) {
        const num = Math.round((Number(n) || 0) * 100) / 100;
        if (num === 0) return '零元整';
        const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
        const radices = ['', '拾', '佰', '仟'];
        const bigRadices = ['', '万', '亿', '兆'];

        const intPart = Math.floor(num);
        const decimals = Math.round((num - intPart) * 100);

        let zeroCount = 0;
        let result = '';
        const intStr = String(intPart);
        const len = intStr.length;

        for (let i = 0; i < len; i++) {
            const p = len - i - 1; // 当前位对应的权级（个位=0）
            const d = intStr[i] - '0';
            const quotient = Math.floor(p / 4);
            const modulus = p % 4;

            if (d === 0) {
                zeroCount++;
            } else {
                if (zeroCount > 0) result += '零';
                zeroCount = 0;
                result += digits[d] + radices[modulus];
            }
            if (modulus === 0 && zeroCount < 4) {
                result += bigRadices[quotient];
                zeroCount = 0;
            }
        }

        result += result ? '元' : '';
        if (decimals === 0) {
            result += '整';
        } else {
            const jiao = Math.floor(decimals / 10);
            const fen = decimals % 10;
            if (intPart === 0 && jiao === 0) { /* 纯分，如 0.05，前面不需要“零元”特判 */ }
            if (jiao > 0) result += digits[jiao] + '角';
            else if (intPart > 0) result += '零';
            if (fen > 0) result += digits[fen] + '分';
        }
        return result;
    }

    // ===== 默认「通用模板」数据 =====
    const DEFAULT_TEMPLATE_NAMES = [
        '加工', '生态板', '背板', '石膏板', '450滑倒', '400滑倒', '350滑倒',
        '300滑倒', '250滑倒', '卡主骨', '付龙骨', '丝杆', '喷头', '螺母',
        '竖龙骨', '天地', '穿心', '欧松板', '阻燃板', '木方', '30直钉',
        '50直钉', '25自攻螺丝', '35自攻螺丝', '50自攻螺丝', '二合一',
        '泡沫胶', '结构胶', '修补膏', 'St38', 'St32', 'St50', '422马丁',
        '大白胶', '锯片', '运费＋上楼'
    ];

    // ===== 数据模型 =====
    function seedDefaults() {
        // 若模板库不存在，初始化并写入「通用模板」
        let templates = loadJSON(KEY_TEMPLATES, null);
        if (templates === null) {
            templates = [{
                id: genId(),
                name: '通用模板',
                items: DEFAULT_TEMPLATE_NAMES.map((n) => ({ name: n, price: '' }))
            }];
            saveJSON(KEY_TEMPLATES, templates);
        }
        // 清空旧商品数据
        localStorage.removeItem(KEY_PRODUCTS_OLD);
        return templates;
    }

    let templates = seedDefaults();

    let settings = loadJSON(KEY_SETTINGS, {
        shop: '', warehouse: '', operator: '', address: '', phone: ''
    });
    let seq = loadJSON(KEY_SEQ, 1);
    let pinned = loadJSON(KEY_PINNED, []);
    let recent = loadJSON(KEY_RECENT, []);

    // 置顶
    function togglePin(id) {
        const idx = pinned.indexOf(id);
        if (idx >= 0) {
            pinned.splice(idx, 1);
        } else {
            pinned.push(id);
        }
        saveJSON(KEY_PINNED, pinned);
        renderTemplateList();
        renderHome();
    }
    function isPinned(id) { return pinned.indexOf(id) >= 0; }

    // 记录最近使用（去重、置顶、裁剪上限）
    function markRecent(id) {
        recent = recent.filter((x) => x !== id);
        recent.unshift(id);
        if (recent.length > RECENT_MAX) recent = recent.slice(0, RECENT_MAX);
        saveJSON(KEY_RECENT, recent);
    }

    // 当前开单明细：{ id, name, unit, price, qty, note }
    let orderLines = [];

    // 当前正在编辑的模板 id（null 表示新建）
    let editingTemplateId = null;
    // 模板编辑中的商品项（运行时）
    let tplItems = [];

    // ===== 商品候选：实时从所有模板去重 =====
    function getProductCandidates() {
        const set = new Map();
        templates.forEach((t) => {
            (t.items || []).forEach((it) => {
                const n = (it.name || '').trim();
                if (n) set.set(n, true);
            });
        });
        // 也加入当前开单明细中的名称
        orderLines.forEach((l) => {
            const n = (l.name || '').trim();
            if (n) set.set(n, true);
        });
        // 加入模板编辑中的名称
        tplItems.forEach((it) => {
            const n = (it.name || '').trim();
            if (n) set.set(n, true);
        });
        return Array.from(set.keys());
    }

    // ===== DOM 引用 =====
    const $ = (sel) => document.querySelector(sel);

    // 导航
    const menuBtn = $('#menu-btn');
    const menuDrawer = $('#menu-drawer');
    const menuMask = $('#menu-mask');
    const menuItems = document.querySelectorAll('.menu-item');
    const topbarTitle = $('#topbar-title');
    const views = {
        'view-home': $('#view-home'),
        'view-order': $('#view-order'),
        'view-templates': $('#view-templates'),
        'view-template-edit': $('#view-template-edit'),
        'view-settings': $('#view-settings'),
    };
    const VIEW_TITLES = {
        'view-home': '开单工具',
        'view-order': '开单',
        'view-templates': '模板管理',
        'view-template-edit': '模板编辑',
        'view-settings': '店铺配置',
    };

    // 首页
    const btnHomeNew = $('#btn-home-new');
    const btnHomeMore = $('#btn-home-more');
    const homeSearch = $('#home-search');
    const homePinnedList = $('#home-pinned-list');
    const homePinnedSection = $('#home-pinned-section');
    const homeRecentList = $('#home-recent-list');
    const homeRecentSection = $('#home-recent-section');
    const homeMoreList = $('#home-more-list');
    const homeMoreSection = $('#home-more-section');

    // 开单
    const orderTitle = $('#order-title');
    const btnOpenPicker = $('#btn-open-picker');
    const drawer = $('#drawer');
    const drawerMask = $('#drawer-mask');
    const drawerSearch = $('#drawer-search');
    const drawerList = $('#drawer-list');
    const drawerClose = $('#drawer-close');
    const drawerNewProduct = $('#drawer-new-product');
    const orderLinesEl = $('#order-lines');
    const emptyTip = $('#empty-tip');
    const totalAmount = $('#total-amount');
    const btnReset = $('#btn-reset');
    const receiptEl = $('#receipt');
    const btnExport = $('#btn-export');
    const customerNameInput = $('#customer-name');
    const orderNoteInput = $('#order-note');

    // 模板管理
    const templateList = $('#template-list');
    const btnNewTemplate = $('#btn-new-template');

    // 模板编辑
    const templateEditTitle = $('#template-edit-title');
    const btnTemplateBack = $('#btn-template-back');
    const tplNameInput = $('#tpl-name');
    const tplSearch = $('#tpl-search');
    const tplSearchResults = $('#tpl-search-results');
    const tplItemsEl = $('#tpl-items');
    const btnSaveTemplate = $('#btn-save-template');

    // 模板选择抽屉
    const tplDrawer = $('#tpl-drawer');
    const tplMask = $('#tpl-mask');
    const tplClose = $('#tpl-close');
    const tplSelectList = $('#tpl-select-list');

    // 店铺配置
    const settingsForm = $('#settings-form');
    const sShop = $('#s-shop');
    const sWarehouse = $('#s-warehouse');
    const sOperator = $('#s-operator');
    const sAddress = $('#s-address');
    const sPhone = $('#s-phone');

    // ===== 导航切换 =====
    function switchView(name) {
        Object.keys(views).forEach((k) => {
            views[k].classList.toggle('active', k === name);
        });
        menuItems.forEach((t) => {
            t.classList.toggle('active', t.dataset.view === name);
        });
        topbarTitle.textContent = VIEW_TITLES[name] || '开单工具';
        closeMenu();
        if (name === 'view-home') renderHome();
        if (name === 'view-templates') renderTemplateList();
        if (name === 'view-settings') fillSettingsForm();
        if (name === 'view-order') renderReceipt();
    }

    function openMenu() { menuDrawer.classList.add('open'); menuMask.classList.add('show'); }
    function closeMenu() { menuDrawer.classList.remove('open'); menuMask.classList.remove('show'); }

    menuBtn.addEventListener('click', openMenu);
    menuMask.addEventListener('click', closeMenu);
    menuItems.forEach((item) => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });

    // ===== 首页入口 =====
    const MORE_EXPAND_THRESHOLD = 6; // 其余模板超过此数量才折叠

    btnHomeNew.addEventListener('click', () => startNewOrder());
    btnHomeMore.addEventListener('click', () => {
        homeMoreSection.classList.add('expanded');
        btnHomeMore.style.display = 'none';
        renderHomeMoreList();
    });
    homeSearch.addEventListener('input', renderHome);

    function startNewOrder() {
        orderLines = [];
        orderTitle.textContent = '新建开单';
        customerNameInput.value = '';
        orderNoteInput.value = '';
        resetOrderMeta();
        renderOrderLines();
        switchView('view-order');
    }

    // 构建一个模板卡片 DOM
    function buildTplCard(t) {
        const li = document.createElement('li');
        li.className = 'home-tpl-card';
        li.innerHTML =
            '<div class="home-tpl-card-name">' + escapeHtml(t.name) + '</div>' +
            '<div class="home-tpl-card-meta">' + (t.items || []).length + ' 个商品</div>';
        li.addEventListener('click', () => startOrderFromTemplate(t));
        return li;
    }

    function renderHome() {
        const kw = (homeSearch.value || '').trim().toLowerCase();
        homePinnedList.innerHTML = '';
        homeRecentList.innerHTML = '';
        homeMoreList.innerHTML = '';

        // 过滤有效的模板 id（清理已删除模板的置顶/最近残留）
        pinned = pinned.filter((id) => templates.some((t) => t.id === id));
        recent = recent.filter((id) => templates.some((t) => t.id === id));

        const match = (t) => !kw || (t.name || '').toLowerCase().includes(kw);
        const byId = (id) => templates.find((t) => t.id === id);

        // 置顶区
        const pinnedTpls = pinned.map(byId).filter(Boolean).filter(match);
        homePinnedSection.style.display = pinnedTpls.length ? 'block' : 'none';
        pinnedTpls.forEach((t) => homePinnedList.appendChild(buildTplCard(t)));

        // 最近区（排除已置顶）
        const pinnedIds = new Set(pinnedTpls.map((t) => t.id));
        const recentTpls = recent.map(byId).filter(Boolean)
            .filter((t) => !pinnedIds.has(t.id))
            .filter(match)
            .slice(0, RECENT_MAX);
        homeRecentSection.style.display = recentTpls.length ? 'block' : 'none';
        recentTpls.forEach((t) => homeRecentList.appendChild(buildTplCard(t)));

        // 其余模板（除置顶 + 最近，按创建顺序）
        const allPinnedIds = new Set(pinned.map((id) => id));
        const allRecentIds = new Set(recent.map((id) => id));
        const rest = templates.filter((t) =>
            match(t) && !allPinnedIds.has(t.id) && !allRecentIds.has(t.id)
        );

        homeMoreList.innerHTML = '';
        homeMoreSection.classList.remove('expanded');

        if (rest.length === 0) {
            homeMoreSection.style.display = 'none';
            btnHomeMore.style.display = 'none';
        } else if (rest.length <= MORE_EXPAND_THRESHOLD) {
            // 少于等于阈值：直接平铺全部，无需「显示更多」
            homeMoreSection.style.display = 'block';
            btnHomeMore.style.display = 'none';
            rest.forEach((t) => homeMoreList.appendChild(buildTplCard(t)));
        } else {
            // 多于阈值：只显示按钮，点击展开全部
            homeMoreSection.style.display = 'block';
            btnHomeMore.style.display = 'block';
        }
    }

    function renderHomeMoreList() {
        const kw = (homeSearch.value || '').trim().toLowerCase();
        const match = (t) => !kw || (t.name || '').toLowerCase().includes(kw);

        // 置顶 + 最近里已经展示过的 id
        const pinnedIds = new Set(pinned.map((id) => id));
        const recentIds = new Set(recent.map((id) => id));
        const rest = templates.filter((t) =>
            match(t) && !pinnedIds.has(t.id) && !recentIds.has(t.id)
        );

        homeMoreList.innerHTML = '';
        if (rest.length === 0) {
            const li = document.createElement('li');
            li.className = 'home-empty';
            li.textContent = '没有更多模板';
            homeMoreList.appendChild(li);
        } else {
            rest.forEach((t) => homeMoreList.appendChild(buildTplCard(t)));
        }
    }

    // 初始化首页
    renderHome();

    // ===== 模板选择抽屉 =====
    tplClose.addEventListener('click', closeTemplateDrawer);
    tplMask.addEventListener('click', closeTemplateDrawer);
    function closeTemplateDrawer() {
        tplDrawer.classList.remove('open');
        tplMask.classList.remove('show');
    }

    function renderTemplateSelectList() {
        tplSelectList.innerHTML = '';
        if (templates.length === 0) {
            const li = document.createElement('li');
            li.className = 'drawer-empty';
            li.textContent = '暂无模板，请先新建';
            tplSelectList.appendChild(li);
            return;
        }
        templates.forEach((t) => {
            const li = document.createElement('li');
            li.className = 'drawer-item';
            const info = document.createElement('div');
            info.className = 'drawer-item-info';
            info.innerHTML =
                '<div class="drawer-item-name">' + escapeHtml(t.name) + '</div>' +
                '<div class="drawer-item-meta">' + (t.items || []).length + ' 个商品</div>';
            li.appendChild(info);
            li.addEventListener('click', () => {
                closeTemplateDrawer();
                startOrderFromTemplate(t);
            });
            tplSelectList.appendChild(li);
        });
    }

    function startOrderFromTemplate(tpl) {
        markRecent(tpl.id);
        orderLines = (tpl.items || []).map((it) => ({
            id: genId(),
            name: it.name || '',
            unit: '',
            price: it.price != null && it.price !== '' ? Number(it.price) : '',
            qty: 1,
            note: ''
        }));
        orderTitle.textContent = '开单 · ' + tpl.name;
        customerNameInput.value = '';
        orderNoteInput.value = '';
        resetOrderMeta();
        renderOrderLines();
        switchView('view-order');
    }

    // ===== 模板管理 =====
    function renderTemplateList() {
        templateList.innerHTML = '';
        if (templates.length === 0) {
            const li = document.createElement('li');
            li.className = 'empty-tip';
            li.textContent = '暂无模板，点击右上角新建';
            templateList.appendChild(li);
            return;
        }
        templates.forEach((t) => {
            const li = document.createElement('li');
            li.className = 'template-item';

            const info = document.createElement('div');
            info.className = 'template-item-info';
            info.innerHTML =
                '<div class="template-item-name">' +
                (isPinned(t.id) ? '<span class="pin-badge">📌</span> ' : '') +
                escapeHtml(t.name) + '</div>' +
                '<div class="template-item-meta">' + (t.items || []).length + ' 个商品</div>';

            const actions = document.createElement('div');
            actions.className = 'template-item-actions';

            const btnUse = document.createElement('button');
            btnUse.className = 'btn btn-primary btn-sm';
            btnUse.textContent = '开单';
            btnUse.addEventListener('click', () => startOrderFromTemplate(t));

            const btnPin = document.createElement('button');
            btnPin.className = 'btn btn-sm ' + (isPinned(t.id) ? 'btn-primary' : 'btn-ghost');
            btnPin.textContent = isPinned(t.id) ? '取消置顶' : '置顶';
            btnPin.addEventListener('click', () => togglePin(t.id));

            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn btn-ghost btn-sm';
            btnEdit.textContent = '编辑';
            btnEdit.addEventListener('click', () => openTemplateEdit(t));

            const btnCopy = document.createElement('button');
            btnCopy.className = 'btn btn-ghost btn-sm';
            btnCopy.textContent = '复制';
            btnCopy.addEventListener('click', () => copyTemplate(t));

            const btnDel = document.createElement('button');
            btnDel.className = 'btn btn-danger btn-sm';
            btnDel.textContent = '删除';
            btnDel.addEventListener('click', () => deleteTemplate(t.id));

            actions.appendChild(btnUse);
            actions.appendChild(btnPin);
            actions.appendChild(btnEdit);
            actions.appendChild(btnCopy);
            actions.appendChild(btnDel);

            li.appendChild(info);
            li.appendChild(actions);
            templateList.appendChild(li);
        });
    }

    function copyTemplate(t) {
        const newTpl = {
            id: genId(),
            name: t.name + '（副本）',
            items: (t.items || []).map((it) => ({ name: it.name, price: it.price }))
        };
        templates.push(newTpl);
        saveJSON(KEY_TEMPLATES, templates);
        renderTemplateList();
    }

    function deleteTemplate(id) {
        const t = templates.find((x) => x.id === id);
        if (!t) return;
        if (!confirm('确定删除模板「' + t.name + '」吗？')) return;
        templates = templates.filter((x) => x.id !== id);
        pinned = pinned.filter((x) => x !== id);
        recent = recent.filter((x) => x !== id);
        saveJSON(KEY_TEMPLATES, templates);
        saveJSON(KEY_PINNED, pinned);
        saveJSON(KEY_RECENT, recent);
        renderTemplateList();
    }

    btnNewTemplate.addEventListener('click', () => openTemplateEdit(null));

    // ===== 模板编辑 =====
    function openTemplateEdit(tpl) {
        if (tpl) {
            editingTemplateId = tpl.id;
            tplNameInput.value = tpl.name;
            tplItems = (tpl.items || []).map((it) => ({ name: it.name, price: it.price }));
            templateEditTitle.textContent = '编辑模板';
        } else {
            editingTemplateId = null;
            tplNameInput.value = '';
            tplItems = [];
            templateEditTitle.textContent = '新建模板';
        }
        renderTplItems();
        switchView('view-template-edit');
    }

    btnTemplateBack.addEventListener('click', () => switchView('view-templates'));

    function renderTplItems() {
        tplItemsEl.innerHTML = '';
        if (tplItems.length === 0) {
            const div = document.createElement('div');
            div.className = 'empty-tip';
            div.textContent = '尚未添加商品';
            tplItemsEl.appendChild(div);
            return;
        }
        tplItems.forEach((it, idx) => {
            const row = document.createElement('div');
            row.className = 'tpl-item-row';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'input tpl-item-name-input';
            nameInput.value = it.name || '';
            nameInput.placeholder = '商品名称';
            nameInput.addEventListener('input', () => {
                it.name = nameInput.value;
            });

            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.className = 'input tpl-item-price-input';
            priceInput.value = it.price || '';
            priceInput.placeholder = '价格(选填)';
            priceInput.min = '0';
            priceInput.step = '0.01';
            priceInput.addEventListener('input', () => {
                it.price = priceInput.value;
            });

            const del = document.createElement('button');
            del.className = 'line-del';
            del.innerHTML = '&times;';
            del.addEventListener('click', () => {
                tplItems.splice(idx, 1);
                renderTplItems();
            });

            row.appendChild(nameInput);
            row.appendChild(priceInput);
            row.appendChild(del);
            tplItemsEl.appendChild(row);
        });
    }

    // 模板添加商品：搜索下拉
    function tplDoSearch() {
        const kw = tplSearch.value.trim().toLowerCase();
        const candidates = getProductCandidates();
        tplSearchResults.innerHTML = '';
        const matches = kw
            ? candidates.filter((n) => n.toLowerCase().includes(kw))
            : candidates;

        if (matches.length === 0) {
            const li = document.createElement('li');
            li.className = 'search-noresult';
            li.textContent = kw ? '没有匹配，回车直接添加新商品' : '暂无候选商品';
            tplSearchResults.appendChild(li);
        } else {
            matches.slice(0, 20).forEach((n) => {
                const li = document.createElement('li');
                li.className = 'search-item';
                li.textContent = n;
                li.addEventListener('click', () => {
                    addTplItem(n);
                });
                tplSearchResults.appendChild(li);
            });
        }
        tplSearchResults.classList.remove('hidden');
    }

    function addTplItem(name) {
        name = (name || '').trim();
        if (!name) return;
        // 去重
        if (tplItems.some((it) => it.name === name)) return;
        tplItems.push({ name: name, price: '' });
        tplSearch.value = '';
        tplSearchResults.classList.add('hidden');
        renderTplItems();
    }

    tplSearch.addEventListener('input', tplDoSearch);
    tplSearch.addEventListener('focus', tplDoSearch);
    tplSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTplItem(tplSearch.value);
        }
    });
    tplSearch.addEventListener('blur', () => {
        setTimeout(() => tplSearchResults.classList.add('hidden'), 150);
    });

    btnSaveTemplate.addEventListener('click', () => {
        const name = tplNameInput.value.trim();
        if (!name) { alert('请填写模板名称'); return; }
        // 过滤掉空名称商品
        tplItems = tplItems.filter((it) => (it.name || '').trim());

        if (editingTemplateId) {
            const t = templates.find((x) => x.id === editingTemplateId);
            if (t) {
                t.name = name;
                t.items = tplItems.map((it) => ({ name: it.name, price: it.price }));
            }
        } else {
            templates.push({
                id: genId(),
                name: name,
                items: tplItems.map((it) => ({ name: it.name, price: it.price }))
            });
        }
        saveJSON(KEY_TEMPLATES, templates);
        alert('模板已保存');
        switchView('view-templates');
    });

    // ===== 开单：选商品抽屉 =====
    function openDrawer() {
        drawer.classList.add('open');
        drawerMask.classList.add('show');
        drawerSearch.value = '';
        renderDrawerList();
        setTimeout(() => drawerSearch.focus(), 200);
    }
    function closeDrawer() {
        drawer.classList.remove('open');
        drawerMask.classList.remove('show');
    }

    function renderDrawerList() {
        const kw = drawerSearch.value.trim().toLowerCase();
        const candidates = getProductCandidates();
        drawerList.innerHTML = '';
        const list = kw
            ? candidates.filter((n) => n.toLowerCase().includes(kw))
            : candidates;

        if (list.length === 0) {
            const li = document.createElement('li');
            li.className = 'drawer-empty';
            li.textContent = kw ? '无匹配，可在下方输入新商品' : '暂无候选商品';
            drawerList.appendChild(li);
            return;
        }

        list.forEach((name) => {
            const li = document.createElement('li');
            li.className = 'drawer-item';

            const info = document.createElement('div');
            info.className = 'drawer-item-info';
            info.innerHTML = '<div class="drawer-item-name">' + escapeHtml(name) + '</div>';

            // 是否已在明细中
            const existing = orderLines.find((l) => l.name === name);

            if (!existing) {
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'qty-btn qty-btn-add';
                addBtn.textContent = '＋';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    addLineByName(name);
                });
                li.appendChild(info);
                li.appendChild(addBtn);
            } else {
                const qtyBox = document.createElement('div');
                qtyBox.className = 'qty-box qty-box-sm';

                const minusBtn = document.createElement('button');
                minusBtn.type = 'button';
                minusBtn.className = 'qty-btn';
                minusBtn.textContent = '−';
                minusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (existing.qty <= 1) {
                        removeLine(existing.id);
                    } else {
                        existing.qty -= 1;
                        renderOrderLines();
                        renderDrawerList();
                    }
                });

                const qtyInput = document.createElement('input');
                qtyInput.type = 'number';
                qtyInput.className = 'qty-input';
                qtyInput.value = existing.qty;
                qtyInput.min = '1';
                qtyInput.step = '1';
                qtyInput.inputMode = 'numeric';
                qtyInput.addEventListener('click', (e) => e.stopPropagation());
                qtyInput.addEventListener('input', () => {
                    const v = parseInt(qtyInput.value, 10);
                    existing.qty = isNaN(v) || v <= 0 ? 1 : v;
                    renderOrderLines();
                });

                const plusBtn = document.createElement('button');
                plusBtn.type = 'button';
                plusBtn.className = 'qty-btn';
                plusBtn.textContent = '＋';
                plusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    existing.qty += 1;
                    renderOrderLines();
                    qtyInput.value = existing.qty;
                });

                qtyBox.appendChild(minusBtn);
                qtyBox.appendChild(qtyInput);
                qtyBox.appendChild(plusBtn);
                li.appendChild(info);
                li.appendChild(qtyBox);
            }
            drawerList.appendChild(li);
        });
    }

    function addLineByName(name) {
        name = (name || '').trim();
        if (!name) return;
        const exist = orderLines.find((l) => l.name === name);
        if (exist) {
            exist.qty += 1;
        } else {
            orderLines.push({
                id: genId(),
                name: name,
                unit: '',
                price: '',
                qty: 1,
                note: ''
            });
        }
        renderOrderLines();
        if (drawer.classList.contains('open')) renderDrawerList();
    }

    function removeLine(id) {
        orderLines = orderLines.filter((l) => l.id !== id);
        renderOrderLines();
        if (drawer.classList.contains('open')) renderDrawerList();
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    btnOpenPicker.addEventListener('click', openDrawer);
    drawerClose.addEventListener('click', closeDrawer);
    drawerMask.addEventListener('click', closeDrawer);
    drawerSearch.addEventListener('input', renderDrawerList);
    drawerNewProduct.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLineByName(drawerNewProduct.value);
            drawerNewProduct.value = '';
            renderDrawerList();
        }
    });

    // ===== 开单：明细渲染 =====
    function renderOrderLines() {
        orderLinesEl.innerHTML = '';
        emptyTip.style.display = orderLines.length === 0 ? 'block' : 'none';

        orderLines.forEach((line) => {
            const row = document.createElement('div');
            row.className = 'line-row';

            // 第一行：名称 + 金额 + 删除
            const topRow = document.createElement('div');
            topRow.className = 'line-top';

            const info = document.createElement('div');
            info.className = 'line-info';
            const name = document.createElement('div');
            name.className = 'line-name';
            name.textContent = line.name;
            info.appendChild(name);

            const right = document.createElement('div');
            right.className = 'line-right';
            const amount = document.createElement('div');
            amount.className = 'line-amount';
            amount.textContent = '¥' + fmtMoney((Number(line.price) || 0) * line.qty);
            const del = document.createElement('button');
            del.className = 'line-del';
            del.innerHTML = '&times;';
            del.title = '删除该行';
            del.addEventListener('click', () => removeLine(line.id));
            right.appendChild(amount);
            right.appendChild(del);

            topRow.appendChild(info);
            topRow.appendChild(right);

            // 第二行：数量 + 单价 + 备注
            const bottomRow = document.createElement('div');
            bottomRow.className = 'line-bottom';

            // 数量
            const qtyField = document.createElement('div');
            qtyField.className = 'line-field line-field-qty';
            const qtyLabel = document.createElement('label');
            qtyLabel.textContent = '数量';
            const qtyBox = document.createElement('div');
            qtyBox.className = 'qty-box';

            const minusBtn = document.createElement('button');
            minusBtn.type = 'button';
            minusBtn.className = 'qty-btn';
            minusBtn.textContent = '−';
            minusBtn.addEventListener('click', () => {
                const v = (parseInt(qtyInput.value, 10) || 1) - 1;
                line.qty = v <= 0 ? 1 : v;
                renderOrderLines();
            });
            const qtyInput = document.createElement('input');
            qtyInput.type = 'number';
            qtyInput.className = 'input qty-input';
            qtyInput.min = '1';
            qtyInput.step = '1';
            qtyInput.value = line.qty;
            qtyInput.inputMode = 'numeric';
            qtyInput.addEventListener('input', () => {
                const v = parseInt(qtyInput.value, 10);
                line.qty = isNaN(v) || v <= 0 ? 1 : v;
                const amt = row.querySelector('.line-amount');
                if (amt) amt.textContent = '¥' + fmtMoney((Number(line.price) || 0) * line.qty);
                updateTotal();
                renderReceipt();
            });
            qtyInput.addEventListener('blur', () => {
                const v = parseInt(qtyInput.value, 10);
                line.qty = isNaN(v) || v <= 0 ? 1 : v;
                renderOrderLines();
            });
            const plusBtn = document.createElement('button');
            plusBtn.type = 'button';
            plusBtn.className = 'qty-btn';
            plusBtn.textContent = '＋';
            plusBtn.addEventListener('click', () => {
                const v = (parseInt(qtyInput.value, 10) || 1) + 1;
                line.qty = v;
                renderOrderLines();
            });
            qtyBox.appendChild(minusBtn);
            qtyBox.appendChild(qtyInput);
            qtyBox.appendChild(plusBtn);
            qtyField.appendChild(qtyLabel);
            qtyField.appendChild(qtyBox);

            // 单价
            const priceField = document.createElement('div');
            priceField.className = 'line-field line-field-price';
            const priceLabel = document.createElement('label');
            priceLabel.textContent = '单价';
            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.className = 'input';
            priceInput.value = line.price != null && line.price !== '' ? line.price : '';
            priceInput.placeholder = '0.00';
            priceInput.min = '0';
            priceInput.step = '0.01';
            priceInput.inputMode = 'decimal';
            priceInput.addEventListener('input', () => {
                line.price = priceInput.value;
                const amt = row.querySelector('.line-amount');
                if (amt) amt.textContent = '¥' + fmtMoney((Number(line.price) || 0) * line.qty);
                updateTotal();
                renderReceipt();
            });
            priceField.appendChild(priceLabel);
            priceField.appendChild(priceInput);

            // 备注
            const noteField = document.createElement('div');
            noteField.className = 'line-field line-field-note';
            const noteLabel = document.createElement('label');
            noteLabel.textContent = '备注';
            const noteInput = document.createElement('input');
            noteInput.type = 'text';
            noteInput.className = 'input';
            noteInput.value = line.note || '';
            noteInput.placeholder = '选填';
            noteInput.addEventListener('input', () => {
                line.note = noteInput.value;
                renderReceipt();
            });
            noteField.appendChild(noteLabel);
            noteField.appendChild(noteInput);

            bottomRow.appendChild(qtyField);
            bottomRow.appendChild(priceField);
            bottomRow.appendChild(noteField);

            row.appendChild(topRow);
            row.appendChild(bottomRow);
            orderLinesEl.appendChild(row);
        });

        renderReceipt();
    }

    // ===== 开单：合计 & 票据 =====
    function calcTotal() {
        return orderLines.reduce((sum, l) => sum + (Number(l.price) || 0) * (Number(l.qty) || 0), 0);
    }
    function updateTotal() {
        totalAmount.textContent = '¥' + fmtMoney(calcTotal());
    }
    function nextOrderNo() {
        const no = 'DD' + String(seq).padStart(6, '0');
        seq += 1;
        saveJSON(KEY_SEQ, seq);
        return no;
    }

    let currentOrderNo = null;
    let currentOrderTime = null;
    function resetOrderMeta() {
        currentOrderNo = null;
        currentOrderTime = null;
    }
    function ensureOrderMeta() {
        if (!currentOrderNo) {
            currentOrderNo = nextOrderNo();
            currentOrderTime = new Date();
        }
    }

    function renderReceipt() {
        ensureOrderMeta();
        totalAmount.textContent = '¥' + fmtMoney(calcTotal());

        const total = calcTotal();
        const hasShop = settings.shop && settings.shop.trim();
        const customerName = customerNameInput.value.trim();
        const orderNote = orderNoteInput.value.trim();

        let html = '';
        html += '<div class="r-head">';
        if (hasShop) html += '<div class="r-shop">' + escapeHtml(settings.shop) + '</div>';
        html += '<div class="r-head-meta">';
        html += '<span>录单日期：' + escapeHtml(fmtDateOnly(currentOrderTime)) + '</span>';
        html += '<span>单据编号：' + escapeHtml(currentOrderNo) + '</span>';
        html += '</div>';
        html += '</div>';

        html += '<div class="r-info-row">';
        html += '<span>客户名称：' + escapeHtml(customerName || '-') + '</span>';
        html += '</div>';

        if (orderNote) {
            html += '<div class="r-order-note">备注：' + escapeHtml(orderNote) + '</div>';
        }

        // 表格：序号 / 商品名称 / 数量 / 单位 / 单价 / 金额 / 备注
        html += '<table class="r-table">';
        html += '<thead><tr>' +
            '<th class="r-num">序号</th>' +
            '<th class="r-name-col">商品名称</th>' +
            '<th class="r-qty">数量</th>' +
            '<th class="r-unit">单位</th>' +
            '<th class="r-price">单价</th>' +
            '<th class="r-subtotal">金额</th>' +
            '<th class="r-note-col">备注</th>' +
            '</tr></thead>';
        html += '<tbody>';
        if (orderLines.length === 0) {
            html += '<tr><td colspan="7" style="text-align:center;color:#999;">暂无商品</td></tr>';
        } else {
            orderLines.forEach((l, i) => {
                html += '<tr>' +
                    '<td class="r-num">' + (i + 1) + '</td>' +
                    '<td class="r-name-col">' + escapeHtml(l.name) + '</td>' +
                    '<td class="r-qty">' + l.qty + '</td>' +
                    '<td class="r-unit">' + escapeHtml(l.unit || '') + '</td>' +
                    '<td class="r-price">' + (l.price !== '' && l.price != null ? fmtMoney(l.price) : '') + '</td>' +
                    '<td class="r-subtotal">' + fmtMoney((Number(l.price) || 0) * l.qty) + '</td>' +
                    '<td class="r-note-col">' + escapeHtml(l.note || '') + '</td>' +
                    '</tr>';
            });
        }
        html += '</tbody></table>';

        html += '<div class="r-summary">';
        html += '<div class="r-summary-line">合计金额：¥' + fmtMoney(total) + ' 元</div>';
        html += '<div class="r-summary-line r-summary-cap">大写：' + escapeHtml(amountToChinese(total)) + '</div>';
        html += '</div>';

        html += '<div class="r-footer">';
        html += '<div class="r-footer-row">';
        html += '<span>制单人：' + escapeHtml(settings.operator || '-') + '</span>';
        html += '<span>联系电话：' + escapeHtml(settings.phone || '-') + '</span>';
        html += '</div>';
        html += '<div>地址：' + escapeHtml(settings.address || '-') + '</div>';
        html += '</div>';

        receiptEl.innerHTML = html;
    }

    customerNameInput.addEventListener('input', renderReceipt);
    orderNoteInput.addEventListener('input', renderReceipt);

    btnReset.addEventListener('click', () => {
        if (orderLines.length > 0 && !confirm('确定清空当前开单吗？')) return;
        orderLines = [];
        resetOrderMeta();
        customerNameInput.value = '';
        orderNoteInput.value = '';
        renderOrderLines();
    });

    // ===== 导出图片 =====
    btnExport.addEventListener('click', () => {
        if (orderLines.length === 0) {
            alert('请先添加商品');
            return;
        }
        try {
            domtoimage.toPng(receiptEl, {
                width: receiptEl.scrollWidth,
                height: receiptEl.scrollHeight,
                scale: 2,
                style: { margin: '0' }
            }).then((dataUrl) => {
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = '开单_' + currentOrderNo + '.png';
                a.click();
            }).catch((err) => {
                console.error(err);
                alert('导出图片失败，请重试');
            });
        } catch (e) {
            alert('导出失败，请确认已正确引入 dom-to-image 库');
        }
    });

    // ===== 店铺配置 =====
    function fillSettingsForm() {
        sShop.value = settings.shop || '';
        sWarehouse.value = settings.warehouse || '';
        sOperator.value = settings.operator || '';
        sAddress.value = settings.address || '';
        sPhone.value = settings.phone || '';
    }

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        settings = {
            shop: sShop.value.trim(),
            warehouse: sWarehouse.value.trim(),
            operator: sOperator.value.trim(),
            address: sAddress.value.trim(),
            phone: sPhone.value.trim(),
        };
        saveJSON(KEY_SETTINGS, settings);
        alert('配置已保存');
    });

    // ===== 初始化 =====
    renderTemplateList();
    fillSettingsForm();
    // 初始显示首页
    switchView('view-home');
})();
