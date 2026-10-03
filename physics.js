/* =====================================================================
 P H*YSICS — единая физика для всех схем
 SI внутри, мм/рад в kinematics. Горизонтальная плоскость — гравитация
 момента на моторах не создаёт. NEMA17 12В 0.6А.
 ===================================================================== */
"use strict";
const Phys = (function() {
    const MM = 0.001;                       // мм → м

    /* Массы, кг */
    const M_LINK = 0.060;
    const M_CARRIAGE = 0.030;
    const M_PASSIVE = 0.050;
    const M_PAYLOAD = 0.007;
    const I_ROTOR = 5e-6;                   // кг·м²

    /* Управление: R-шарниры — момент, P-шарниры — сила */
    const KP_R = 0.12, KD_R = 0.05;
    /* Для P-шарниров эффективная масса (каретка + ротор мотора, отражённый
     ч ерез шкив r=10мм) ≈ 0.087 кг. Критическое демпфирование при KP=3:        *
     c_crit = 2·√(KP·m) ≈ 1.0. Держим чуть выше — система слегка
     передемпфирована, без перерегулирования. */
    const KP_P = 3.0,  KD_P = 0.6;
    const BFRIC_R = 0.008, BFRIC_P = 0.3;
    const OMEGA_MAX_R = 8.0;                // рад/с
    const OMEGA_MAX_P = 0.35;               // м/с — ограничение скорости каретки
const PHYS_DT = 0.002;

/* Приведение q из SI к единицам kinematics */
function qSItoKin(kin, q, i) {
    return kin.jointTypes[i] === 'R' ? q : q * 1000;  // m → mm для P
}

/* ============================================================
 *  Физические тела для каждой схемы.
 *  Возвращает массив {cmx [м], cmy [м], angle, mass, inertia}.
 *  ============================================================ */
function bodies(kin, q1_si, q2_si, mode) {
    const q1k = qSItoKin(kin, q1_si, 0);
    const q2k = qSItoKin(kin, q2_si, 1);
    const f = kin.forward(q1k, q2k, mode);
    if (!f.ok) return null;

    const b = [];
    const M = MM;

    /* --- 5R: два R-звена + два пассивных --- */
    if (kin.kind === '5R') {
        {
            const cm = { x: (kin.cfg.P1.x + f.A.x)/2 * M,
                y: (kin.cfg.P1.y + f.A.y)/2 * M };
                const Lm = kin.cfg.L1 * M;
                b.push({ cmx: cm.x, cmy: cm.y, angle: q1_si,
                    mass: M_LINK, inertia: M_LINK * Lm * Lm / 12 });
        }
        {
            const cm = { x: (kin.cfg.P2.x + f.B.x)/2 * M,
                y: (kin.cfg.P2.y + f.B.y)/2 * M };
                const Lm = kin.cfg.L2 * M;
                b.push({ cmx: cm.x, cmy: cm.y, angle: q2_si,
                    mass: M_LINK, inertia: M_LINK * Lm * Lm / 12 });
        }
        {
            const cm = { x: (f.A.x + f.E.x)/2 * M,
                y: (f.A.y + f.E.y)/2 * M };
                const ang = Math.atan2(f.E.y - f.A.y, f.E.x - f.A.x);
                const Lm = kin.cfg.L3a * M;
                b.push({ cmx: cm.x, cmy: cm.y, angle: ang,
                    mass: M_PASSIVE, inertia: M_PASSIVE * Lm * Lm / 12 });
        }
        {
            const cm = { x: (f.B.x + f.E.x)/2 * M,
                y: (f.B.y + f.E.y)/2 * M };
                const ang = Math.atan2(f.E.y - f.B.y, f.E.x - f.B.x);
                const Lm = kin.cfg.L3b * M;
                b.push({ cmx: cm.x, cmy: cm.y, angle: ang,
                    mass: M_PASSIVE, inertia: M_PASSIVE * Lm * Lm / 12 });
        }
    }

    /* --- RR: два R-звена подряд --- */
    else if (kin.kind === 'RR') {
        {
            const cm = { x: (kin.cfg.P1.x + f.A.x)/2 * M,
                y: (kin.cfg.P1.y + f.A.y)/2 * M };
                const Lm = kin.cfg.L1 * M;
                b.push({ cmx: cm.x, cmy: cm.y, angle: q1_si,
                    mass: M_LINK, inertia: M_LINK * Lm * Lm / 12 });
        }
        {
            const cm = { x: (f.A.x + f.E.x)/2 * M,
                y: (f.A.y + f.E.y)/2 * M };
                const ang = Math.atan2(f.E.y - f.A.y, f.E.x - f.A.x);
                const Lm = kin.cfg.L2 * M;
                b.push({ cmx: cm.x, cmy: cm.y, angle: ang,
                    mass: M_LINK, inertia: M_LINK * Lm * Lm / 12 });
        }
    }

    /* --- RP: вращающаяся рейка + каретка --- */
    else if (kin.kind === 'RP') {
        // Рейка (жёсткая, вращается с q1, длина фиксирована s_max)
        {
            const s_max_m = kin.cfg.s_max * M;
            const ux = Math.cos(q1_si), uy = Math.sin(q1_si);
            const cmx = kin.cfg.P1.x * M + 0.5 * s_max_m * ux;
            const cmy = kin.cfg.P1.y * M + 0.5 * s_max_m * uy;
            b.push({ cmx, cmy, angle: q1_si,
                mass: M_LINK,
                inertia: M_LINK * s_max_m * s_max_m / 12 });
        }
        // Каретка — сидит в точке E
        {
            b.push({ cmx: f.E.x * M, cmy: f.E.y * M, angle: 0,
                mass: M_CARRIAGE, inertia: 0 });
        }
    }

    /* --- PP: две каретки --- */
    else if (kin.kind === 'PP') {
        b.push({ cmx: f.A.x * M, cmy: f.A.y * M, angle: 0,
            mass: M_CARRIAGE, inertia: 0 });
        b.push({ cmx: f.B.x * M, cmy: f.B.y * M, angle: 0,
            mass: M_CARRIAGE, inertia: 0 });
    }

    /* Полезная нагрузка в E */
    b.push({ cmx: f.E.x * M, cmy: f.E.y * M, angle: 0,
        mass: M_PAYLOAD, inertia: 0 });

    return b;
}

function wrap(a) {
    while (a > Math.PI) a -= 2*Math.PI;
    while (a < -Math.PI) a += 2*Math.PI;
    return a;
}

/* Матрица масс через численный якобиан */
function massMatrix(kin, q1, q2, mode) {
    const eps = 1e-5;
    const B0 = bodies(kin, q1, q2, mode);
    if (!B0) return null;
    const B1p = bodies(kin, q1+eps, q2, mode);
    const B1m = bodies(kin, q1-eps, q2, mode);
    const B2p = bodies(kin, q1, q2+eps, mode);
    const B2m = bodies(kin, q1, q2-eps, mode);
    if (!B1p || !B1m || !B2p || !B2m) return null;
    if (B1p.length !== B0.length || B2p.length !== B0.length) return null;

    let M11=0, M12=0, M22=0;
    for (let i=0; i<B0.length; i++) {
        const b0 = B0[i], b1p = B1p[i], b1m = B1m[i], b2p = B2p[i], b2m = B2m[i];
        const Jx1 = (b1p.cmx - b1m.cmx)/(2*eps);
        const Jy1 = (b1p.cmy - b1m.cmy)/(2*eps);
        const Jx2 = (b2p.cmx - b2m.cmx)/(2*eps);
        const Jy2 = (b2p.cmy - b2m.cmy)/(2*eps);
        M11 += b0.mass * (Jx1*Jx1 + Jy1*Jy1);
        M12 += b0.mass * (Jx1*Jx2 + Jy1*Jy2);
        M22 += b0.mass * (Jx2*Jx2 + Jy2*Jy2);
        if (b0.inertia > 0) {
            const Jp1 = wrap(b1p.angle - b1m.angle)/(2*eps);
            const Jp2 = wrap(b2p.angle - b2m.angle)/(2*eps);
            M11 += b0.inertia * Jp1 * Jp1;
            M12 += b0.inertia * Jp1 * Jp2;
            M22 += b0.inertia * Jp2 * Jp2;
        }
    }
    /* Инерция роторов (отражена на обобщённые координаты) */
    for (let i=0; i<2; i++) {
        const inc = kin.jointTypes[i] === 'R' ? I_ROTOR
        : I_ROTOR / Math.pow((kin.cfg.pulleyR||10)*MM, 2);
        if (i === 0) M11 += inc; else M22 += inc;
    }
    M11 += 1e-8; M22 += 1e-8;
    return { M11, M12, M22 };
}

/* Кривая момента NEMA17 */
function availTorque(omega, cfg) {
    const k = 1 - Math.abs(omega) / cfg.omega_zero;
    return Math.max(0, k) * cfg.tau_stall;
}

/* Один шаг */
function step(kin, st, dt) {
    /* НАЧАЛО: читаем состояние в локальные переменные (это было потеряно) */
    const q1 = st.q1, q2 = st.q2, w1 = st.w1, w2 = st.w2;

    const M = massMatrix(kin, q1, q2, st.mode);
    const M11 = M ? M.M11 : 1e-5;
    const M12 = M ? M.M12 : 0;
    const M22 = M ? M.M22 : 1e-5;

    /* -------- PD-регулятор с корректными единицами --------
     *    R-шарнир: обобщённая координата — угол (рад), обобщённая сила —
     *    момент (Н·м). PD выдаёт момент напрямую, обрезается по кривой NEMA17.
     *    P-шарнир: обобщённая координата — смещение (м), обобщённая сила —
     *    сила на каретке (Н). PD выдаёт силу, пересчитываем в эквивалентный
     *    момент τ = F·r, обрезаем τ по кривой NEMA17, возвращаем F = τ/r. */
    const pulley_m = (kin.cfg.pulleyR || 10) * MM;

    function controller(i, q, w, q_target) {
        const e = q_target - q;
        if (kin.jointTypes[i] === 'R') {
            let tau = KP_R * e - KD_R * w;
            const c_max = availTorque(w, kin.cfg);
            tau = Math.max(-c_max, Math.min(c_max, tau));
            return tau;                                   // Н·м
        } else {
            let F = KP_P * e - KD_P * w;                  // Н
            const omega_motor = w / pulley_m;             // рад/с
            const tau_max = availTorque(omega_motor, kin.cfg);
            const F_max = tau_max / pulley_m;             // Н
            F = Math.max(-F_max, Math.min(F_max, F));
            return F;                                     // Н
        }
    }

    const gf1 = controller(0, q1, w1, st.targetQ1);
    const gf2 = controller(1, q2, w2, st.targetQ2);

    /* Для отображения τ₁, τ₂ всегда храним момент на валу (Н·м) */
    st.tau1 = kin.jointTypes[0] === 'R' ? gf1 : gf1 * pulley_m;
    st.tau2 = kin.jointTypes[1] === 'R' ? gf2 : gf2 * pulley_m;

    /* Вязкое трение */
    const bf1 = kin.jointTypes[0]==='R' ? BFRIC_R : BFRIC_P;
    const bf2 = kin.jointTypes[1]==='R' ? BFRIC_R : BFRIC_P;
    const f1 = gf1 - bf1*w1;
    const f2 = gf2 - bf2*w2;

    /* M·α = f */
    const det = M11*M22 - M12*M12;
    let a1, a2;
    if (!isFinite(det) || Math.abs(det) < 1e-12) { a1 = f1/M11; a2 = f2/M22; }
    else { a1 = (M22*f1 - M12*f2)/det; a2 = (-M12*f1 + M11*f2)/det; }
    if (!isFinite(a1)) a1 = 0;
    if (!isFinite(a2)) a2 = 0;

    /* Полунеявный Эйлер */
    let nw1 = w1 + a1*dt, nw2 = w2 + a2*dt;
    const wmax1 = kin.jointTypes[0] === 'R' ? OMEGA_MAX_R : OMEGA_MAX_P;
    const wmax2 = kin.jointTypes[1] === 'R' ? OMEGA_MAX_R : OMEGA_MAX_P;
    nw1 = Math.max(-wmax1, Math.min(wmax1, nw1));
    nw2 = Math.max(-wmax2, Math.min(wmax2, nw2));

    let nq1 = q1 + nw1*dt, nq2 = q2 + nw2*dt;

    /* Лимиты */
    const lims = kin.qLimits();
    const lo1 = kin.jointTypes[0]==='R' ? lims[0][0] : lims[0][0]*MM;
    const hi1 = kin.jointTypes[0]==='R' ? lims[0][1] : lims[0][1]*MM;
    const lo2 = kin.jointTypes[1]==='R' ? lims[1][0] : lims[1][0]*MM;
    const hi2 = kin.jointTypes[1]==='R' ? lims[1][1] : lims[1][1]*MM;
    if (nq1 < lo1) { nq1 = lo1; nw1 = 0; }
    if (nq1 > hi1) { nq1 = hi1; nw1 = 0; }
    if (nq2 < lo2) { nq2 = lo2; nw2 = 0; }
    if (nq2 > hi2) { nq2 = hi2; nw2 = 0; }

    /* Физическая проверка */
    const q1k = kin.jointTypes[0]==='R' ? nq1 : nq1*1000;
    const q2k = kin.jointTypes[1]==='R' ? nq2 : nq2*1000;
    const fk = kin.forward(q1k, q2k, st.mode);
    if (!fk.ok) { st.w1 = 0; st.w2 = 0; st.alpha1 = 0; st.alpha2 = 0; return; }
    if (kin.linksCross(fk.A, fk.B, fk.E)) { st.w1 = 0; st.w2 = 0; st.alpha1 = 0; st.alpha2 = 0; return; }

    /* ПРИНЯТИЕ ШАГА — сюда (в конец!) добавляются alpha, а не в начало */
    st.q1 = nq1; st.q2 = nq2; st.w1 = nw1; st.w2 = nw2;
    st.alpha1 = a1; st.alpha2 = a2;

    if (!isFinite(st.q1) || !isFinite(st.q2) ||
        !isFinite(st.w1) || !isFinite(st.w2)) {
        const dp = kin.defaultPose();
    st.q1 = kin.jointTypes[0]==='R' ? dp.q1 : dp.q1*MM;
    st.q2 = kin.jointTypes[1]==='R' ? dp.q2 : dp.q2*MM;
    st.w1 = 0; st.w2 = 0;
    st.alpha1 = 0; st.alpha2 = 0;
        }
}

function simulate(kin, st, dtTotal) {
    const n = Math.max(1, Math.min(24, Math.ceil(dtTotal / PHYS_DT)));
    const dt = dtTotal / n;
    for (let i = 0; i < n; i++) step(kin, st, dt);
}

return { simulate };
})();
