/* =====================================================================
 A P*P — UI, отрисовка, главный цикл
 ===================================================================== */
"use strict";
(function() {
    const DEG = Math.PI / 180;
    const COLS = 9, ROWS = 6, CELL = 28;
    const RL = ['А','Б','В','Г','Д','Е'];   // было ['A','B','C','D','E','F']

    /* ===== Геометрия полигона по ЕТЗ 2026–27 (картинка 1) =====
     *  Полигон 600×500. Зона 1 слева 350×500. Правая колонка 250:
     *  зона2 низ 80 | зазор 5 | поле 330 | зазор 5 | зона2 верх 80.
     *  Лист А4 (210×297) кладётся ПОРТРЕТОМ в поле 250×330,
     *  поэтому сетка тоже портретная: строки по X, столбцы по Y.
     *  O (метка 27) — правый нижний угол листа; ось X вверх, ось Y влево. */
    const POLY_W = 600, POLY_H = 500;
    const ZONE1_W = 350, ZONE2_W = 250, ZONE2_H = 80;
    const FIELD_W = 250, FIELD_H = 330, GAP = 5;
    const PX0 = -ZONE1_W, PY0 = 0;                 // полигон X[-350..250], Y[0..500]
    const FX0 = PX0 + ZONE1_W;                     // 0   — левый край поля
    const FY0 = PY0 + ZONE2_H + GAP;               // 85  — нижний край поля
    const SHEET_W = 210, SHEET_H = 297;
    const LX0 = FX0 + (FIELD_W - SHEET_W) / 2;     // 20  — левый край листа
    const LY0 = FY0 + (FIELD_H - SHEET_H) / 2;     // 101.5 — нижний край листа
    const OX = LX0 + SHEET_W;                      // 230 — правый край листа = X метки 27
    const OY = LY0 + 14.5;                         // 116 — метка 27 у правого нижнего угла

    /* локальные координаты поля (u = столбец*28, v = строка*28) → мировые */
    function W(u, v) { return { x: OX - v, y: OY + u }; }

    const CELLS = [];
    for (let n = 0; n < COLS; n++)                 // столбцы 0..8
        for (let k = 1; k <= ROWS; k++) {          // строки А..Е (1..6)
            const p = W(n * CELL, k * CELL);
            CELLS.push({ id: RL[k-1] + n, x: p.x, y: p.y, discard: false });
        }
        for (let k = 1; k <= 5; k++) {                 // столбец отбоя 9, строки А..Д
            const p = W(COLS * CELL, k * CELL);        // u = 252
            CELLS.push({ id: RL[k-1] + '9', col: 9, row: k-1, x: p.x, y: p.y, discard: true });
        }

    /* Мотор */
    const MOTOR = { tau_stall: 0.16, omega_zero: 30 };

    let Kin = Kin5R;

    /* Общее состояние */
    const state = {
        q1: -45*DEG, q2: -45*DEG,
 w1: 0, w2: 0,
 targetQ1: -45*DEG, targetQ2: -45*DEG,
 mode: -1, tau1: 0, tau2: 0,
 selected: null, settled: true,
 showWorkspace: false, showSing: false, showCells: true, showSag: true,
 zoom: 1.0,
 alpha1: 0, alpha2: 0,
 cap: null,
 reach: { ok: 0, total: 0 },     // достижимость клеток (ЕТЗ покрытие поля)
peakVSession: 0,                // макс |v| за сессию, мм/с (проверка ≥100)
hudCollapsed: false
    };
    const path = { active:false, sx:0, sy:0, ex:0, ey:0,
        progress:0, len:0, speed:180, blocked:false };

        /* Центр полигона X[-350..250] = -50, Y[0..500] = 250 */
        const VIEW = { w: 720, h: 620, cx: -50, cy: 250 };

        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.getElementById('svg');
        const gPolygon = document.getElementById('g-polygon');
        const gSing = document.getElementById('g-sing');
        const gGrid = document.getElementById('g-grid');
        const gWs = document.getElementById('g-ws');
        const gSel = document.getElementById('g-sel');
        const gArm = document.getElementById('g-arm');

        /* Жёсткий Z-порядок слоёв, снизу вверх:
         п олигон → сетка → рабочая зона → выделение → СИНГУЛЯРНОС*ТИ → рука.
         appendChild перемещает узел в конец родителя, поэтому последовательный
         обход в этом порядке выстраивает DOM ровно так, как нужно, НЕЗАВИСИМО
         от исходного порядка <g> в index.html. Сингулярности теперь поверх
         клеток/зон/выделения, но ПОД балками и моторами (gArm — последний). */
        for (const el of [gPolygon, gGrid, gWs, gSel, gSing, gArm])
            if (el && el.parentNode) el.parentNode.appendChild(el);

        function add(tag, attrs, parent) {
            const e = document.createElementNS(NS, tag);
            for (const k in attrs) e.setAttribute(k, attrs[k]);
            parent.appendChild(e);
            return e;
        }

        /* UI refs */
        const $q1r=document.getElementById('q1-range'), $q1n=document.getElementById('q1-num');
        const $q2r=document.getElementById('q2-range'), $q2n=document.getElementById('q2-num');
        const $q1v=document.getElementById('q1-val'), $q2v=document.getElementById('q2-val');
        const $q1L=document.getElementById('q1-label'), $q2L=document.getElementById('q2-label');
        const $cellSel=document.getElementById('cell-select'), $home=document.getElementById('home-btn');
        const $chkWs=document.getElementById('chk-workspace'), $chkSing=document.getElementById('chk-sing');
        const $chkCells=document.getElementById('chk-cells'), $chkSag=document.getElementById('chk-sag');
        const $zoom=document.getElementById('zoom-range'), $zoomVal=document.getElementById('zoom-val');
        const $schHint=document.getElementById('sch-hint');
        const $hud=document.getElementById('hud');
        const $hudToggle=document.getElementById('hud-toggle');
        const $hudChev=document.getElementById('hud-chev');
        const $hudDot=document.getElementById('hud-dot');
        const $hudMini=document.getElementById('hud-mini');
        const $hudStats=document.getElementById('hud-stats');
        const $status=document.getElementById('status'); // legacy, может отсутствовать

        /* Синхронизация: состояния (SI) → слоты UI */
        function toDisplay(i, qSI) {
            if (Kin.jointTypes[i] === 'R') return Kin.qToDisplay(i, qSI);
            return Kin.qToDisplay(i, qSI * 1000);  // m → mm
        }
        function fromDisplay(i, d) {
            const qk = Kin.displayToQ(i, d);       // rad или mm
            return Kin.jointTypes[i] === 'R' ? qk : qk / 1000;  // mm → m
        }

        /* ---------- Отрисовка ---------- */
        function updateViewBox() {
            const w = VIEW.w / state.zoom, h = VIEW.h / state.zoom;
            const x0 = VIEW.cx - w/2, y0 = -VIEW.cy - h/2;
            svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
        }


        function renderPolygon() {
            const gPoly = document.getElementById('g-polygon');
            if (!gPoly) return;
            gPoly.innerHTML = '';

            const RX0 = FX0;                          // 0 — левый край правой колонки
            const Z2_LOW_Y  = PY0;                    // 0   — низ зоны2
            const FIELD_Y0  = FY0;                    // 85  — низ поля
            const Z2_HIGH_Y = PY0 + POLY_H - ZONE2_H; // 420 — низ верхней зоны2

            const rect = (x, y, w, h, st) => add('rect',
                                                 { x, y: -(y + h), width: w, height: h, ...st }, gPoly);
            const label = (x, y, s, sz, f) => {
                const t = add('text', { x, y: -y, 'text-anchor': 'middle',
                    'font-size': sz, 'font-weight': 'bold',
                    'font-family': 'system-ui, sans-serif', fill: f }, gPoly);
                t.textContent = s; return t;
            };

            /* фон всего полигона (чтобы зазоры 5 мм были видны как на эталоне) */
            rect(PX0, PY0, POLY_W, POLY_H, { fill: '#d7dae2', stroke: 'none' });

            /* зона 1 — 350×500, самая светлая */
            rect(PX0, PY0, ZONE1_W, POLY_H, { fill: '#e9ebf1', stroke: '#8a93a8', 'stroke-width': 0.8 });

            /* зона 2 — нижняя полоса 250×80 */
            rect(RX0, Z2_LOW_Y,  ZONE2_W, ZONE2_H, { fill: '#c8cf95', stroke: '#8a93a8', 'stroke-width': 0.8 });
            /* зона 2 — верхняя полоса 250×80 */
            rect(RX0, Z2_HIGH_Y, ZONE2_W, ZONE2_H, { fill: '#c8cf95', stroke: '#8a93a8', 'stroke-width': 0.8 });

            /* область операционного поля 250×330 */
            rect(RX0, FIELD_Y0, FIELD_W, FIELD_H, { fill: '#f6ea9c', stroke: '#b9a244', 'stroke-width': 1 });

            /* внешняя рамка полигона 600×500 */
            rect(PX0, PY0, POLY_W, POLY_H, { fill: 'none', stroke: '#2a3040', 'stroke-width': 2 });

            /* подписи */
            label(PX0 + ZONE1_W/2, PY0 + POLY_H/2, 'ЗОНА 1', 34, 'rgba(120,130,150,0.4)');
            label(RX0 + ZONE2_W/2, Z2_LOW_Y  + ZONE2_H/2, 'ЗОНА 2', 18, 'rgba(60,80,50,0.65)');
            label(RX0 + ZONE2_W/2, Z2_HIGH_Y + ZONE2_H/2, 'ЗОНА 2', 18, 'rgba(60,80,50,0.65)');
            label(RX0 + FIELD_W/2, FIELD_Y0 + FIELD_H/2, 'ОПЕРАЦИОННОЕ ПОЛЕ', 13, 'rgba(120,100,20,0.4)');
        }

        /* ============================================================
        Отрисовка операционного поля по ЕТЗ:
        - белый лист-подложка
        - чёрные полосы 6 мм слева и сверху сетки
        - сетка 9×6 клеток 28×28 с красными разделителями
        - чёрная точка Ø 6 мм и зелёная пунктирная окружность Ø 24.5 мм
        - столбец отбоя (5 клеток, строки A..E)
        - подписи строк (A..E) справа и столбцов (0..8) снизу
        - метки ArUco: id 27 (origin), id 28, id 29
        - стрелки осей X, Y и подпись O
        - красноватая подсветка недостижимых клеток
        ============================================================ */
        function renderGrid() {
            gGrid.innerHTML = '';
            if (!state.showCells) return;
            const half = CELL / 2, barW = 6, dotR = 3, circR = 12.25;

            /* 1. белый лист А4 портретом */
            add('rect', { x: LX0, y: -(LY0 + SHEET_H), width: SHEET_W, height: SHEET_H,
                fill: '#ffffff', stroke: '#cccccc', 'stroke-width': 0.4 }, gGrid);

            /* 2. чёрные полосы 6 мм слева и снизу сетки (L-рамка как на эталоне) */
            const gridXL = OX - ROWS*CELL - half;     // левая граница сетки по X
            const gridXR = OX - half;                 // правая граница (строка А)
const gridYB = OY - half;                 // нижняя граница (столбец 0)
const gridYT = OY + (COLS-1)*CELL + half; // верхняя граница (столбец 8)
add('rect', { x: gridXL - barW, y: -gridYT, width: barW, height: gridYT - gridYB, fill: '#000' }, gGrid);
add('rect', { x: gridXL - barW, y: -(gridYB), width: (gridXR - gridXL) + barW, height: barW, fill: '#000' }, gGrid);

/* 3. клетки 9×6 */
for (let n = 0; n < COLS; n++) for (let k = 1; k <= ROWS; k++) {
    const p = W(n*CELL, k*CELL);
    add('rect', { x: p.x-half, y: -(p.y+half), width: CELL, height: CELL,
        fill: 'none', stroke: '#c83030', 'stroke-width': 0.35 }, gGrid);
    add('circle', { cx: p.x, cy: -p.y, r: dotR, fill: '#000' }, gGrid);
    add('circle', { cx: p.x, cy: -p.y, r: circR, fill: 'none',
        stroke: '#2a9d5a', 'stroke-width': 0.5, 'stroke-dasharray': '2 1.6' }, gGrid);
}

/* 4. столбец отбоя (u=252) — горизонтальный ряд вверху */
const du = COLS * CELL;
for (let k = 1; k <= 5; k++) {
    const p = W(du, k*CELL);
    if (k > 1) {
        const q = W(du, (k-1)*CELL);
        add('line', { x1: p.x-half, y1: -(p.y-half), x2: q.x-half, y2: -(q.y-half),
            stroke: '#c83030', 'stroke-width': 0.35 }, gGrid);
    }
    add('circle', { cx: p.x, cy: -p.y, r: circR, fill: 'none',
        stroke: '#2a9d5a', 'stroke-width': 0.5, 'stroke-dasharray': '2 1.6' }, gGrid);
}

/* 5. подписи: буквы строк снизу (по X), цифры столбцов справа (по Y) */
for (let k = 1; k <= ROWS; k++) {
    const p = W(0, k*CELL);
    const t = add('text', { x: p.x, y: -(LY0 - 8) + 2, 'text-anchor': 'middle',
        'font-size': 6, 'font-family': 'ui-monospace, monospace', fill: '#333' }, gGrid);
    t.textContent = RL[k-1];
}
for (let n = 0; n < COLS; n++) {
    const p = W(n*CELL, 0);
    const t = add('text', { x: OX + 8, y: -p.y + 2, 'text-anchor': 'start',
        'font-size': 6, 'font-family': 'ui-monospace, monospace', fill: '#333' }, gGrid);
    t.textContent = String(n);
}

/* 6. метки ArUco: 27 = O (правый низ), 28 (правый верх), 29 (левый верх, отбой/Е) */
drawArUco(gGrid, OX,        OY,            27);
drawArUco(gGrid, OX,        OY + (COLS-1)*CELL, 28);
drawArUco(gGrid, OX - ROWS*CELL, OY + COLS*CELL, 29);

/* 7. оси от O: X вверх, Y влево */
add('line', { x1: OX, y1: -OY, x2: OX,        y2: -(OY+42),
    stroke: '#2050ff', 'stroke-width': 0.8, 'marker-end': 'url(#arrow-x)' }, gGrid);
add('line', { x1: OX, y1: -OY, x2: OX-42,     y2: -OY,
    stroke: '#2050ff', 'stroke-width': 0.8, 'marker-end': 'url(#arrow-y)' }, gGrid);
let tx = add('text', { x: OX+6,  y: -(OY+46), 'font-size': 6, 'font-weight': 'bold',
    'font-family': 'ui-monospace, monospace', fill: '#2050ff' }, gGrid); tx.textContent = 'X';
    let ty = add('text', { x: OX-46, y: -OY+2, 'text-anchor': 'middle', 'font-size': 6,
        'font-weight': 'bold', 'font-family': 'ui-monospace, monospace', fill: '#2050ff' }, gGrid); ty.textContent = 'Y';
        let to = add('text', { x: OX+10, y: -OY+8, 'font-size': 6, 'font-weight': 'bold',
            'font-family': 'ui-monospace, monospace', fill: '#2050ff' }, gGrid); to.textContent = 'O';

            /* 8. подсветка недостижимых клеток */
            for (const c of CELLS) {
                if (Kin.inverseAll(c.x, c.y, { mode: state.mode }).length) continue;
                add('rect', { x: c.x-half, y: -(c.y+half), width: CELL, height: CELL,
                    fill: 'rgba(255,60,60,0.18)', stroke: 'none' }, gGrid);
            }
        }

        /* Мини-отрисовка метки ArUco: чёрный квадрат с белым узором */
        function drawArUco(parent, cx, cy, id) {
            const s = 18;   // 18 × 18 мм по ЕТЗ
            add('rect', {
                x: cx - s/2, y: -(cy + s/2),
                width: s, height: s,
                fill: '#000000'
            }, parent);
            // Упрощённый узор — небольшой белый квадрат в центре
            add('rect', {
                x: cx - s/4, y: -(cy + s/4),
                width: s/2, height: s/2,
                fill: '#ffffff'
            }, parent);
            const t = add('text', {
                x: cx, y: -cy + 2,
                'text-anchor': 'middle',
                'font-size': 4,
                'font-family': 'ui-monospace, monospace',
                'font-weight': 'bold',
                fill: '#000000'
            }, parent);
            t.textContent = String(id);
        }

        function renderSelection() {
            gSel.innerHTML = '';
            if (!state.selected) return;
            const c = state.selected;
            add('rect', {
                x: c.x - CELL/2, y: -(c.y + CELL/2), width: CELL, height: CELL, rx: 2,
                fill: 'rgba(255,165,0,0.14)', stroke: '#ffa500', 'stroke-width': 1.6
            }, gSel);
        }

        function renderWorkspace() {
            gWs.innerHTML = '';
            if (!state.showWorkspace) return;
            const h = Kin.hull(CELLS.map(c => ({ x: c.x, y: c.y })));
            if (!h || h.length < 2) return;
            const d = h.map((p, i) => `${i?'L':'M'}${p.x} ${-p.y}`).join(' ') + ' Z';
            add('path', { d, fill: 'rgba(74,134,255,0.16)',
                stroke: '#4a86ff', 'stroke-width': 1.5 }, gWs);
        }

        const SING_STEP = 8;
        let singCells = [];
        function computeSingularity() {
            singCells = [];
            for (let x = FX0; x < FX0 + FIELD_W; x += SING_STEP) {
                for (let y = FY0; y < FY0 + FIELD_H; y += SING_STEP) {
                    const sols = Kin.inverseAll(x + SING_STEP/2, y + SING_STEP/2,
                                                { mode: state.mode });
                    if (!sols.length) continue;
                    const t = Math.min(1, (sols[0].safety || 1) / 0.45);
                    singCells.push({
                        x, y, w: SING_STEP, h: SING_STEP,
                        color: `hsl(${(120*t).toFixed(1)},85%,52%)`
                    });
                }
            }
        }
        function renderSingularity() {
            gSing.innerHTML = '';
            if (!state.showSing) return;
            const frag = document.createDocumentFragment();
            for (const s of singCells) {
                const r = document.createElementNS(NS, 'rect');
                r.setAttribute('x', s.x);
                r.setAttribute('y', -(s.y + s.h));
                r.setAttribute('width', s.w);
                r.setAttribute('height', s.h);
                r.setAttribute('fill', s.color);
                r.setAttribute('opacity', '0.35');
                frag.appendChild(r);
            }
            gSing.appendChild(frag);
        }

        function renderArm() {
            gArm.innerHTML = '';
            const q1k = Kin.jointTypes[0]==='R' ? state.q1 : state.q1 * 1000;
            const q2k = Kin.jointTypes[1]==='R' ? state.q2 : state.q2 * 1000;
            const f = Kin.forward(q1k, q2k, state.mode);

            const k = Kin.kind;

            /* Отрисовка рельсов для P-шарниров */
            function drawRail(P, angleDeg, smin, smax) {
                const a = angleDeg * DEG;
                add('line', {
                    x1: P.x + smin*Math.cos(a), y1: -(P.y + smin*Math.sin(a)),
                    x2: P.x + smax*Math.cos(a), y2: -(P.y + smax*Math.sin(a)),
                    stroke: '#6a5a7a', 'stroke-width': 3, 'stroke-dasharray': '4 3'
                }, gArm);
            }

            /* База */
            if (Kin.cfg.P2 && (k === '5R')) {
                add('line', {
                    x1: Kin.cfg.P1.x, y1: -Kin.cfg.P1.y,
                    x2: Kin.cfg.P2.x, y2: -Kin.cfg.P2.y,
                    stroke: '#55618c', 'stroke-width': 6, 'stroke-linecap': 'round'
                }, gArm);
            }
            if (k === 'RP') {
                // рисуем вращающуюся рейку от P1 в направлении текущего q1
                const q1k = state.q1;   // радианы
                const ux = Math.cos(q1k), uy = Math.sin(q1k);
                add('line', {
                    x1: Kin.cfg.P1.x + Kin.cfg.s_min * ux,
                    y1: -(Kin.cfg.P1.y + Kin.cfg.s_min * uy),
                    x2: Kin.cfg.P1.x + Kin.cfg.s_max * ux,
                    y2: -(Kin.cfg.P1.y + Kin.cfg.s_max * uy),
                    stroke: '#6a5a7a', 'stroke-width': 3, 'stroke-dasharray': '4 3'
                }, gArm);
            }
            if (k === 'PP') {
                drawRail(Kin.cfg.P1, Kin.cfg.rail1_angle, Kin.cfg.s1_min, Kin.cfg.s1_max);
                drawRail(Kin.cfg.P2, Kin.cfg.rail2_angle, Kin.cfg.s2_min, Kin.cfg.s2_max);
            }

            /* Ведущие звенья */
            if (Kin.jointTypes[0] === 'R') {
                add('line', {
                    x1: Kin.cfg.P1.x, y1: -Kin.cfg.P1.y,
                    x2: f.A.x, y2: -f.A.y,
                    stroke: '#3d8bfd', 'stroke-width': 5, 'stroke-linecap': 'round'
                }, gArm);
            } else {
                /* P: каретка 1 — синяя точка */
                add('circle', {
                    cx: f.A.x, cy: -f.A.y, r: 5,
                    fill: '#3d8bfd', stroke: '#1a1a2e', 'stroke-width': 1
                }, gArm);
            }
            if (Kin.jointTypes[1] === 'R' && k === '5R') {
                add('line', {
                    x1: Kin.cfg.P2.x, y1: -Kin.cfg.P2.y,
                    x2: f.B.x, y2: -f.B.y,
                    stroke: '#3d8bfd', 'stroke-width': 5, 'stroke-linecap': 'round'
                }, gArm);
            } else if (Kin.jointTypes[1] === 'P' && f.B) {
                add('circle', {
                    cx: f.B.x, cy: -f.B.y, r: 5,
                    fill: '#3d8bfd', stroke: '#1a1a2e', 'stroke-width': 1
                }, gArm);
            }

            /* Пассивные / открытые звенья */
            if (f.ok && !Kin.linksCross(f.A, f.B, f.E)) {
                if (k === '5R' || k === 'RP') {
                    add('line', { x1: f.A.x, y1: -f.A.y, x2: f.E.x, y2: -f.E.y,
                        stroke: '#2ecc71', 'stroke-width': 5, 'stroke-linecap': 'round' }, gArm);
                    if (f.B) add('line', { x1: f.B.x, y1: -f.B.y, x2: f.E.x, y2: -f.E.y,
                        stroke: '#2ecc71', 'stroke-width': 5, 'stroke-linecap': 'round' }, gArm);
                } else if (k === 'RR') {
                    add('line', { x1: f.A.x, y1: -f.A.y, x2: f.E.x, y2: -f.E.y,
                        stroke: '#3d8bfd', 'stroke-width': 5, 'stroke-linecap': 'round' }, gArm);
                } else if (k === 'PP') {
                    add('line', { x1: f.A.x, y1: -f.A.y, x2: f.E.x, y2: -f.E.y,
                        stroke: '#2ecc71', 'stroke-width': 3, 'stroke-dasharray': '3 2' }, gArm);
                    add('line', { x1: f.B.x, y1: -f.B.y, x2: f.E.x, y2: -f.E.y,
                        stroke: '#2ecc71', 'stroke-width': 3, 'stroke-dasharray': '3 2' }, gArm);
                }
            } else {
                add('line', { x1: f.A.x, y1: -f.A.y, x2: f.B ? f.B.x : f.E.x, y2: f.B ? -f.B.y : -f.E.y,
                    stroke: '#ff3b30', 'stroke-width': 2, 'stroke-dasharray': '6 5' }, gArm);
                const w = add('text', {
                    x: (f.A.x + (f.B ? f.B.x : f.E.x))/2,
                              y: -((f.A.y + (f.B ? f.B.y : f.E.y))/2) + 22,
                              'text-anchor': 'middle', 'font-size': 12, 'font-weight': 'bold',
                              'font-family': 'ui-monospace, monospace', fill: '#ff3b30'
                }, gArm);
                w.textContent = f.ok ? 'ЗАКЛИНИЛО' : 'НЕДОСТУПНО';
            }

            /* Шарниры A, B */
            for (const p of [f.A, f.B]) {
                if (!p) continue;
                add('circle', { cx: p.x, cy: -p.y, r: 3.6,
                    fill: '#aab4cc', stroke: '#1a1a2e', 'stroke-width': 1 }, gArm);
            }

            /* Моторы */
            const motors = [];
            motors.push([Kin.cfg.P1, 'M1']);
            if (k === '5R') motors.push([Kin.cfg.P2, 'M2']);
            if (k === 'RP' && Kin.cfg.P2) motors.push([Kin.cfg.P2, 'M2']);
            if (k === 'PP' && Kin.cfg.P2) motors.push([Kin.cfg.P2, 'M2']);
            for (const [p, label] of motors) {
                if (!p) continue;
                add('circle', { cx: p.x, cy: -p.y, r: 6,
                    fill: '#ff9f43', stroke: '#1a1a2e', 'stroke-width': 1.5 }, gArm);
                const t = add('text', {
                    x: p.x - 10, y: -p.y + 2.6, 'text-anchor': 'end',
                    'font-size': 8, 'font-family': 'ui-monospace, monospace',
                    fill: '#ffb86b'
                }, gArm);
                t.textContent = label;
            }

            /* Эффектор E */
            if (f.ok) {
                const sag = (state.showSag && Kin.getSag) ? Kin.getSag(f.E.x, f.E.y) : 0;
                add('circle', { cx: f.E.x, cy: -(f.E.y - sag), r: 3.4,
                    fill: '#ff3b30', stroke: '#ffffff', 'stroke-width': 1 }, gArm);
                add('line', { x1: f.E.x - 9, y1: -(f.E.y - sag),
                    x2: f.E.x + 9, y2: -(f.E.y - sag),
                    stroke: '#ff3b30', 'stroke-width': 1 }, gArm);
                add('line', { x1: f.E.x, y1: -(f.E.y - sag) - 9,
                    x2: f.E.x, y2: -(f.E.y - sag) + 9,
                    stroke: '#ff3b30', 'stroke-width': 1 }, gArm);
            }

            /* Маркер цели */
            if (state.selected) {
                add('circle', {
                    cx: state.selected.x, cy: -state.selected.y, r: 4,
                    fill: 'none', stroke: '#ffa500', 'stroke-width': 1.2,
                    'stroke-dasharray': '3 2'
                }, gArm);
            }
        }

        function updateStatus() {
            const q1k = Kin.jointTypes[0]==='R' ? state.q1 : state.q1 * 1000;
            const q2k = Kin.jointTypes[1]==='R' ? state.q2 : state.q2 * 1000;
            const f = Kin.forward(q1k, q2k, state.mode);
            const unit1 = Kin.jointTypes[0]==='R' ? '°' : ' мм';
            const unit2 = Kin.jointTypes[1]==='R' ? '°' : ' мм';

            const row = (k, v, cls='', sub='') =>
            `<div class="hud-row"><span class="k">${k}</span>` +
            `<span class="v ${cls}">${v}${sub?` <span class="sub">${sub}</span>`:''}</span></div>`;

            let html = '';

            /* ---- покрытие поля ---- */
            html += `<div class="hud-row"><span class="k">достижимо</span>` +
            `<span class="v ${state.reach.ok===state.reach.total?'ok':'warn'}">` +
            `${state.reach.ok}/${state.reach.total}</span></div>`;
            html += row('пик |v| сессии', state.peakVSession.toFixed(0)+' мм/с',
                        state.peakVSession>=100 ? 'ok' : 'warn',
                        state.peakVSession>=100 ? '≥100 ✓' : '<100!');

            /* ---- моторы ---- */
            html += `<div class="hud-sec">Моторы (вал)</div>`;
            html += row('τ₁', state.tau1.toFixed(3)+' Н·м');
            html += row('τ₂', state.tau2.toFixed(3)+' Н·м');
            html += row('ω₁', state.w1.toFixed(3)+' рад/с');
            html += row('ω₂', state.w2.toFixed(3)+' рад/с');

            /* ---- факт ---- */
            html += `<div class="hud-sec">Текущее</div>`;
            html += row('q₁', toDisplay(0, state.q1).toFixed(2)+unit1);
            html += row('q₂', toDisplay(1, state.q2).toFixed(2)+unit2);
            if (f.ok) {
                html += row('E', `(${f.E.x.toFixed(1)}, ${f.E.y.toFixed(1)})`);
                if (Kin.getSag) {
                    const sag = Kin.getSag(f.E.x, f.E.y);
                    if (sag > 0.01) html += row('провис', sag.toFixed(3)+' мм', 'warn');
                }
            } else {
                html += row('поза', 'сингулярна', 'warn');
            }

            /* ---- цель ---- */
            html += `<div class="hud-sec">Цель</div>`;
            if (state.selected) {
                let stCls='ok', stTxt='на месте ✓';
                if (path.blocked)        { stCls='warn';   stTxt='недостижима ✗'; }
                else if (path.active)    { stCls='moving'; stTxt='движение…'; }
                else if (!state.settled) { stCls='moving'; stTxt='движение…'; }
                html += row(state.selected.id + (state.selected.discard?' (отбой)':''), stTxt, stCls);
            } else {
                html += row('клетка', '— не выбрана', 'sub');
            }

            /* ---- захват / электромагнит ---- */
            if (state.cap) {
                const c = state.cap;
                html += `<div class="hud-sec">Захват (электромагнит)</div>`;
                html += row('|v|', c.v.toFixed(1)+' мм/с', c.v>=100?'ok':'');
                html += row('|a|', c.a.toFixed(2)+' м/с²');
                html += row('зазор ном/худ', `${c.gNom.toFixed(2)} / ${c.gWorst.toFixed(2)} мм`);
                html += row('F держ ном/худ', `${c.FhNom.toFixed(2)} / ${c.FhWorst.toFixed(2)} Н`);
                html += row('F треб', c.Freq.toFixed(3)+' Н', '',
                            `g ${c.Fgrav.toFixed(3)} · μ ${c.Fslide.toFixed(3)}`);
                const mc = c.margin >= 2 ? 'ok' : (c.margin >= 1 ? 'moving' : 'warn');
                const flags = (c.drop?' СРЫВ↓':'') + (c.slip?' ПРОСКОЛЬЗНЕНИЕ→':'');
                html += row('запас', (isFinite(c.margin)?'×'+c.margin.toFixed(2):'∞')+flags, mc);
            }

            if ($hudStats) $hudStats.innerHTML = html;
            if ($status)   $status.innerHTML  = html; // legacy-совместимость, если блок ещё в DOM

            /* ---- мини-строка (свёрнутый вид) ---- */
            if ($hudMini) {
                let dotCls='ok', dotTxt='✓', cellTxt='—';
                if (state.selected) {
                    cellTxt = state.selected.id;
                    if (path.blocked)        { dotCls='warn';  dotTxt='✗'; }
                    else if (!state.settled) { dotCls='moving';dotTxt='▶'; }
                }
                let magTxt='—', magCls='';
                if (state.cap) {
                    magTxt = isFinite(state.cap.margin) ? '×'+state.cap.margin.toFixed(1) : '∞';
                    magCls = (state.cap.drop||state.cap.slip) ? 'm-warn'
                    : (state.cap.margin>=2 ? 'm-ok' : 'm-move');
                }
                $hudMini.innerHTML =
                `<b>${cellTxt}</b> ${dotTxt} · v <b>${(state.cap?state.cap.v:0).toFixed(0)}</b>` +
                ` · маг <span class="${magCls}">${magTxt}</span>` +
                ` · пик <b>${state.peakVSession.toFixed(0)}</b>`;
            }

            /* ---- индикатор-точка в шапке + тревога, пробивающая прозрачность ---- */
            if ($hudDot) {
                $hudDot.className = 'dot' +
                (path.blocked ? ' warn' : (!state.settled && state.selected ? ' moving' : ''));
            }
            if ($hud) {
                const alarm = (state.cap && (state.cap.drop || state.cap.slip)) || path.blocked;
                $hud.classList.toggle('alert', !!alarm);
            }
        }

        /* ---------- Простой планировщик: цель ставится сразу ----------
         Д екартова траектория со smoothst*ep давала "залипание" в начале
         пути. Теперь цель назначается сразу, а плавность обеспечивает
         ПД-регулятор физики. */
        function startPath(tx, ty) {
            const q1k = Kin.jointTypes[0]==='R' ? state.q1 : state.q1 * 1000;
            const q2k = Kin.jointTypes[1]==='R' ? state.q2 : state.q2 * 1000;

            const probe = Kin.inverseAll(tx, ty, {
                mode: state.mode,
                reference: { q1: q1k, q2: q2k }
            });
            if (!probe.length) {
                path.blocked = true;
                path.active = false;
                return;
            }
            path.blocked = false;
            path.active = false;         // траектория не используется
            applySolution(probe[0]);     // сразу ставим конечную цель
        }

        /* updatePath больше не нужен, но оставим как заглушку */
        function updatePath(dt) { return; }

        function applySolution(sol) {
            state.targetQ1 = Kin.jointTypes[0]==='R' ? sol.q1 : sol.q1 / 1000;
            state.targetQ2 = Kin.jointTypes[1]==='R' ? sol.q2 : sol.q2 / 1000;
        }

        /* ---------- UI: слайдеры ---------- */
        function syncTargetControls() {
            const lims = Kin.qLimits();
            const d1 = toDisplay(0, state.targetQ1);
            const d2 = toDisplay(1, state.targetQ2);
            const d1min = toDisplay(0, Kin.jointTypes[0]==='R' ? lims[0][0] : lims[0][0]/1000);
            const d1max = toDisplay(0, Kin.jointTypes[0]==='R' ? lims[0][1] : lims[0][1]/1000);
            const d2min = toDisplay(1, Kin.jointTypes[1]==='R' ? lims[1][0] : lims[1][0]/1000);
            const d2max = toDisplay(1, Kin.jointTypes[1]==='R' ? lims[1][1] : lims[1][1]/1000);

            const unit1 = Kin.jointTypes[0]==='R' ? '°' : ' мм';
            const unit2 = Kin.jointTypes[1]==='R' ? '°' : ' мм';
            const name1 = Kin.jointTypes[0]==='R' ? 'θ1' : 's1';
            const name2 = Kin.jointTypes[1]==='R' ? 'θ2' : 's2';

            $q1L.textContent = name1 + ' — цель';
            $q2L.textContent = name2 + ' — цель';
            $q1v.textContent = d1.toFixed(1) + unit1;
            $q2v.textContent = d2.toFixed(1) + unit2;

            const step1 = Kin.jointTypes[0]==='R' ? 0.1 : 1;
            const step2 = Kin.jointTypes[1]==='R' ? 0.1 : 1;

            $q1r.min = d1min; $q1r.max = d1max; $q1r.step = step1; $q1r.value = d1;
            $q1n.min = d1min; $q1n.max = d1max; $q1n.step = step1; $q1n.value = d1.toFixed(2);
            $q2r.min = d2min; $q2r.max = d2max; $q2r.step = step2; $q2r.value = d2;
            $q2n.min = d2min; $q2n.max = d2max; $q2n.step = step2; $q2n.value = d2.toFixed(2);
        }

        function setJointTarget(idx, displayVal) {
            const qSI = fromDisplay(idx, displayVal);
            const lims = Kin.qLimits();
            const lo = Kin.jointTypes[idx]==='R' ? lims[idx][0] : lims[idx][0]/1000;
            const hi = Kin.jointTypes[idx]==='R' ? lims[idx][1] : lims[idx][1]/1000;
            const clamped = Math.min(hi, Math.max(lo, qSI));

            const nq1 = idx === 0 ? clamped : state.targetQ1;
            const nq2 = idx === 1 ? clamped : state.targetQ2;

            const q1k = Kin.jointTypes[0]==='R' ? nq1 : nq1 * 1000;
            const q2k = Kin.jointTypes[1]==='R' ? nq2 : nq2 * 1000;
            const f = Kin.forward(q1k, q2k, state.mode);
            if (!f.ok) return;
            if (Kin.linksCross(f.A, f.B, f.E)) return;

            if (idx === 0) state.targetQ1 = clamped;
            else state.targetQ2 = clamped;
            path.active = false; path.blocked = false;
            syncTargetControls();
        }

        function bindInputs() {
            const bind = (r, n, idx) => {
                const apply = (raw) => {
                    const v = parseFloat(raw);
                    if (isFinite(v)) setJointTarget(idx, v);
                };
                    r.addEventListener('input', e => apply(e.target.value));
                    n.addEventListener('input', e => apply(e.target.value));
                    n.addEventListener('change', e => apply(e.target.value));
            };
            bind($q1r, $q1n, 0);
            bind($q2r, $q2n, 1);
        }

        /* ---------- Список клеток ---------- */
        function buildSelect() {
            const none = document.createElement('option');
            none.value = ''; none.textContent = '— выберите клетку —';
            $cellSel.appendChild(none);
            const gf = document.createElement('optgroup'); gf.label = 'Поле (А0 – Е8)';
            for (const c of CELLS) {
                if (c.discard) continue;
                const o = document.createElement('option');
                o.value = c.id; o.textContent = c.id;
                gf.appendChild(o);
            }
            $cellSel.appendChild(gf);
            const gd = document.createElement('optgroup'); gd.label = 'Отбой';
            for (const c of CELLS) {
                if (!c.discard) continue;
                const o = document.createElement('option');
                o.value = c.id; o.textContent = c.id + ' (отбой)';
                gd.appendChild(o);
            }
            $cellSel.appendChild(gd);
        }

        /* ---------- Переключение схем ---------- */
        function updateSchemeUI() {
            const scheme = Kin.kind;
            document.querySelectorAll('.sch-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.scheme === scheme));
            document.querySelectorAll('.cfg-5R,.cfg-RR,.cfg-RP,.cfg-PP').forEach(el =>
            el.style.display = 'none');
            const el = document.querySelector('.cfg-' + scheme);
            if (el) el.style.display = '';
            const hints = {
                '5R': 'Пятизвенник: два R-мотора, два пассивных звена. Рабочая зона — «линза».',
                'RR': 'Открытый двухзвенник: оба мотора соосно на базе. Рабочая зона — кольцо.',
                'RP': 'R-звено + каретка на рельсе (ремень). E — пересечение двух пассивных плеч.',
 'PP': 'Декартов: две каретки на перпендикулярных рельсах. Все клетки, но провисает.'
            };
            $schHint.textContent = hints[scheme] || '';
        }

        function switchScheme(name) {
            Kin = SCHEMES[name];
            /* Инициализация конфигурации из UI */
            readConfig();
            /* Стартовая поза */
            const dp = Kin.defaultPose();
            state.q1 = Kin.jointTypes[0]==='R' ? dp.q1 : dp.q1 / 1000;
            state.q2 = Kin.jointTypes[1]==='R' ? dp.q2 : dp.q2 / 1000;
            state.targetQ1 = state.q1; state.targetQ2 = state.q2;
            state.w1 = 0; state.w2 = 0; state.mode = dp.mode;
            state.selected = null;
            $cellSel.value = '';
            updateSchemeUI();
            syncTargetControls();
            recomputeDerived();
        }

        /* ---------- Конфигурация ---------- */
        function readConfig() {
            const g = id => parseFloat(document.getElementById(id).value);
            MOTOR.tau_stall = g('cfg-tau');
            MOTOR.omega_zero = g('cfg-omega');

            /* Пробрасываем параметры мотора в cfg каждой схемы */
            for (const k in SCHEMES) {
                SCHEMES[k].cfg.tau_stall = MOTOR.tau_stall;
                SCHEMES[k].cfg.omega_zero = MOTOR.omega_zero;
            }

            const k = Kin.kind;
            if (k === '5R') {
                Kin.cfg.L1 = g('5R-L1'); Kin.cfg.L2 = g('5R-L2');
                Kin.cfg.L3a = g('5R-L3a'); Kin.cfg.L3b = g('5R-L3b');
                Kin.cfg.P1 = { x: g('5R-P1x'), y: g('5R-P1y') };
                Kin.cfg.P2 = { x: g('5R-P2x'), y: g('5R-P2y') };
            } else if (k === 'RR') {
                Kin.cfg.L1 = g('RR-L1'); Kin.cfg.L2 = g('RR-L2');
                Kin.cfg.P1 = { x: g('RR-P1x'), y: g('RR-P1y') };
                Kin.cfg.P2 = null;
            } else if (k === 'RP') {
                Kin.cfg.P1 = { x: g('RP-P1x'), y: g('RP-P1y') };
                Kin.cfg.s_min = g('RP-smin'); Kin.cfg.s_max = g('RP-smax');
                Kin.cfg.pulleyR = g('RP-r');
            } else {
                Kin.cfg.P1 = { x: g('PP-P1x'), y: g('PP-P1y') };
                Kin.cfg.P2 = { x: g('PP-P2x'), y: g('PP-P2y') };
                Kin.cfg.rail1_angle = g('PP-rail1');
                Kin.cfg.rail2_angle = g('PP-rail2');
                Kin.cfg.s1_min = g('PP-s1min'); Kin.cfg.s1_max = g('PP-s1max');
                Kin.cfg.s2_min = g('PP-s2min'); Kin.cfg.s2_max = g('PP-s2max');
                Kin.cfg.pulleyR = 10;
            }

            /* Общие лимиты R-шарниров */
            const th1min = g('cfg-th1min'), th1max = g('cfg-th1max');
            const th2min = g('cfg-th2min'), th2max = g('cfg-th2max');
            for (const s of [Kin5R, KinRR, KinRP]) {
                s.cfg.th1_min = th1min; s.cfg.th1_max = th1max;
            }
            Kin5R.cfg.th2_min = th2min; Kin5R.cfg.th2_max = th2max;
            KinRR.cfg.th2_min = th2min; KinRR.cfg.th2_max = th2max;
            /* ---- захват / электромагнит ---- */
            const cs = id => document.getElementById(id);
            const gv = id => { const e=cs(id); return e ? parseFloat(e.value) : NaN; };
            if (cs('cap-model')) CAP.model = cs('cap-model').value;
            const capNum = (id,def)=>{ const v=gv(id); if(isFinite(v)) CAP[id]=v; };
            capNum('F0',CAP.F0); capNum('g0',CAP.g0); capNum('NI',CAP.NI);
            capNum('Apole',CAP.Apole); capNum('Bsat',CAP.Bsat); capNum('gfe',CAP.gfe);
            capNum('tlid',CAP.tlid); capNum('tol',CAP.tol); capNum('glift',CAP.glift);
            capNum('mu',CAP.mu); capNum('mpay',CAP.mpay);
        }

        function recomputeDerived() {
            /* Ограничение текущего состояния новыми лимитами */
            const lims = Kin.qLimits();
            const lo1 = Kin.jointTypes[0]==='R' ? lims[0][0] : lims[0][0]/1000;
            const hi1 = Kin.jointTypes[0]==='R' ? lims[0][1] : lims[0][1]/1000;
            const lo2 = Kin.jointTypes[1]==='R' ? lims[1][0] : lims[1][0]/1000;
            const hi2 = Kin.jointTypes[1]==='R' ? lims[1][1] : lims[1][1]/1000;
            state.q1 = Math.min(hi1, Math.max(lo1, state.q1));
            state.q2 = Math.min(hi2, Math.max(lo2, state.q2));
            state.targetQ1 = Math.min(hi1, Math.max(lo1, state.targetQ1));
            state.targetQ2 = Math.min(hi2, Math.max(lo2, state.targetQ2));
            state.w1 = 0; state.w2 = 0;

            /* Проверка: если поза невалидна, сброс в default */
            const q1k = Kin.jointTypes[0]==='R' ? state.q1 : state.q1 * 1000;
            const q2k = Kin.jointTypes[1]==='R' ? state.q2 : state.q2 * 1000;
            const f = Kin.forward(q1k, q2k, state.mode);
            if (!f.ok || Kin.linksCross(f.A, f.B, f.E)) {
                const dp = Kin.defaultPose();
                state.q1 = Kin.jointTypes[0]==='R' ? dp.q1 : dp.q1 / 1000;
                state.q2 = Kin.jointTypes[1]==='R' ? dp.q2 : dp.q2 / 1000;
                state.targetQ1 = state.q1; state.targetQ2 = state.q2;
                state.mode = dp.mode;
            }

            syncTargetControls();
            computeSingularity();
            renderPolygon();
            renderGrid(); renderWorkspace(); renderSingularity();
            renderArm(); updateStatus();
            validateAllCells();
        }

        function validateAllCells() {
            const bad = [];
            for (const c of CELLS) {
                if (!Kin.inverseAll(c.x, c.y, { mode: state.mode }).length) bad.push(c.id);
            }
            state.reach = { ok: CELLS.length - bad.length, total: CELLS.length };
            console.log(`[${Kin.kind}] ${state.reach.ok}/${state.reach.total} достижимо` +
            (bad.length ? `; недостижимые: ${bad.join(', ')}` : ' ✓'));
            if (typeof updateStatus === 'function') updateStatus();
        }

        /* ---------- Обработчики UI ---------- */
        function bindUI() {
            /* ---- HUD: сворачивание + перетаскивание + clamp + память ---- */
            const applyHud = () => {
                if (!$hud) return;
                $hud.classList.toggle('collapsed', !!state.hudCollapsed);
                if ($hudChev) $hudChev.textContent = state.hudCollapsed ? '▸' : '▾';
            };
                /* дефолт при первом запуске — свёрнут (меньше перекрывает поле) */
                try {
                    const raw = localStorage.getItem('hud_collapsed');
                    state.hudCollapsed = (raw === null) ? true : (raw === '1');
                } catch(e){ state.hudCollapsed = true; }

                const MARGIN = 8;
                const placeHud = (x, y) => {
                    if (!$hud) return;
                    const w = $hud.offsetWidth  || 312;
                    const h = $hud.offsetHeight || 120;
                    const cx = Math.max(MARGIN, Math.min(window.innerWidth  - w - MARGIN, x));
                    const cy = Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, y));
                    $hud.style.left = cx + 'px';
                    $hud.style.top  = cy + 'px';
                    $hud.style.right = 'auto';          // переходим на left/top-модель
                };
                const savePos = () => {
                    if (!$hud) return;
                    try { localStorage.setItem('hud_pos',
                        JSON.stringify({ x: parseFloat($hud.style.left)||0,
                            y: parseFloat($hud.style.top) ||0 })); } catch(e){}
                };
                /* стартовая позиция: из памяти, иначе — правый верх (та же точка, что в CSS) */
                const initPos = () => {
                    if (!$hud) return;
                    let p = null;
                    try { p = JSON.parse(localStorage.getItem('hud_pos') || 'null'); } catch(e){}
                    if (p && isFinite(p.x) && isFinite(p.y)) placeHud(p.x, p.y);
                    else placeHud(window.innerWidth - $hud.offsetWidth - 12, 12);
                };

                    if ($hudToggle) {
                        let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
                        $hudToggle.addEventListener('mousedown', (e) => {
                            if (e.button !== 0) return;
                            dragging = true; moved = false;
                            sx = e.clientX; sy = e.clientY;
                            ox = parseFloat($hud.style.left) || $hud.getBoundingClientRect().left;
                            oy = parseFloat($hud.style.top)  || $hud.getBoundingClientRect().top;
                            $hud.classList.add('no-anim');
                            $hudToggle.classList.add('dragging');
                            e.preventDefault();
                        });
                        window.addEventListener('mousemove', (e) => {
                            if (!dragging) return;
                            const dx = e.clientX - sx, dy = e.clientY - sy;
                            if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
                            if (moved) placeHud(ox + dx, oy + dy);
                        });
                            window.addEventListener('mouseup', () => {
                                if (!dragging) return;
                                dragging = false;
                                $hud.classList.remove('no-anim');
                                $hudToggle.classList.remove('dragging');
                                if (moved) savePos();                 // тащили —记住 позицию
                                else {                                // чистый клик — сворачиваем
                                    state.hudCollapsed = !state.hudCollapsed;
                                    try { localStorage.setItem('hud_collapsed', state.hudCollapsed?'1':'0'); } catch(e){}
                                    applyHud();
                                    /* после смены высоты переклампить, чтобы не вылезла за край */
                                    placeHud(parseFloat($hud.style.left)||0, parseFloat($hud.style.top)||0);
                                    savePos();
                                }
                            });
                    }
                    window.addEventListener('resize', () => {     // защита от «обрезано справа»
                        if (!$hud) return;
                        placeHud(parseFloat($hud.style.left)||0, parseFloat($hud.style.top)||0);
                    });
                    window.__applyHud = applyHud;
                    window.__initHudPos = initPos;
            document.querySelectorAll('.sch-btn').forEach(b => {
                b.addEventListener('click', () => switchScheme(b.dataset.scheme));
            });
            document.querySelectorAll('#panel input[type=number]').forEach(inp => {
                inp.addEventListener('change', () => { readConfig(); recomputeDerived(); });
            });
            document.getElementById('cfg-reset').addEventListener('click', () => {
                const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
                set('5R-L1',150); set('5R-L2',150); set('5R-L3a',150); set('5R-L3b',150);
                set('RR-L1',150); set('RR-L2',150);
                set('RP-L1',150); set('RP-L3a',150); set('RP-L3b',150);
                set('RP-rail',0); set('RP-r',10); set('RP-smin',0); set('RP-smax',250);
                set('PP-rail1',0); set('PP-rail2',90);
                set('PP-s1min',0); set('PP-s1max',280);
                set('PP-s2min',0); set('PP-s2max',200);
                set('cfg-th1min',-120); set('cfg-th1max',120);
                set('cfg-th2min',-120); set('cfg-th2max',120);
                set('cfg-tau',0.16); set('cfg-omega',30);
                set('5R-P1x',-40); set('5R-P1y',340); set('5R-P2x',-40); set('5R-P2y',380);
                set('RR-P1x',-80); set('RR-P1y',230);
                set('RP-P1x',-18); set('RP-P1y',230);
                set('PP-P1x',-40); set('PP-P1y',60); set('PP-P2x',-40); set('PP-P2y',60);
                const setsel = (id,v)=>{ const e=document.getElementById(id); if(e) e.value=v; };
                setsel('cap-model','circuit');
                set('cap-F0',8); set('cap-g0',1); set('cap-NI',1200); set('cap-Apole',80);
                set('cap-Bsat',1.6); set('cap-gfe',3); set('cap-tlid',0.8); set('cap-tol',0.5);
                set('cap-glift',0); set('cap-mu',0.35); set('cap-mpay',0.007);
                switchScheme('5R');
            });
            $cellSel.addEventListener('change', () => {
                const id = $cellSel.value;
                if (!id) { state.selected = null; path.active = false; path.blocked = false;
                    renderSelection(); updateStatus(); return; }
                    const cell = CELLS.find(c => c.id === id);
                    state.selected = cell;
                    startPath(cell.x, cell.y);
                    renderSelection();
            });
            $home.addEventListener('click', () => {
                state.selected = null; $cellSel.value = ''; renderSelection();
                const dp = Kin.defaultPose();
                const f = Kin.forward(
                    Kin.jointTypes[0]==='R' ? dp.q1 : dp.q1,
                    Kin.jointTypes[1]==='R' ? dp.q2 : dp.q2,
                    dp.mode);
                if (f.ok) startPath(f.E.x, f.E.y);
            });
                $chkWs.addEventListener('change', e => { state.showWorkspace = e.target.checked; renderWorkspace(); });
                $chkSing.addEventListener('change', e => { state.showSing = e.target.checked; renderSingularity(); });
                $chkCells.addEventListener('change', e => { state.showCells = e.target.checked; renderGrid(); });
                $chkSag.addEventListener('change', e => { state.showSag = e.target.checked; renderArm(); });
                $zoom.addEventListener('input', e => {
                    state.zoom = parseFloat(e.target.value);
                    $zoomVal.textContent = state.zoom.toFixed(2) + '×';
                    updateViewBox();
                });
                bindInputs();
                /* ---------- Панорамирование сцены мышью ---------- */
                let isPanning = false;
                let panStartX = 0, panStartY = 0;
                let panStartCx = 0, panStartCy = 0;

                svg.style.cursor = 'grab';

                // Ловим mousedown на всей сцене (включая внутренние элементы)
                window.addEventListener('mousedown', (e) => {
                    // Только если клик по SVG или внутри него
                    if (!svg.contains(e.target) && e.target !== svg) return;
                    if (e.button !== 0) return;          // только левая кнопка
                    isPanning = true;
                    panStartX = e.clientX;
                    panStartY = e.clientY;
                    panStartCx = VIEW.cx;
                    panStartCy = VIEW.cy;
                    svg.style.cursor = 'grabbing';
                    e.preventDefault();
                });

                window.addEventListener('mousemove', (e) => {
                    if (!isPanning) return;
                    const dx = e.clientX - panStartX;
                    const dy = e.clientY - panStartY;

                    const scaleX = (VIEW.w / state.zoom) / svg.clientWidth;
                    const scaleY = (VIEW.h / state.zoom) / svg.clientHeight;

                    VIEW.cx = panStartCx - dx * scaleX;
                    VIEW.cy = panStartCy + dy * scaleY;   // инверсия Y
                    updateViewBox();
                });

                window.addEventListener('mouseup', () => {
                    if (!isPanning) return;
                    isPanning = false;
                    svg.style.cursor = 'grab';
                });

                window.addEventListener('blur', () => {
                    isPanning = false;
                    svg.style.cursor = 'grab';
                });
        }

        /* ---------- Главный цикл ---------- */
        let lastT = 0;
        function frame(now) {
            try {
                if (!lastT) lastT = now;
                let dt = (now - lastT) / 1000;
                lastT = now;
                if (dt > 0.1) dt = 0.1;
                updatePath(dt);
                Phys.simulate(Kin, state, dt);          // ядро движения

                /* ---- косметика (захват + осциллограф) в изолированном try ---- */
                try {
                    const q1k = Kin.jointTypes[0]==='R' ? state.q1 : state.q1*1000;
                    const q2k = Kin.jointTypes[1]==='R' ? state.q2 : state.q2*1000;
                    const ek = effectorKA(Kin, q1k, q2k, state.mode,
                                          state.w1, state.w2, state.alpha1||0, state.alpha2||0);
                    const vmm = Math.hypot(ek.vx, ek.vy);
                    const ams = Math.hypot(ek.ax, ek.ay) / 1000;

                    const g_nom   = CAP.tlid + CAP.glift;
                    const g_worst = CAP.tlid + CAP.tol + CAP.glift;
                    const Fh_nom  = fHold(g_nom);
                    const Fh_worst= fHold(g_worst);
                    const m = CAP.mpay;
                    const F_grav  = m * G_ACC;
                    const F_slide = m * ams / Math.max(0.05, CAP.mu);
                    const F_req   = Math.max(F_grav, F_slide);
                    const margin  = F_req > 1e-9 ? Fh_worst / F_req : Infinity;
                    state.cap = {
                        ok: ek.ok, v: vmm, a: ams,
                        Freq: F_req, Fgrav: F_grav, Fslide: F_slide,
                        FhNom: Fh_nom, FhWorst: Fh_worst, margin,
                        slip: F_slide > Fh_worst, drop: F_grav > Fh_worst,
                        gNom: g_nom, gWorst: g_worst,
                        peakV: hist.v.length ? Math.max(...hist.v) : vmm
                    };
                    pushHist(now/1000, vmm, ams, F_req, Fh_worst);
                    if (vmm > state.peakVSession) state.peakVSession = vmm;
                    drawScope();
                } catch (cosErr) {
                    console.warn('[kosmetika]', cosErr);   // не ломаем движение
                }

                const e1 = Math.abs(state.q1 - state.targetQ1);
                const e2 = Math.abs(state.q2 - state.targetQ2);
                state.settled = !path.active && e1 < 0.01 && e2 < 0.01 &&
                Math.abs(state.w1) < 0.03 && Math.abs(state.w2) < 0.03;
                renderArm();
                updateStatus();
            } catch (err) {
                console.error('[frame]', err);
                const msg = (err && err.stack) ? String(err.stack).split('\n').slice(0,3).join('\n') : String(err);
                state.lastErr = msg;
                if ($status) $status.innerHTML =
                    '<div class="warn">⛔ Движок упал — рука заморожена</div>' +
                    '<div style="white-space:pre-wrap;font-size:9px;color:var(--warn)">' +
                    msg.replace(/</g,'&lt;') + '</div>';
            }
            requestAnimationFrame(frame);   // всегда перепланируем
        }

        /* =================================================================
         *  ЗАХВАТ (электромагнит) + ПРОИЗВОДНЫЕ ЭФФЕКТОРА + ОСЦИЛЛОГРАФ
         *  -----------------------------------------------------------------
         *  ЕТЗ п.2.3: шашка Ø26, выс.5, крышка 0.8 мм, внутри стальная
         *  увеличенная шайба М8 (24×8,4×2), масса ≈7 г, допуск ±0,5 мм.
         *  Магнит тянет шайбу СКВОЗЬ крышку → рабочий зазор = крышка + допуск
         *  + люфт прижатия. Сила магнита от зазора падает круто.
         *  ЕТЗ п.3.2: шашка — часть устройства, пока её держат; отделяющиеся
         *  во время работы части запрещены → шашка НЕ должна ни отрываться
         *  (против g), ни проскальзывать (против инерции m·a через трение μ·N).
         *  Горизонтальная плоскость (п.1.2): гравитация момента на моторах не
         *  даёт, но вертикально шашка висит на магните → держим против g.
         *  ================================================================= */
        const MU0 = 4 * Math.PI * 1e-7;
        const G_ACC = 9.81;
        const CAP = {                 // характеристики захвата (читаются из панели)
            model: 'circuit',         // 'circuit' = физ. магнитная цепь, 'emp' = эмпирика
            F0: 8.0, g0: 1.0,         // emp: сила при контакте (Н), характ. зазор (мм)
NI: 1200, Apole: 80, Bsat: 1.6, gfe: 3.0,  // circuit: А·витки, мм², Тл, мм
tlid: 0.8, tol: 0.5, glift: 0.0,            // зазор: крышка + допуск + люфт (мм)
mu: 0.35, mpay: 0.007                        // трение шашка-захват, масса (кг)
        };
        function fHold(g_mm) {        // сила удержания на зазоре g (мм) → Н
            if (CAP.model === 'emp') {
                if (!(CAP.g0 > 0)) return CAP.F0;
                return CAP.F0 / (1 + Math.pow(g_mm / CAP.g0, 2));
            }
            const g_m = g_mm * 1e-3, A = CAP.Apole * 1e-6, gfe_m = CAP.gfe * 1e-3;
            const R = (2 * g_m + gfe_m) / (MU0 * A);     // 2 воздушных зазора (туда-обратно)
let B = (CAP.NI / R) / A;
if (B > CAP.Bsat) B = CAP.Bsat;              // насыщение якоря
return B * B * A / (2 * MU0);                // максвелловская сила
        }

        /* Ускорение/скорость E аналитически через якобиан и его производную,
         *  в единицах kinematics (q: рад/мм), чтобы не зависеть от кадров. */
        function effectorKA(kin, q1k, q2k, mode, w1, w2, al1, al2) {
            const t0 = kin.jointTypes[0] === 'R', t1 = kin.jointTypes[1] === 'R';
            const e1 = t0 ? 1e-6 : 1e-4, e2 = t1 ? 1e-6 : 1e-4;   // eps в ед. q_kin
            const f  = kin.forward(q1k, q2k, mode);
            if (!f.ok) return { ok:false, vx:0, vy:0, ax:0, ay:0 };
            const E  = f.E;                                        // ← эффектор лежит в .E
            const P1p = kin.forward(q1k+e1, q2k,     mode).E;       // ← .E, не .x
            const P1m = kin.forward(q1k-e1, q2k,     mode).E;
            const P2p = kin.forward(q1k,    q2k+e2,  mode).E;
            const P2m = kin.forward(q1k,    q2k-e2,  mode).E;
            const PP  = kin.forward(q1k+e1, q2k+e2,  mode).E;
            const PM  = kin.forward(q1k+e1, q2k-e2,  mode).E;
            const MP  = kin.forward(q1k-e1, q2k+e2,  mode).E;
            const MM  = kin.forward(q1k-e1, q2k-e2,  mode).E;
            const d1x=(P1p.x-P1m.x)/(2*e1), d1y=(P1p.y-P1m.y)/(2*e1);
            const d2x=(P2p.x-P2m.x)/(2*e2), d2y=(P2p.y-P2m.y)/(2*e2);
            const dd11x=(P1p.x-2*E.x+P1m.x)/(e1*e1), dd11y=(P1p.y-2*E.y+P1m.y)/(e1*e1);
            const dd22x=(P2p.x-2*E.x+P2m.x)/(e2*e2), dd22y=(P2p.y-2*E.y+P2m.y)/(e2*e2);
            const dd12x=(PP.x-PM.x-MP.x+MM.x)/(4*e1*e2), dd12y=(PP.y-PM.y-MP.y+MM.y)/(4*e1*e2);
            const v1 = t0 ? w1 : w1*1000, v2 = t1 ? w2 : w2*1000;   // dq_kin/dt
            const a1 = t0 ? al1 : al1*1000, a2 = t1 ? al2 : al2*1000;
            const vx = d1x*v1 + d2x*v2, vy = d1y*v1 + d2y*v2;
            const ax = d1x*a1 + d2x*a2 + dd11x*v1*v1 + 2*dd12x*v1*v2 + dd22x*v2*v2;
            const ay = d1y*a1 + d2y*a2 + dd11y*v1*v1 + 2*dd12y*v1*v2 + dd22y*v2*v2;
            return { ok:true, x:E.x, y:E.y, vx, vy, ax, ay };
        }

        /* Кольцевой буфер осциллографа (~8 с при 60 к/с). */
        const HN = 480;
        const hist = { t:[], v:[], a:[], req:[], hold:[] };
        function pushHist(t, v, a, req, hold) {
            hist.t.push(t); hist.v.push(v); hist.a.push(a); hist.req.push(req); hist.hold.push(hold);
            if (hist.t.length > HN) { hist.t.shift(); hist.v.shift(); hist.a.shift(); hist.req.shift(); hist.hold.shift(); }
        }
        function fitCanvas(cv) {
            const dpr = window.devicePixelRatio || 1;
            const w = cv.clientWidth || 300, h = cv.clientHeight || 90;
            if (cv.width !== Math.round(w*dpr) || cv.height !== Math.round(h*dpr)) {
                cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr);
            }
            const ctx = cv.getContext('2d');
            ctx.setTransform(dpr,0,0,dpr,0,0);
            return { ctx, w, h };
        }
        function drawTrace(cv, series, color, yMax, thresh, threshLbl, unit, dec) {
            if (!cv) return;
            const { ctx, w, h } = fitCanvas(cv);
            ctx.clearRect(0,0,w,h);
            ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
            for (let i=1;i<4;i++){ const y=h*i/4; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
            if (thresh!=null && yMax>0){
                const y=h-(thresh/yMax)*h;
                ctx.strokeStyle='rgba(255,107,107,0.75)'; ctx.setLineDash([4,3]);
                ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle='rgba(255,150,150,0.95)'; ctx.font='9px ui-monospace,monospace';
                ctx.fillText(threshLbl||'', 4, y-2);
            }
            const n=series.length;
            if (n>=2){
                const t0=hist.t[0], t1=hist.t[n-1], span=Math.max(1e-3,t1-t0);
                ctx.strokeStyle=color; ctx.lineWidth=1.4; ctx.beginPath();
                for (let i=0;i<n;i++){
                    const x=((hist.t[i]-t0)/span)*w, y=h-Math.min(1,series[i]/yMax)*h;
                    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
                }
                ctx.stroke();
                ctx.fillStyle=color; ctx.font='bold 10px ui-monospace,monospace';
                ctx.fillText(series[n-1].toFixed(dec)+(unit?' '+unit:''), w-62, 12);
            }
            ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px ui-monospace,monospace';
            ctx.fillText('шкала '+yMax.toFixed(yMax<10?1:0), 4, h-3);
        }
        function drawScope() {
            const n=hist.v.length; if (!n) return;
            const peakV=Math.max(150, ...hist.v)*1.05;
            const peakA=Math.max(3, ...hist.a)*1.15;
            const peakF=Math.max(0.2, ...hist.req, ...hist.hold)*1.15;
            drawTrace(document.getElementById('osc-v'), hist.v, '#4a86ff', peakV, 100, 'ЕТЗ 100 мм/с', 'мм/с', 0);
            drawTrace(document.getElementById('osc-a'), hist.a, '#ff9f43', peakA, null, '', 'м/с²', 2);
            drawTrace(document.getElementById('osc-f'), hist.req, '#ff6b6b', peakF, null, '', 'Н', 3);
            // на графике силы вторая кривая — удержание (зелёная), чтобы видеть запас
            const cvF=document.getElementById('osc-f');
            if (cvF){
                const { ctx, w, h } = fitCanvas(cvF);
                const t0=hist.t[0], t1=hist.t[n-1], span=Math.max(1e-3,t1-t0);
                ctx.strokeStyle='#2ecc71'; ctx.lineWidth=1.2; ctx.setLineDash([3,2]); ctx.beginPath();
                for (let i=0;i<n;i++){ const x=((hist.t[i]-t0)/span)*w, y=h-Math.min(1,hist.hold[i]/peakF)*h; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
                ctx.stroke(); ctx.setLineDash([]);
            }
        }

        /* ---------- Старт ---------- */
        function init() {
            buildSelect();
            bindUI();
            updateSchemeUI();
            readConfig();
            /* Стартовая поза (с приведением единиц, как в switchScheme) */
            const dp = Kin.defaultPose();
            state.q1 = Kin.jointTypes[0]==='R' ? dp.q1 : dp.q1 / 1000;
            state.q2 = Kin.jointTypes[1]==='R' ? dp.q2 : dp.q2 / 1000;
            state.mode = dp.mode;
            state.targetQ1 = state.q1; state.targetQ2 = state.q2;
            syncTargetControls();
            computeSingularity();
            updateViewBox();
            renderPolygon();
            renderGrid(); renderSelection(); renderWorkspace(); renderSingularity();
            renderArm(); updateStatus();
            validateAllCells();
            if (window.__applyHud) window.__applyHud();
            if (window.__initHudPos) window.__initHudPos();   // ставим/клампим место
            requestAnimationFrame(frame);
        }

        init();
})();
