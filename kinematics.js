/* =====================================================================
 K INEMATICS — четыре независимые схемы манипуляторов                 *
 Геометрия в мм и радианах. Обобщённые координаты q:
 R-шарнир: q в радианах (угол звена)
 P-шарнир: q в мм (смещение каретки)
 ===================================================================== */
"use strict";
const DEG = Math.PI / 180;

/* ---------- Общие утилиты ---------- */
function ci(c1, r1, c2, r2) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > r1 + r2 - 1e-6 || d < Math.abs(r1 - r2) + 1e-6) return [];
  const a = (r1*r1 - r2*r2 + d*d) / (2*d);
  const h = Math.sqrt(Math.max(0, r1*r1 - a*a));
  const mx = c1.x + a*dx/d, my = c1.y + a*dy/d;
  const px = -dy/d*h, py = dx/d*h;
  return [{x: mx+px, y: my+py}, {x: mx-px, y: my-py}];
}

function rc(origin, dir, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y;
  const b = ox*dir.x + oy*dir.y;
  const c = ox*ox + oy*oy - radius*radius;
  const disc = b*b - c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [
    {x: origin.x + (-b+sq)*dir.x, y: origin.y + (-b+sq)*dir.y, t: -b+sq},
    {x: origin.x + (-b-sq)*dir.x, y: origin.y + (-b-sq)*dir.y, t: -b-sq}
  ];
}

function orient(o, a, b) { return (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x); }
function segCross(p1, p2, p3, p4) {
  const d1 = orient(p3,p4,p1), d2 = orient(p3,p4,p2);
  const d3 = orient(p1,p2,p3), d4 = orient(p1,p2,p4);
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function samePt(p, q) { return Math.hypot(p.x-q.x, p.y-q.y) < 1e-3; }

function hull2D(pts) {
  if (!pts || pts.length < 3) return pts || [];
  const p = pts.slice().sort((a,b) => a.x-b.x || a.y-b.y);
  const cr = (o,a,b) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length>=2 && cr(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop(); lo.push(q); }
  for (let i = p.length-1; i>=0; i--) { const q=p[i];
    while (up.length>=2 && cr(up[up.length-2],up[up.length-1],q)<=0) up.pop(); up.push(q); }
    lo.pop(); up.pop();
  return lo.concat(up);
}

/* =====================================================================
 5 R — пятизвенник: два R-мотора + два пассивных звена, сходящихся в E*
 ===================================================================== */
const Kin5R = {
  kind: '5R',
  jointTypes: ['R', 'R'],
  cfg: { L1:150, L2:150, L3a:150, L3b:150,
    P1:{x:-40,y:40}, P2:{x:-40,y:140},
    th1_min:-120, th1_max:120, th2_min:-120, th2_max:120 },
    qLimits() {
      return [[this.cfg.th1_min*DEG, this.cfg.th1_max*DEG],
      [this.cfg.th2_min*DEG, this.cfg.th2_max*DEG]];
    },
    qToDisplay(i, q) { return q / DEG; },
    displayToQ(i, d) { return d * DEG; },
    jointPos(i, q) {
      const P = i === 0 ? this.cfg.P1 : this.cfg.P2;
      const L = i === 0 ? this.cfg.L1 : this.cfg.L2;
      return { x: P.x + L*Math.cos(q), y: P.y + L*Math.sin(q) };
    },
    forward(q1, q2, mode) {
      const A = this.jointPos(0, q1), B = this.jointPos(1, q2);
      const dx = B.x-A.x, dy = B.y-A.y;
      const d = Math.hypot(dx, dy);
      const mid = { x: (A.x+B.x)/2, y: (A.y+B.y)/2 };
      const La = this.cfg.L3a, Lb = this.cfg.L3b;
      if (d < 1e-6 || d > La+Lb-1e-6 || d < Math.abs(La-Lb)+1e-6)
        return { ok:false, A, B, E:mid, d };
      const a = (La*La - Lb*Lb + d*d) / (2*d);
      const h = Math.sqrt(Math.max(0, La*La - a*a));
      const ux = dx/d, uy = dy/d;
      const E = { x: mid.x + mode*(-uy)*h, y: mid.y + mode*ux*h };
      return { ok:true, A, B, E, d, h };
    },
    linksCross(A, B, E) {
      const segs = [[this.cfg.P1, A], [this.cfg.P2, B], [A, E], [B, E]];
      for (let i=0;i<segs.length;i++) for (let j=i+1;j<segs.length;j++) {
        const [a1,a2]=segs[i], [b1,b2]=segs[j];
        if (samePt(a1,b1)||samePt(a1,b2)||samePt(a2,b1)||samePt(a2,b2)) continue;
        if (segCross(a1,a2,b1,b2)) return true;
      }
      return false;
    },
    inverseAll(Ex, Ey, opts) {
      opts = opts || {};
      const E = { x: Ex, y: Ey };
      const lims = this.qLimits();
      const Ac = ci(this.cfg.P1, this.cfg.L1, E, this.cfg.L3a);
      const Bc = ci(this.cfg.P2, this.cfg.L2, E, this.cfg.L3b);
      const out = [];
      for (const A of Ac) for (const B of Bc) {
        const q1 = Math.atan2(A.y-this.cfg.P1.y, A.x-this.cfg.P1.x);
        const q2 = Math.atan2(B.y-this.cfg.P2.y, B.x-this.cfg.P2.x);
        if (q1 < lims[0][0]-1e-6 || q1 > lims[0][1]+1e-6) continue;
        if (q2 < lims[1][0]-1e-6 || q2 > lims[1][1]+1e-6) continue;
        if (this.linksCross(A, B, E)) continue;
        const side = (B.x-A.x)*(E.y-A.y) - (B.y-A.y)*(E.x-A.x);
        const mode = side > 0 ? 1 : -1;
        if (typeof opts.mode === 'number' && mode !== opts.mode) continue;
        const dAB = Math.hypot(B.x-A.x, B.y-A.y);
        const safety = Math.min(dAB/(this.cfg.L3a+this.cfg.L3b),
                                1 - dAB/(this.cfg.L3a+this.cfg.L3b));
        let score = 30*(1-safety);
        if (opts.reference) score += Math.abs(q1-opts.reference.q1) + Math.abs(q2-opts.reference.q2);
        else score += (q1 - q2);
        out.push({ q1, q2, mode, A, B, safety, score });
      }
      out.sort((a,b) => a.score - b.score);
      return out;
    },
    getSag() { return 0; },
    defaultPose() { return { q1: -45*DEG, q2: -45*DEG, mode: -1 }; },
      hull: hull2D
};

/* =====================================================================
 R R — открытая двухзвенная схема (2 мотора соосно на базе)           *
 ===================================================================== */
const KinRR = {
  kind: 'RR',
  jointTypes: ['R', 'R'],
  cfg: { L1:150, L2:150, P1:{x:-40,y:90},
  th1_min:-120, th1_max:120, th2_min:-120, th2_max:120 },
  qLimits() {
    return [[this.cfg.th1_min*DEG, this.cfg.th1_max*DEG],
    [this.cfg.th2_min*DEG, this.cfg.th2_max*DEG]];
  },
  qToDisplay(i, q) { return q / DEG; },
  displayToQ(i, d) { return d * DEG; },
  jointPos(i, q) {
    const P = this.cfg.P1;
    if (i === 0) return { x: P.x + this.cfg.L1*Math.cos(q), y: P.y + this.cfg.L1*Math.sin(q) };
    return null;
  },
  forward(q1, q2, mode) {
    const P = this.cfg.P1;
    const A = { x: P.x + this.cfg.L1*Math.cos(q1), y: P.y + this.cfg.L1*Math.sin(q1) };
    const E = { x: A.x + this.cfg.L2*Math.cos(q2), y: A.y + this.cfg.L2*Math.sin(q2) };
    return { ok:true, A, B:null, E, d:0, h:0 };
  },
  linksCross() { return false; },
  inverseAll(Ex, Ey, opts) {
    opts = opts || {};
    const lims = this.qLimits();
    const P = this.cfg.P1;
    const dx = Ex - P.x, dy = Ey - P.y;
    const r = Math.hypot(dx, dy);
    if (r > this.cfg.L1 + this.cfg.L2 + 1e-6 || r < Math.abs(this.cfg.L1 - this.cfg.L2) - 1e-6) return [];
    const cosA = (this.cfg.L1*this.cfg.L1 + r*r - this.cfg.L2*this.cfg.L2) / (2*this.cfg.L1*r);
    if (Math.abs(cosA) > 1) return [];
    const acosA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const base = Math.atan2(dy, dx);
    const out = [];
    for (const sign of [1, -1]) {
      const q1 = base + sign*acosA;
      if (q1 < lims[0][0]-1e-6 || q1 > lims[0][1]+1e-6) continue;
      const A = { x: P.x + this.cfg.L1*Math.cos(q1), y: P.y + this.cfg.L1*Math.sin(q1) };
      const q2 = Math.atan2(Ey - A.y, Ex - A.x);
      if (q2 < lims[1][0]-1e-6 || q2 > lims[1][1]+1e-6) continue;
      let score = 0;
      if (opts.reference) score = Math.abs(q1-opts.reference.q1) + Math.abs(q2-opts.reference.q2);
      out.push({ q1, q2, mode: 0, A, B: null, safety: 1, score });
    }
    out.sort((a,b) => a.score - b.score);
    return out;
  },
  getSag() { return 0; },
  defaultPose() { return { q1: -45*DEG, q2: 45*DEG, mode: 0 }; },
    hull: hull2D
};

/* =====================================================================
 * RP — вращающаяся рейка (Revolute-Prismatic, coaxial motors)
 * ---------------------------------------------------------------------
 * Оба мотора расположены в одной точке P1 = P2 (в 3D — соосно,
 * друг над другом). Мотор 1 вращает рейку на угол q1, мотор 2 через
 * ремень перемещает каретку вдоль рейки на расстояние q2.
 * E = P1 + q2 · (cos q1, sin q1).
 * ===================================================================== */
const KinRP = {
  kind: 'RP',
  jointTypes: ['R', 'P'],
  cfg: {
    P1: { x: -40, y: 90 },      // общая точка обоих моторов
    s_min: 20, s_max: 260,
    th1_min: -180, th1_max: 180,
    pulleyR: 10                 // радиус шкива для ремня (мм)
  },
  qLimits() {
    return [[this.cfg.th1_min * DEG, this.cfg.th1_max * DEG],
    [this.cfg.s_min, this.cfg.s_max]];
  },
  qToDisplay(i, q) { return i === 0 ? q / DEG : q; },
  displayToQ(i, d) { return i === 0 ? d * DEG : d; },
  jointPos(i, q) {
    // оба мотора в одной точке — проекция совпадает
    return { x: this.cfg.P1.x, y: this.cfg.P1.y };
  },
  forward(q1, q2, mode) {
    const ux = Math.cos(q1), uy = Math.sin(q1);
    const E = { x: this.cfg.P1.x + q2 * ux, y: this.cfg.P1.y + q2 * uy };
    return { ok: true,
      A: { x: this.cfg.P1.x, y: this.cfg.P1.y },  // база рейки
      B: null, E, d: q2, h: 0 };
  },
  linksCross() { return false; },   // одна рейка — пересечений нет
  inverseAll(Ex, Ey, opts) {
    const dx = Ex - this.cfg.P1.x, dy = Ey - this.cfg.P1.y;
    const q2 = Math.hypot(dx, dy);
    const q1 = Math.atan2(dy, dx);
    const lims = this.qLimits();
    if (q1 < lims[0][0] - 1e-6 || q1 > lims[0][1] + 1e-6) return [];
    if (q2 < lims[1][0] - 1e-6 || q2 > lims[1][1] + 1e-6) return [];
    let score = 0;
    if (opts.reference) {
      score = Math.abs(q1 - opts.reference.q1) + Math.abs(q2 - opts.reference.q2);
    }
    return [{ q1, q2, mode: 0,
      A: { x: this.cfg.P1.x, y: this.cfg.P1.y }, B: null,
      E: { x: Ex, y: Ey }, safety: 1, score }];
  },
  getSag() { return 0; },
  defaultPose() { return { q1: 0, q2: 150, mode: 0 }; },
    hull: hull2D
};

/* =====================================================================
 * PP — декартов (Prismatic-Prismatic)
 * ---------------------------------------------------------------------
 * Две каретки на перпендикулярных рельсах. E — точка пересечения
 * перпендикуляров к рельсам (для ортогональных рельсов это просто
 * (s1, s2) в системе базы).
 * ===================================================================== */
const KinPP = {
  kind: 'PP',
  jointTypes: ['P', 'P'],
  cfg: {
    P1: { x: -40, y: 100 }, P2: { x: -40, y: 200 },
    rail1_angle: 0, rail2_angle: 90,
    s1_min: 0, s1_max: 280,
    s2_min: 0, s2_max: 200,
    sag_k: 0.03, M_PAYLOAD: 0.007
  },
  qLimits() {
    return [[this.cfg.s1_min, this.cfg.s1_max],
    [this.cfg.s2_min, this.cfg.s2_max]];
  },
  qToDisplay(i, q) { return q; },
  displayToQ(i, d) { return d; },
  jointPos(i, q) {
    const P = i === 0 ? this.cfg.P1 : this.cfg.P2;
    const a = (i === 0 ? this.cfg.rail1_angle : this.cfg.rail2_angle) * DEG;
    return { x: P.x + q * Math.cos(a), y: P.y + q * Math.sin(a) };
  },
  forward(q1, q2, mode) {
    const A = this.jointPos(0, q1);
    const B = this.jointPos(1, q2);
    const a1 = this.cfg.rail1_angle * DEG;
    const a2 = this.cfg.rail2_angle * DEG;
    const u1 = { x: Math.cos(a1), y: Math.sin(a1) };
    const u2 = { x: Math.cos(a2), y: Math.sin(a2) };
    const c1 = A.x * u1.x + A.y * u1.y;
    const c2 = B.x * u2.x + B.y * u2.y;
    const det = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(det) < 1e-6) return { ok: false, A, B, E: A, d: 0, h: 0 };
    const Ex = (c1 * u2.y - c2 * u1.y) / det;
    const Ey = (u1.x * c2 - u2.x * c1) / det;
    return { ok: true, A, B, E: { x: Ex, y: Ey }, d: 0, h: 0 };
  },
  linksCross() { return false; },
  inverseAll(Ex, Ey, opts) {
    const lims = this.qLimits();
    const a1 = this.cfg.rail1_angle * DEG;
    const a2 = this.cfg.rail2_angle * DEG;
    const u1 = { x: Math.cos(a1), y: Math.sin(a1) };
    const u2 = { x: Math.cos(a2), y: Math.sin(a2) };
    const s1 = (Ex - this.cfg.P1.x) * u1.x + (Ey - this.cfg.P1.y) * u1.y;
    const s2 = (Ex - this.cfg.P2.x) * u2.x + (Ey - this.cfg.P2.y) * u2.y;
    if (s1 < lims[0][0] - 1e-6 || s1 > lims[0][1] + 1e-6) return [];
    if (s2 < lims[1][0] - 1e-6 || s2 > lims[1][1] + 1e-6) return [];
    let score = 0;
    if (opts.reference) {
      score = Math.abs(s1 - opts.reference.q1) + Math.abs(s2 - opts.reference.q2);
    }
    return [{ q1: s1, q2: s2, mode: 0,
      A: this.jointPos(0, s1), B: this.jointPos(1, s2),
      safety: 1, score }];
  },
  getSag(Ex, Ey) {
    const cx = (this.cfg.s1_min + this.cfg.s1_max) / 2;
    const cy = (this.cfg.s2_min + this.cfg.s2_max) / 2;
    const d2 = (Ex - cx) * (Ex - cx) + (Ey - cy) * (Ey - cy);
    return this.cfg.sag_k * d2 * this.cfg.M_PAYLOAD;
  },
  // KinPP.defaultPose:
  defaultPose() { return { q1: 172, q2: 170, mode: 0 }; },
    hull: hull2D
};

const SCHEMES = { '5R': Kin5R, 'RR': KinRR, 'RP': KinRP, 'PP': KinPP };
