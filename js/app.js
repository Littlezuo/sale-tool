(function () {
    'use strict';

    // ===== 存储键 =====
    const KEY_PRODUCTS = 'sale-tool.products';
    const KEY_SETTINGS = 'sale-tool.settings';
    const KEY_SEQ = 'sale-tool.seq';

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
        const units = ['', '拾', '佰', '仟'];
        const bigUnits = ['', '万', '亿', '兆'];
        const intPart = Math.floor(num);
        const decimals = Math.round((num - intPart) * 100);

        const intStr = String(intPart);
        if (intStr === '0' && decimals === 0) return '零元整';

        function sectionToChinese(s) {
            let result = '';
            for (let i = 0; i < s.length; i++) {
                const d = parseInt(s[i], 10);
                const u = units[s.length - 1 - i];
                if (d === 0) {
                    if (result && result[result.length - 1] !== '零') result += '零';
                } else {
                    result += digits[d] + u;
                }
            }
            return result.replace(/零+$/, '');
        }

        let intChinese = '';
        if (intPart > 0) {
            const groups = [];
            let s = intStr;
            while (s.length > 0) {
                groups.unshift(s.slice(-4));
                s = s.slice(0, -4);
            }
            for (let i = 0; i < groups.length; i++) {
                const g = sectionToChinese(groups[i]);
                if (g) {
                    intChinese += g + bigUnits[groups.length - 1 - i];
                } else if (intChinese && intChinese[intChinese.length - 1] !== '零') {
                    intChinese += '零';
                }
            }
        }

        let result = intChinese ? intChinese + '元' : '';
        if (decimals === 0) {
            result += '整';
        } else {
            const jiao = Math.floor(decimals / 10);
            const fen = decimals % 10;
            if (jiao > 0) result += digits[jiao] + '角';
            if (fen > 0) result += digits[fen] + '分';
        }
        return result;
    }

    // ===== 数据模型 =====
    let products = loadJSON(KEY_PRODUCTS, []);
    let settings = loadJSON(KEY_SETTINGS, {
        shop: '', warehouse: '', operator: '', address: '', phone: ''
    });
    let seq = loadJSON(KEY_SEQ, 1);

    // 当前开单明细：{ id, productId, code, name, unit, price, qty, note }
    let orderLines = [];

    // 当前正在编辑的商品 id（null 表示新建）
    let editingProductId = null;

    // ===== DOM 引用 =====
    const $ = (sel) => document.querySelector(sel);

    // 导航
    const menuBtn = $('#menu-btn');
    const menuDrawer = $('#menu-drawer');
    const menuMask = $('#menu-mask');
    const menuItems = document.querySelectorAll('.menu-item');
    const topbarTitle = $('#topbar-title');
    const views = {
        'view-order': $('#view-order'),
        'view-products': $('#view-products'),
        'view-settings': $('#view-settings'),
    };
    const VIEW_TITLES = {
        'view-order': '开单',
        'view-products': '商品管理',
        'view-settings': '店铺配置',
    };

    // 开单
    const btnOpenPicker = $('#btn-open-picker');
    const drawer = $('#drawer');
    const drawerMask = $('#drawer-mask');
    const drawerSearch = $('#drawer-search');
    const drawerList = $('#drawer-list');
    const drawerClose = $('#drawer-close');
    const drawerAddProduct = $('#drawer-add-product');
    const orderLinesEl = $('#order-lines');
    const emptyTip = $('#empty-tip');
    const totalAmount = $('#total-amount');
    const btnReset = $('#btn-reset');
    const receiptEl = $('#receipt');
    const btnExport = $('#btn-export');
    const customerNameInput = $('#customer-name');
    const orderNoteInput = $('#order-note');

    // 商品管理
    const productForm = $('#product-form');
    const pId = $('#p-id');
    const pCode = $('#p-code');
    const pName = $('#p-name');
    const pUnit = $('#p-unit');
    const pPrice = $('#p-price');
    const btnSaveProduct = $('#btn-save-product');
    const btnCancelEdit = $('#btn-cancel-edit');
    const productListEl = $('#product-list');
    const productCount = $('#product-count');
    const productFilter = $('#product-filter');

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
        topbarTitle.textContent = VIEW_TITLES[name] || '开单';
        closeMenu();
        // 切到商品/配置时刷新数据
        if (name === 'view-products') renderProductList();
        if (name === 'view-settings') fillSettingsForm();
        if (name === 'view-order') renderReceipt();
    }

    function openMenu() {
        menuDrawer.classList.add('open');
        menuMask.classList.add('show');
    }
    function closeMenu() {
        menuDrawer.classList.remove('open');
        menuMask.classList.remove('show');
    }

    menuBtn.addEventListener('click', openMenu);
    menuMask.addEventListener('click', closeMenu);
    menuItems.forEach((item) => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });

    // ===== 商品管理 =====
    function renderProductList() {
        const filter = productFilter.value.trim().toLowerCase();
        const list = products.filter((p) => {
            if (!filter) return true;
            return (p.code || '').toLowerCase().includes(filter) ||
                (p.name || '').toLowerCase().includes(filter);
        });

        productCount.textContent = products.length;
        productListEl.innerHTML = '';

        if (list.length === 0) {
            const li = document.createElement('li');
            li.className = 'empty-tip';
            li.textContent = products.length === 0 ? '暂无商品，请先录入' : '没有匹配的商品';
            productListEl.appendChild(li);
            return;
        }

        list.forEach((p) => {
            const li = document.createElement('li');
            li.className = 'product-item';

            const info = document.createElement('div');
            info.className = 'product-item-info';
            info.innerHTML =
                '<div class="product-item-name"></div>' +
                '<div class="product-item-meta"></div>';
            info.querySelector('.product-item-name').textContent = p.name;
            info.querySelector('.product-item-meta').textContent =
                (p.code ? '编号: ' + p.code + '  ·  ' : '') +
                (p.unit ? '单位: ' + p.unit + '  ·  ' : '') +
                '单价: ¥' + fmtMoney(p.price);

            const actions = document.createElement('div');
            actions.className = 'product-item-actions';

            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn btn-ghost';
            btnEdit.textContent = '编辑';
            btnEdit.addEventListener('click', () => startEdit(p));

            const btnDel = document.createElement('button');
            btnDel.className = 'btn btn-danger';
            btnDel.textContent = '删除';
            btnDel.addEventListener('click', () => deleteProduct(p.id));

            actions.appendChild(btnEdit);
            actions.appendChild(btnDel);

            li.appendChild(info);
            li.appendChild(actions);
            productListEl.appendChild(li);
        });
    }

    function resetProductForm() {
        editingProductId = null;
        pId.value = '';
        pCode.value = '';
        pName.value = '';
        pUnit.value = '';
        pPrice.value = '';
        btnSaveProduct.textContent = '保存商品';
        btnCancelEdit.style.display = 'none';
    }

    function startEdit(p) {
        editingProductId = p.id;
        pId.value = p.id;
        pCode.value = p.code || '';
        pName.value = p.name || '';
        pUnit.value = p.unit || '';
        pPrice.value = p.price != null ? p.price : '';
        btnSaveProduct.textContent = '更新商品';
        btnCancelEdit.style.display = 'inline-block';
    }

    function deleteProduct(id) {
        const p = products.find((x) => x.id === id);
        if (!p) return;
        if (!confirm('确定删除商品「' + p.name + '」吗？')) return;
        products = products.filter((x) => x.id !== id);
        saveJSON(KEY_PRODUCTS, products);
        renderProductList();
    }

    productForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = pCode.value.trim();
        const name = pName.value.trim();
        const unit = pUnit.value.trim();
        const price = parseFloat(pPrice.value);

        if (!name) { alert('请填写商品名称'); return; }
        if (isNaN(price) || price < 0) { alert('请填写正确的单价'); return; }

        if (editingProductId) {
            const p = products.find((x) => x.id === editingProductId);
            if (p) {
                p.code = code; p.name = name; p.unit = unit; p.price = price;
            }
        } else {
            products.push({
                id: genId(), code: code, name: name, unit: unit, price: price
            });
        }

        saveJSON(KEY_PRODUCTS, products);
        resetProductForm();
        renderProductList();
    });

    btnCancelEdit.addEventListener('click', resetProductForm);
    productFilter.addEventListener('input', renderProductList);

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

    // ===== 开单：抽屉选商品 =====
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
        // 空关键词展示全部（常用），有则过滤
        const list = kw
            ? products.filter((p) =>
                (p.code || '').toLowerCase().includes(kw) ||
                (p.name || '').toLowerCase().includes(kw)
            )
            : products;

        drawerList.innerHTML = '';

        if (list.length === 0) {
            const li = document.createElement('li');
            li.className = 'drawer-empty';
            li.textContent = kw ? '没有匹配的商品' : '暂无商品，请先新增';
            drawerList.appendChild(li);
            return;
        }

        list.forEach((p) => {
            const li = document.createElement('li');
            li.className = 'drawer-item';

            // 左侧：商品信息
            const info = document.createElement('div');
            info.className = 'drawer-item-info';
            info.innerHTML =
                '<div class="drawer-item-name">' + escapeHtml(p.name) + '</div>' +
                '<div class="drawer-item-meta">' +
                    (p.code ? escapeHtml(p.code) + ' · ' : '') +
                    escapeHtml(p.unit || '-') + ' · ¥' + fmtMoney(p.price) +
                '</div>';

            // 判断该商品是否已在明细中
            const existing = orderLines.find((l) => l.productId === p.id);

            if (!existing) {
                // 未选状态：只显示「＋」
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'qty-btn qty-btn-add';
                addBtn.textContent = '＋';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    addLine(p, 1);
                });
                li.appendChild(info);
                li.appendChild(addBtn);
                drawerList.appendChild(li);
                return;
            }

            // 已选状态：显示「− 数量 ＋」
            const qtyBox = document.createElement('div');
            qtyBox.className = 'qty-box qty-box-sm';

            const minusBtn = document.createElement('button');
            minusBtn.type = 'button';
            minusBtn.className = 'qty-btn';
            minusBtn.textContent = '−';
            minusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const next = existing.qty - 1;
                if (next <= 0) {
                    // 减到 0：从明细移除
                    removeLine(existing.id);
                } else {
                    existing.qty = next;
                    renderOrderLines();
                    renderDrawerList();
                }
            });

            const qtyInput = document.createElement('input');
            qtyInput.type = 'number';
            qtyInput.className = 'qty-input';
            qtyInput.min = '1';
            qtyInput.step = '1';
            qtyInput.value = existing.qty;
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
                // 局部更新输入框
                qtyInput.value = existing.qty;
            });

            qtyBox.appendChild(minusBtn);
            qtyBox.appendChild(qtyInput);
            qtyBox.appendChild(plusBtn);

            li.appendChild(info);
            li.appendChild(qtyBox);
            drawerList.appendChild(li);
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function addLine(product, qty) {
        qty = qty || 1;
        // 若同一商品已存在，则数量累加
        const exist = orderLines.find((l) => l.productId === product.id);
        if (exist) {
            exist.qty += qty;
        } else {
            orderLines.push({
                id: genId(),
                productId: product.id,
                code: product.code,
                name: product.name,
                unit: product.unit,
                price: product.price,
                qty: qty,
                note: ''
            });
        }
        renderOrderLines();
        // 若抽屉打开，刷新抽屉以同步「＋/−」状态
        if (drawer.classList.contains('open')) renderDrawerList();
    }

    function removeLine(id) {
        orderLines = orderLines.filter((l) => l.id !== id);
        renderOrderLines();
        // 若抽屉打开，刷新抽屉以同步「＋/−」状态
        if (drawer.classList.contains('open')) renderDrawerList();
    }

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
            const meta = document.createElement('div');
            meta.className = 'line-meta';
            meta.textContent = (line.code ? line.code + ' · ' : '') +
                '¥' + fmtMoney(line.price) + '/' + (line.unit || '-');
            info.appendChild(name);
            info.appendChild(meta);

            const right = document.createElement('div');
            right.className = 'line-right';
            const amount = document.createElement('div');
            amount.className = 'line-amount';
            amount.textContent = '¥' + fmtMoney(line.price * line.qty);
            const del = document.createElement('button');
            del.className = 'line-del';
            del.innerHTML = '&times;';
            del.title = '删除该行';
            del.addEventListener('click', () => {
                removeLine(line.id);
            });
            right.appendChild(amount);
            right.appendChild(del);

            topRow.appendChild(info);
            topRow.appendChild(right);

            // 第二行：数量 + 备注
            const bottomRow = document.createElement('div');
            bottomRow.className = 'line-bottom';

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
            // 输入时仅更新金额，不重建 DOM，保证连续输入 21 光标不丢失
            qtyInput.addEventListener('input', () => {
                const raw = qtyInput.value;
                const v = parseInt(raw, 10);
                const current = isNaN(v) || v <= 0 ? 1 : v;
                line.qty = current;
                // 更新本行金额显示
                const amt = row.querySelector('.line-amount');
                if (amt) amt.textContent = '¥' + fmtMoney(line.price * current);
                updateTotal();
                renderReceipt();
            });
            // 失焦时校验并清空非法值
            qtyInput.addEventListener('blur', () => {
                const v = parseInt(qtyInput.value, 10);
                if (isNaN(v) || v <= 0) {
                    line.qty = 1;
                } else {
                    line.qty = v;
                }
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
        // 头部：店铺名 + 录单日期 + 单号
        html += '<div class="r-head">';
        if (hasShop) html += '<div class="r-shop">' + escapeHtml(settings.shop) + '</div>';
        html += '<div class="r-head-meta">';
        html += '<span>录单日期：' + escapeHtml(fmtDateOnly(currentOrderTime)) + '</span>';
        html += '<span>单据编号：' + escapeHtml(currentOrderNo) + '</span>';
        html += '</div>';
        html += '</div>';

        // 客户信息
        html += '<div class="r-info-row">';
        html += '<span>客户名称：' + escapeHtml(customerName || '-') + '</span>';
        html += '</div>';

        // 整单备注（客户名称下方）
        if (orderNote) {
            html += '<div class="r-order-note">备注：' + escapeHtml(orderNote) + '</div>';
        }

        // 表格：序号 / 编号 / 商品名称 / 数量 / 单位 / 单价 / 金额 / 备注
        html += '<table class="r-table">';
        html += '<thead><tr>' +
            '<th class="r-num">序号</th>' +
            '<th class="r-code">编号</th>' +
            '<th class="r-name-col">商品名称</th>' +
            '<th class="r-qty">数量</th>' +
            '<th class="r-unit">单位</th>' +
            '<th class="r-price">单价</th>' +
            '<th class="r-subtotal">金额</th>' +
            '<th class="r-note-col">备注</th>' +
            '</tr></thead>';
        html += '<tbody>';
        if (orderLines.length === 0) {
            html += '<tr><td colspan="8" style="text-align:center;color:#999;">暂无商品</td></tr>';
        } else {
            orderLines.forEach((l, i) => {
                html += '<tr>' +
                    '<td class="r-num">' + (i + 1) + '</td>' +
                    '<td class="r-code">' + escapeHtml(l.code || '-') + '</td>' +
                    '<td class="r-name-col">' + escapeHtml(l.name) + '</td>' +
                    '<td class="r-qty">' + l.qty + '</td>' +
                    '<td class="r-unit">' + escapeHtml(l.unit || '-') + '</td>' +
                    '<td class="r-price">' + fmtMoney(l.price) + '</td>' +
                    '<td class="r-subtotal">' + fmtMoney(l.price * l.qty) + '</td>' +
                    '<td class="r-note-col">' + escapeHtml(l.note || '') + '</td>' +
                    '</tr>';
            });
        }
        html += '</tbody></table>';

        // 合计，含大写金额
        html += '<div class="r-summary">';
        html += '<div class="r-summary-line">合计金额：¥' + fmtMoney(total) + ' 元</div>';
        html += '<div class="r-summary-line r-summary-cap">大写：' + escapeHtml(amountToChinese(total)) + '</div>';
        html += '</div>';

        // 底部落款：第一行 制单人 + 联系方式，第二行 地址
        html += '<div class="r-footer">';
        html += '<div class="r-footer-row">';
        html += '<span>制单人：' + escapeHtml(settings.operator || '-') + '</span>';
        html += '<span>联系电话：' + escapeHtml(settings.phone || '-') + '</span>';
        html += '</div>';
        html += '<div>地址：' + escapeHtml(settings.address || '-') + '</div>';
        html += '</div>';

        receiptEl.innerHTML = html;
    }

    btnOpenPicker.addEventListener('click', openDrawer);
    drawerClose.addEventListener('click', closeDrawer);
    drawerMask.addEventListener('click', closeDrawer);
    drawerSearch.addEventListener('input', renderDrawerList);
    drawerAddProduct.addEventListener('click', () => {
        closeDrawer();
        switchView('view-products');
        setTimeout(() => pCode.focus(), 150);
    });

    customerNameInput.addEventListener('input', renderReceipt);
    orderNoteInput.addEventListener('input', renderReceipt);

    btnReset.addEventListener('click', () => {
        if (orderLines.length > 0 && !confirm('确定清空当前开单吗？')) return;
        orderLines = [];
        currentOrderNo = null;
        currentOrderTime = null;
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
                style: {
                    margin: '0'
                }
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

    // ===== 初始化 =====
    resetProductForm();
    btnCancelEdit.style.display = 'none';
    renderOrderLines();
    fillSettingsForm();
})();
