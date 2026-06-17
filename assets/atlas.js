/* DAFT attachment atlas - interactive viewer.
 * The scene is precomputed by build_atlas.py; this file only renders + toggles.
 * SVG is built as strings so renderScene() runs in the browser and in Node
 * (offline verification). No DAFT quantity is computed here.
 *
 *  Tab 1 "Explore": click a branch -> focal; click a connector -> inspect + fg/bg.
 *  Tab 2 "Group into events": curate DAFT connectors into human introgression events;
 *        the master panel tallies how many events each connector lands in.
 */
(function (global) {
  'use strict';

  var PAD_L = 50, PAD_R = 104, PAD_T = 54, PAD_B = 24;
  var UNIT_X = 108, UNIT_Y = 66;
  var CONN_FG_W = 2.6, CONN_BG_W = 0.65;          // background connectors: 50% thinner
  var FG_OP_DIR = 0.6, FG_OP_NNI = 0.78, BG_OP = 0.1875;   // ...and 25% more transparent
  var OFF = 17;
  var GREEN = '#1b7837', GREY = '#bdbdbd', GREY_TREE = '#8c8c8c';
  var EVENT_PALETTE = ['#e7298a', '#1b9e77', '#e6ab02', '#d62728', '#17becf',
    '#8c564b', '#bcbd22', '#7b3294', '#2c7fb8', '#d95f0e'];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function ckey(hex) { return hex.replace('#', ''); }
  function f1(n) { return Math.round(n * 10) / 10; }
  function kindLabel(k) { return k === 'bi' ? '2-way' : (k === 'nni1' ? 'NNI=1' : '1-way'); }
  function connText(e) {
    return (e.recipient == null) ? (e.n1 + ' ↔ ' + e.n2) : (e.donor + ' → ' + e.recipient);
  }

  // =====================================================================
  //  GENERIC SCENE RENDERER  (driven entirely by an explicit `view`)
  // =====================================================================
  var _seq = 0;   // unique marker-id prefix per rendered SVG (avoids cross-SVG id clashes)

  function defs(scene, sc, idp) {
    // Arrowheads in strokeWidth units, so the head scales with the connector's width (thick,
    // high-z connectors keep a proportional, visible arrowhead). sc rides in via the stroke width.
    var ah = 3.4, mw = ah + 0.2, rC = ah / 2;        // triangle ~3.4 stroke-widths wide/tall
    var pE = 'M0,0 L0,' + ah + ' L' + ah + ',' + rC + ' z';
    var pS = 'M' + ah + ',0 L' + ah + ',' + ah + ' L0,' + rC + ' z';
    var cols = {}; scene.events.forEach(function (e) { cols[e.color] = 1; });
    var s = '<defs>';
    Object.keys(cols).forEach(function (c) {
      var k = idp + ckey(c);
      s += '<marker id="aE_' + k + '" markerUnits="strokeWidth" markerWidth="' + mw + '" markerHeight="' + ah +
        '" refX="' + ah + '" refY="' + rC + '" orient="auto"><path d="' + pE + '" fill="' + c + '"/></marker>';
      s += '<marker id="aS_' + k + '" markerUnits="strokeWidth" markerWidth="' + mw + '" markerHeight="' + ah +
        '" refX="0" refY="' + rC + '" orient="auto"><path d="' + pS + '" fill="' + c + '"/></marker>';
    });
    return s + '</defs>';
  }

  function tree(scene, sx, sy, cladeSet, hasFocal, sc) {
    sc = sc || 1;
    var p = [];
    scene.nodes.forEach(function (n) {
      var inC = cladeSet[n.id];
      var col = hasFocal ? (inC ? GREEN : GREY) : GREY_TREE;
      var w = f1((hasFocal ? (inC ? 2.2 : 1.1) : 1.2) * sc);
      if (n.px !== null && n.px !== undefined) {
        p.push('<line x1="' + f1(sx(n.px)) + '" y1="' + f1(sy(n.y)) + '" x2="' + f1(sx(n.x)) +
          '" y2="' + f1(sy(n.y)) + '" stroke="' + col + '" stroke-width="' + w + '"/>');
      }
      if (n.kind === 'internal' && n.vbar) {
        p.push('<line x1="' + f1(sx(n.x)) + '" y1="' + f1(sy(n.vbar[0])) + '" x2="' + f1(sx(n.x)) +
          '" y2="' + f1(sy(n.vbar[1])) + '" stroke="' + col + '" stroke-width="' + w + '"/>');
      }
      if (n.kind === 'leaf') {
        var lc = hasFocal ? (inC ? GREEN : '#666') : '#555';
        p.push('<text x="' + f1(sx(n.x) + 8 * sc) + '" y="' + f1(sy(n.y)) + '" font-size="' + f1(12.5 * sc) +
          '" font-style="italic" font-weight="' + (inC ? '700' : '400') + '" fill="' + lc +
          '" dominant-baseline="central">' + esc(n.label) + '</text>');
      }
    });
    scene.nodes.forEach(function (n) {
      if (!n.selectable || n.px === null || n.px === undefined) return;
      p.push('<line class="branch-hit" data-branch="' + esc(n.id) + '" stroke="transparent" stroke-width="16" x1="' +
        f1(sx(n.px)) + '" y1="' + f1(sy(n.y)) + '" x2="' + f1(sx(n.x)) + '" y2="' + f1(sy(n.y)) + '"/>');
    });
    return p.join('');
  }

  function controlPoint(A, B) {
    var midx = (A[0] + B[0]) / 2, midy = (A[1] + B[1]) / 2;
    var dx = B[0] - A[0], dy = B[1] - A[1], rad = 0.28;
    var ox = rad * dy, oy = -rad * dx;
    return (midx + ox < midx - ox) ? [midx + ox, midy + oy] : [midx - ox, midy - oy];
  }

  function badge(e, M, isFg, view, sc) {
    sc = sc || 1;
    var bgf = (view.bgFade == null) ? 1 : view.bgFade;
    var r = (isFg ? 10 : 7) * sc, fsz = (isFg ? 12.5 : 9) * sc, op = isFg ? 1 : f1(0.5 * bgf), sw = f1((isFg ? 1.4 : 0.8) * sc);
    var s = '<g opacity="' + op + '"><circle cx="' + f1(M[0]) + '" cy="' + f1(M[1]) + '" r="' + f1(r) +
      '" fill="#fff" stroke="' + e.color + '" stroke-width="' + sw + '"/>' +
      '<text x="' + f1(M[0]) + '" y="' + f1(M[1]) + '" font-size="' + f1(fsz) + '" fill="' + e.color +
      '" font-weight="700" text-anchor="middle" dominant-baseline="central">' + e.num + '</text></g>';
    if (view.countOf) {                       // inclusion-count chip (top panel)
      var c = view.countOf[e.num] || 0;
      var tint = (view.tint && view.tint[e.num]) || '#bbb';
      var cx = M[0] + r * 0.95, cy = M[1] - r * 0.95;
      s += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(7.5 * sc) + '" fill="' + tint + '" stroke="#fff" stroke-width="' + f1(sc) + '"/>' +
        '<text x="' + f1(cx) + '" y="' + f1(cy) + '" font-size="' + f1(9.5 * sc) + '" fill="#fff" font-weight="700" ' +
        'text-anchor="middle" dominant-baseline="central">' + c + '</text>';
    }
    if (view.selected === e.num) {
      s += '<circle cx="' + f1(M[0]) + '" cy="' + f1(M[1]) + '" r="' + f1(r + 4 * sc) +
        '" fill="none" stroke="#222" stroke-dasharray="2 2" stroke-width="' + f1(1.2 * sc) + '"/>';
    }
    return s;
  }

  function connectors(scene, sx, sy, view, sc, idp) {
    sc = sc || 1;
    var widthBy = view.widthBy || 'equal', maxAbs = 0;
    var bgf = (view.bgFade == null) ? 1 : view.bgFade;            // 1 = current, 0 = invisible
    if (widthBy !== 'equal') scene.events.forEach(function (e) { var z = zMetric(e, widthBy); if (z != null) maxAbs = Math.max(maxAbs, Math.abs(z)); });
    var bg = [], fg = [], hits = [], badges = [];
    scene.events.forEach(function (e) {
      var A = [sx(e.a[0]), sy(e.a[1])], B = [sx(e.b[0]), sy(e.b[1])];
      var C = controlPoint(A, B);
      var d = 'M' + f1(A[0]) + ',' + f1(A[1]) + ' Q' + f1(C[0]) + ',' + f1(C[1]) + ' ' + f1(B[0]) + ',' + f1(B[1]);
      var isFg = !!view.fg[e.num], k = idp + ckey(e.color);
      var op = isFg ? (e.kind === 'nni1' ? FG_OP_NNI : FG_OP_DIR) : f1(BG_OP * bgf);
      // width: equal default; or, for FOREGROUND connectors only, proportional to the chosen z
      // (missing z -> dotted at default width). Background connectors always stay thin.
      var w, dash = '';
      if (widthBy === 'equal' || !isFg) { w = (isFg ? CONN_FG_W : CONN_BG_W) * sc; }
      else {
        var z = zMetric(e, widthBy);
        if (z == null) { w = CONN_FG_W * sc; dash = ' stroke-dasharray="' + f1(2.2 * sc) + ' ' + f1(2.6 * sc) + '"'; }
        else { w = (0.8 + (maxAbs > 0 ? Math.abs(z) / maxAbs : 0) * 5.5) * sc; }
      }
      w = f1(w);
      var mk = (e.kind === 'nni1') ? ''                                       // no arrowheads on NNI=1
        : (e.kind === 'uni') ? 'marker-end="url(#aE_' + k + ')"'
          : 'marker-end="url(#aE_' + k + ')" marker-start="url(#aS_' + k + ')"';
      (isFg ? fg : bg).push('<g opacity="' + op + '"><path d="' + d + '" fill="none" stroke="' + e.color +
        '" stroke-width="' + w + '" stroke-linecap="round"' + dash + ' ' + mk + '/></g>');
      hits.push('<path class="conn-hit" data-ev="' + e.num + '" fill="none" stroke="transparent" stroke-width="' +
        f1(Math.max(16, w * 2.5)) + '" d="' + d + '"/>');
      var M = [0.25 * A[0] + 0.5 * C[0] + 0.25 * B[0], 0.25 * A[1] + 0.5 * C[1] + 0.25 * B[1]];
      badges.push(badge(e, M, isFg, view, sc));
      // NNI=1 sibling Z on the arc (two lines: raw + corrected) -- only in the explore/focal view
      if (view.arcLabels && view.annotated && view.annotated[e.num] && e.kind === 'nni1' && e.s_label) {
        var sl = e.s_label;
        badges.push('<text x="' + f1(M[0] - 15 * sc) + '" y="' + f1(M[1] - 6 * sc) + '" font-size="' + f1(9 * sc) + '" fill="' + e.color +
          '" font-weight="700" text-anchor="end" dominant-baseline="central">Zsr ' + zfmt(sl.raw, sl.rawSig) + '</text>');
        badges.push('<text x="' + f1(M[0] - 15 * sc) + '" y="' + f1(M[1] + 6 * sc) + '" font-size="' + f1(9 * sc) + '" fill="' + e.color +
          '" font-weight="700" text-anchor="end" dominant-baseline="central">Zsc ' + zfmt(sl.corr, sl.corrSig) + '</text>');
      }
    });
    return { bg: bg.join(''), fg: fg.join(''), hits: hits.join(''), badges: badges.join('') };
  }

  function boxEl(x, y, text, o, sc) {
    o = o || {}; sc = sc || 1;
    var font = (o.font || 11) * sc, weight = o.weight || '400';
    var w = text.length * (font * 0.62) + 10 * sc, h = font + 6 * sc, align = o.align || 'center', rx, tx, anc;
    if (align === 'right') { rx = x - w; tx = x - 5 * sc; anc = 'end'; }
    else if (align === 'left') { rx = x; tx = x + 5 * sc; anc = 'start'; }
    else { rx = x - w / 2; tx = x; anc = 'middle'; }
    return '<g><rect x="' + f1(rx) + '" y="' + f1(y - h / 2) + '" width="' + f1(w) + '" height="' + f1(h) +
      '" rx="' + f1(4 * sc) + '" fill="#fff" fill-opacity="0.92" stroke="' + (o.edge || '#999') + '" stroke-width="' + f1(0.8 * sc) + '"/>' +
      '<text x="' + f1(tx) + '" y="' + f1(y) + '" font-size="' + f1(font) + '" font-weight="' + weight + '" fill="' +
      (o.fill || '#000') + '" text-anchor="' + anc + '" dominant-baseline="central"' +
      (o.italic ? ' font-style="italic"' : '') + '>' + esc(text) + '</text></g>';
  }
  function zfmt(z, sig) { return (z === null || z === undefined) ? 'NA' : ((+z).toFixed(1) + (sig ? '*' : '')); }
  function zbFromDetail(d) { return (d && (d.z != null || d.z_raw != null)) ? { raw: d.z_raw, rawSig: d.z_raw_sig, corr: d.z, corrSig: d.sig } : null; }
  function zMetric(e, by) {
    var d = e.detail;
    if (by === 'Zur') return d.u ? d.u.z_raw : null;
    if (by === 'Zuc') return d.u ? d.u.z : null;
    if (by === 'Zsr') return d.s ? d.s.z_raw : null;
    if (by === 'Zsc') return d.s ? d.s.z : null;
    return null;
  }

  function twoLineBoxEl(x, y, l1, l2, o, sc) {
    o = o || {}; sc = sc || 1;
    var font = (o.font || 9.5) * sc, w = Math.max(l1.length, l2.length) * font * 0.6 + 8 * sc, lh = font + 2.5 * sc, h = 2 * lh + 4 * sc;
    var align = o.align || 'center', rx, tx, anc;
    if (align === 'right') { rx = x - w; tx = x - 4 * sc; anc = 'end'; }
    else if (align === 'left') { rx = x; tx = x + 4 * sc; anc = 'start'; }
    else { rx = x - w / 2; tx = x; anc = 'middle'; }
    return '<g><rect x="' + f1(rx) + '" y="' + f1(y - h / 2) + '" width="' + f1(w) + '" height="' + f1(h) +
      '" rx="' + f1(3 * sc) + '" fill="#fff" fill-opacity="0.92" stroke="' + (o.edge || '#999') + '" stroke-width="' + f1(0.8 * sc) + '"/>' +
      '<text x="' + f1(tx) + '" y="' + f1(y - lh / 2) + '" font-size="' + f1(font) + '" fill="' + (o.fill || '#000') +
      '" text-anchor="' + anc + '" dominant-baseline="central">' + esc(l1) + '</text>' +
      '<text x="' + f1(tx) + '" y="' + f1(y + lh / 2) + '" font-size="' + f1(font) + '" fill="' + (o.fill || '#000') +
      '" text-anchor="' + anc + '" dominant-baseline="central">' + esc(l2) + '</text></g>';
  }

  // directed box: total (+ directional) above; two-line Zur/Zuc (uncle) & Zsr/Zsc (sibling) below.
  // showRaw -> the above row; showZ -> the below rows. directional/u may be null (nni1).
  function directedBoxEl(X, Y, total, edge, directional, u, s, ec, showRaw, showZ, sc) {
    ec = ec || '#1f78b4'; sc = sc || 1;
    var yT = Y - OFF * sc, yB = Y + (OFF + 6) * sc, g = 2 * sc, out = '';
    if (showRaw !== false) {
      if (directional) {
        out += boxEl(X - g, yT, String(total), { fill: '#000', edge: edge, align: 'right' }, sc) +
          boxEl(X + g, yT, directional.label, { fill: directional.color, edge: directional.color, weight: '700', align: 'left' }, sc);
      } else out += boxEl(X, yT, String(total), { fill: '#000', edge: edge }, sc);
    }
    if (showZ !== false) {
      if (u) out += twoLineBoxEl(X - g, yB, 'Zur ' + zfmt(u.raw, u.rawSig), 'Zuc ' + zfmt(u.corr, u.corrSig), { fill: ec, edge: ec, align: (s ? 'right' : 'center') }, sc);
      if (s) out += twoLineBoxEl((u ? X + g : X), yB, 'Zsr ' + zfmt(s.raw, s.rawSig), 'Zsc ' + zfmt(s.corr, s.corrSig), { fill: ec, edge: ec, align: (u ? 'left' : 'center') }, sc);
    }
    return out;
  }

  function boxes(boxList, nodeById, sx, sy, ctx) {
    if (!boxList) return '';
    ctx = ctx || {};
    var annotated = ctx.annotated, override = ctx.override, sc = ctx.sc || 1, out = [];
    boxList.forEach(function (b) {
      if (override && b.branch === override.branch) return;   // the selected connector replaces this branch's box
      var n = nodeById[b.branch], X = sx((n.px + n.x) / 2), Y = sy(n.y) + (b.stack || 0) * 64 * sc;
      if (b.type === 'zero') { out.push(boxEl(X, Y, '0', { fill: '#737373', edge: '#9e9e9e', font: 10 }, sc)); return; }
      if (b.type === 'na') { out.push(boxEl(X, Y, 'NA', { fill: '#8c8c8c', edge: '#c7c7c7', font: 10, italic: true }, sc)); return; }
      if ((b.directional || b.u || b.s) && annotated && annotated[b.connector]) {
        out.push(directedBoxEl(X, Y, b.total, b.edge, b.directional, b.u, b.s, b.excess_color, ctx.showRaw, ctx.showZ, sc));
      } else out.push(boxEl(X, Y, String(b.total), { fill: '#000', edge: b.edge || '#999' }, sc));
    });
    if (override) {                                            // the just-clicked connector's data, on its donor branch
      var nn = nodeById[override.branch];
      if (nn) out.push(directedBoxEl(sx((nn.px + nn.x) / 2), sy(nn.y), override.total, override.edge,
        override.directional, override.u, override.s, override.excess_color, ctx.showRaw, ctx.showZ, sc));
    }
    return out.join('');
  }

  // title block grows with the element scale: lower baselines + wider title/subtitle spacing,
  // and the tree origin (topH) drops below it so they never collide.
  function titleLayout(sc, hasSub) {
    var tF = 15 * sc, sF = 11.5 * sc;
    var titleY = 5 + tF;
    var subY = titleY + tF * 0.35 + sF * 1.2;
    var topH = (hasSub ? subY : titleY) + Math.max(16, 12 * sc);
    return { tF: tF, sF: sF, titleY: titleY, subY: subY, topH: topH };
  }

  function renderScene(scene, view, opts) {
    var uy = (opts && opts.unitY) || UNIT_Y;
    var sc = (opts && opts.scale) || 1;
    var idp = 'a' + (_seq++) + '_';
    var tl = titleLayout(sc, !!view.subtitle);
    var L = scene.layout, W = PAD_L + L.maxd * UNIT_X + PAD_R, H = tl.topH + (L.nleaves - 1) * uy + PAD_B;
    var sx = function (x) { return PAD_L + x * UNIT_X; }, sy = function (y) { return tl.topH + y * uy; };
    var nodeById = {}; scene.nodes.forEach(function (n) { nodeById[n.id] = n; });
    var conn = connectors(scene, sx, sy, view, sc, idp);
    var t = '<text x="' + PAD_L + '" y="' + f1(tl.titleY) + '" font-size="' + f1(tl.tF) + '" font-weight="700">' + esc(view.title) + '</text>';
    if (view.subtitle) t += '<text x="' + PAD_L + '" y="' + f1(tl.subY) + '" font-size="' + f1(tl.sF) + '" fill="#666">' + esc(view.subtitle) + '</text>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
      defs(scene, sc, idp) + t + tree(scene, sx, sy, view.clade, view.hasFocal, sc) +
      conn.bg + boxes(view.boxes, nodeById, sx, sy, { annotated: view.annotated, override: view.override, showRaw: view.showRaw, showZ: view.showZ, sc: sc }) +
      conn.fg + conn.badges + conn.hits + '</svg>';
  }

  // =====================================================================
  //  TAB 1: EXPLORE
  // =====================================================================
  function fgSetFor(scene, state) {
    var focal = state.focal ? scene.focals[state.focal] : null, set = {};
    scene.events.forEach(function (e) {
      var fg = focal ? (focal.foreground_event_ids.indexOf(e.num) >= 0) : true;
      if (state.overrides && Object.prototype.hasOwnProperty.call(state.overrides, e.num)) fg = state.overrides[e.num] === 'fg';
      if (fg) set[e.num] = true;
    });
    return set;
  }
  function buildExploreView(scene, state, nodeById) {
    var focal = state.focal ? scene.focals[state.focal] : null, clade = {};
    if (focal) focal.clade.forEach(function (id) { clade[id] = 1; });
    var fg = fgSetFor(scene, state);
    // annotations show for connectors INCOMING to the focal (that are still foreground), plus the
    // just-clicked connector. A clicked directed connector also OVERRIDES the box on its donor branch.
    var annotated = {}, override = null;
    if (focal) {
      focal.foreground_event_ids.forEach(function (num) { if (fg[num]) annotated[num] = 1; });
      if (state.selected != null && fg[state.selected]) {
        annotated[state.selected] = 1;
        var se = null; scene.events.forEach(function (e) { if (e.num === state.selected) se = e; });
        if (se && se.recipient != null && !clade[se.donor] && se.donor !== state.focal) {
          var c1 = se.detail.count1.v, c2 = se.detail.count2.v, mj = Math.max(c1, c2), mn = Math.min(c1, c2);
          override = {
            branch: se.donor, total: se.detail.total, edge: '#999999', excess_color: se.color,
            directional: { label: (se.kind === 'bi' ? mj + '/' + mn : '' + mj), color: se.color },
            u: zbFromDetail(se.detail.u), s: zbFromDetail(se.detail.s)
          };
        }
      }
    }
    var title, sub;
    if (!focal) {
      var c = scene.all_events.counts;
      title = 'All connectors';
      sub = c.uni + ' unidirectional (orange), ' + c.bi + ' bidirectional (purple), ' + c.nni1 + ' NNI=1 (blue)';
    } else {
      title = 'Clade ' + nodeById[state.focal].label;
      var nums = focal.foreground_event_ids;
      sub = nums.length ? ('highlights connector' + (nums.length > 1 ? 's ' : ' ') + nums.join(', ')) : 'no connectors point into this branch';
    }
    return {
      fg: fg, clade: clade, hasFocal: !!focal, boxes: focal ? focal.boxes : null,
      selected: state.selected, countOf: null, tint: null, annotated: annotated, override: override,
      arcLabels: true, widthBy: state.widthBy, bgFade: state.bgFade,
      title: title, subtitle: sub
    };
  }

  function detailHTML(scene, state) {
    if (state.selected == null) {
      return '<div class="detail-empty">Click a connector to see the numbers behind it &mdash; counts, the ' +
        '<b>u</b>/<b>s</b> excess, Z-scores, NNI distance, and the exact <code>Summary.csv</code> line each value comes from.</div>';
    }
    var e = null; scene.events.forEach(function (x) { if (x.num === state.selected) e = x; });
    if (!e) return '';
    var d = e.detail, sw = '<span class="swatch-inline" style="background:' + e.color + '"></span>';
    var head = (e.recipient == null) ? (e.n1 + ' &harr; ' + e.n2) : (e.donor + ' &rarr; ' + e.recipient);
    var kind = (e.recipient == null) ? 'NNI=1 (direction not estimable)' : (e.kind === 'bi' ? 'bidirectional' : 'unidirectional');
    var fg = fgSetFor(scene, state);
    var h = '<h3>' + sw + 'Connector ' + e.num + ' &middot; ' + head + '</h3>' +
      '<div class="detail-sub">' + kind + ' &middot; currently <b>' + (fg[e.num] ? 'foreground' : 'background') +
      '</b> (click the connector again to toggle)</div>';
    function star(sig) { return sig ? ' <span class="sig">*</span>' : ''; }
    function zcell(z, sig) { return (z === null || z === undefined) ? 'NA' : ((+z).toFixed(1) + star(sig)); }
    function lin(c) { return (c === null || c === undefined || c === '') ? 'NA' : esc(c); }
    var u = d.u || {}, s = d.s || {};
    var bz = (d.z_bidirectional === null || d.z_bidirectional === undefined || d.z_bidirectional === '')
      ? null : Math.round(parseFloat(d.z_bidirectional) * 10) / 10;
    var rows = [
      ['total attachments', d.total],
      ['NNI distance', d.nni],
      [esc(d.count1.lineage) + ' moved', d.count1.v],
      [esc(d.count2.lineage) + ' moved', d.count2.v],
      ['uncle lineage', lin(u.comp)],
      ['sister lineage', lin(s.comp)],
      ['Zur (uncle, raw)', zcell(u.z_raw, u.z_raw_sig)],
      ['Zuc (uncle, corrected)', zcell(u.z, u.sig)],
      ['Zsr (sibling, raw)', zcell(s.z_raw, s.z_raw_sig)],
      ['Zsc (sibling, corrected)', zcell(s.z, s.sig)],
      ['bidirectional Z', zcell(bz, bz !== null && bz <= -1.96)]
    ];
    h += '<div class="kv">' + rows.map(function (r) {
      return '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>';
    }).join('') + '</div>';
    if (u.z != null) h += '<div class="prov">uncle: <code>' + esc(u.src) + '</code> &middot; ' + esc(u.note) + '</div>';
    if (s.z != null) h += '<div class="prov">sister: <code>' + esc(s.src) + '</code> &middot; ' + esc(s.note) + '</div>';
    return h;
  }

  function legendHTML() {
    return '<h3>Legend</h3>' +
      '<div class="leg-row"><span class="leg-swatch" style="border-top-color:#d95f02"></span>unidirectional</div>' +
      '<div class="leg-row"><span class="leg-swatch" style="border-top-color:#6a3d9a"></span>bidirectional</div>' +
      '<div class="leg-row"><span class="leg-swatch" style="border-top-color:#1f78b4"></span>NNI=1 (undirected)</div>' +
      '<div class="leg-row"><span class="leg-swatch" style="border-top-color:#1b7837"></span>focal branch / clade</div>' +
      '<div class="leg-row"><span class="leg-dot"></span>numbered connector (faint = background)</div>' +
      '<div style="margin-top:8px;color:#777">Boxes: black = total attachments; coloured = directional count. ' +
      'Below the branch: <b>Zur</b>/<b>Zuc</b> = raw/corrected <b>u</b>ncle Z, <b>Zsr</b>/<b>Zsc</b> = raw/corrected ' +
      '<b>s</b>ibling Z (<b>*</b> = that value is significant, &le; &minus;1.96). A connector is shown only when ' +
      'both the raw and corrected Z are significant for at least one of the avuncular / sibling tests.</div>';
  }

  // =====================================================================
  //  TAB 2: GROUP INTO EVENTS
  // =====================================================================
  function eventByNumMap(scene) { var m = {}; scene.events.forEach(function (e) { m[e.num] = e; }); return m; }

  function tallyOf(scene, curation) {
    var map = {}; scene.events.forEach(function (e) { map[e.num] = { count: 0, events: [] }; });
    curation.events.forEach(function (ev) {
      ev.connectors.forEach(function (num) { if (map[num]) { map[num].count++; map[num].events.push(ev); } });
    });
    return map;
  }

  function buildTopView(scene, curation, sel, opts) {
    var tally = tallyOf(scene, curation), fg = {}, countOf = {}, tint = {};
    scene.events.forEach(function (e) {
      var t = tally[e.num];
      countOf[e.num] = t.count;
      fg[e.num] = t.count > 0;
      tint[e.num] = t.count === 0 ? '#bbb' : (t.count === 1 ? t.events[0].color : '#444');
    });
    var ne = curation.events.length;
    var assigned = scene.events.filter(function (e) { return tally[e.num].count > 0; }).length;
    return {
      fg: fg, clade: {}, hasFocal: false, boxes: null, selected: sel, countOf: countOf, tint: tint,
      widthBy: opts && opts.widthBy, bgFade: opts && opts.bgFade,
      title: 'All connectors', subtitle: assigned + ' of ' + scene.events.length + ' connectors grouped into ' +
        ne + ' event' + (ne === 1 ? '' : 's')
    };
  }

  // boxes for an event card: each connector's data on its donor branch (directed) or lower
  // endpoint (nni1). showRaw -> attachment counts above; showZ -> Zur/Zuc/Zsr/Zsc below.
  function eventBoxes(scene, ev) {
    var byNum = {}; scene.events.forEach(function (e) { byNum[e.num] = e; });
    var yOf = {}; scene.nodes.forEach(function (n) { yOf[n.id] = n.y; });
    var out = [];
    ev.connectors.forEach(function (num) {
      var e = byNum[num]; if (!e) return;
      if (e.recipient != null) {
        var c1 = e.detail.count1.v, c2 = e.detail.count2.v, mj = Math.max(c1, c2), mn = Math.min(c1, c2);
        out.push({ branch: e.donor, type: 'total', total: e.detail.total, edge: '#999999', connector: e.num,
          directional: { label: (e.kind === 'bi' ? mj + '/' + mn : '' + mj), color: e.color },
          u: zbFromDetail(e.detail.u), s: zbFromDetail(e.detail.s), excess_color: e.color });
      } else {
        var home = (yOf[e.n1] >= yOf[e.n2]) ? e.n1 : e.n2;
        out.push({ branch: home, type: 'total', total: e.detail.total, edge: e.color, connector: e.num,
          directional: null, u: null, s: zbFromDetail(e.detail.s), excess_color: e.color });
      }
    });
    var seen = {};                       // stack boxes that land on the same branch so they don't overlap
    out.forEach(function (b) { var n = seen[b.branch] || 0; b.stack = n; seen[b.branch] = n + 1; });
    return out;
  }

  function buildEventView(scene, ev, opts) {
    opts = opts || {};
    var hasAnn = opts.showRaw || opts.showZ;
    var fg = {}, annotated = {};
    ev.connectors.forEach(function (num) { fg[num] = true; if (hasAnn) annotated[num] = 1; });
    return {
      fg: fg, clade: {}, hasFocal: false, boxes: hasAnn ? eventBoxes(scene, ev) : null,
      selected: null, countOf: null, tint: null, annotated: annotated, arcLabels: false,
      showRaw: opts.showRaw, showZ: opts.showZ, widthBy: opts.widthBy, bgFade: opts.bgFade,
      title: ev.name, subtitle: ev.connectors.length + ' connector' + (ev.connectors.length === 1 ? '' : 's')
    };
  }

  function coverageHTML(scene, tally) {
    var assigned = 0, unassigned = 0, shared = 0;
    scene.events.forEach(function (e) { var c = tally[e.num].count; if (c === 0) unassigned++; else { assigned++; if (c > 1) shared++; } });
    var h = '<span class="cov-pill cov-ok">' + assigned + ' assigned</span>';
    if (unassigned) h += '<span class="cov-pill cov-unassigned">' + unassigned + ' unassigned</span>';
    if (shared) h += '<span class="cov-pill cov-shared">' + shared + ' shared</span>';
    return h;
  }

  function tallyTableHTML(scene, tally, sel) {
    var h = '<tr><th>ID</th><th>#</th><th>included in</th></tr>';
    scene.events.forEach(function (e) {
      var t = tally[e.num], st = t.count === 0 ? 'st-unassigned' : (t.count > 1 ? 'st-shared' : 'st-ok');
      var chips = t.count === 0 ? '<span class="tally-none">&mdash; unassigned</span>'
        : t.events.map(function (ev) { return '<span class="ev-chip" style="background:' + ev.color + '">' + esc(ev.name) + '</span>'; }).join('');
      h += '<tr class="' + st + (sel === e.num ? ' sel' : '') + '" data-ev="' + e.num + '">' +
        '<td><span class="cdot" style="background:' + e.color + '"></span>' + e.num + '</td>' +
        '<td class="num">' + t.count + '</td><td>' + chips + '</td></tr>';
    });
    return h;
  }

  function eventCardHTML(scene, ev, byNum, opts) {
    var svg = renderScene(scene, buildEventView(scene, ev, opts), opts);
    var list = scene.events.map(function (e) {
      var on = ev.connectors.indexOf(e.num) >= 0;
      return '<div class="chk' + (on ? ' on' : '') + '" data-ev="' + e.num + '" data-event-id="' + esc(ev.id) + '">' +
        '<span class="box">' + (on ? '✓' : '') + '</span>' +
        '<span class="cdot" style="background:' + e.color + '"></span>' +
        '<span class="lbl">' + e.num + ': ' + esc(connText(e)) + ' <span style="color:#999">(' + kindLabel(e.kind) + ')</span></span></div>';
    }).join('');
    return '<section class="event-card" data-event-id="' + esc(ev.id) + '" style="border-left-color:' + ev.color + '">' +
      '<header><input type="color" class="ev-color" data-event-id="' + esc(ev.id) + '" value="' + ev.color + '" title="event colour">' +
      '<input type="text" class="ev-name" data-event-id="' + esc(ev.id) + '" value="' + esc(ev.name) + '">' +
      '<span class="ev-count">' + ev.connectors.length + ' connector' + (ev.connectors.length === 1 ? '' : 's') + '</span>' +
      '<button class="ev-del" data-event-id="' + esc(ev.id) + '" title="delete event">&times;</button></header>' +
      '<div class="card-body"><div class="card-svg">' + svg + '</div><div class="card-list">' + list + '</div></div></section>';
  }

  function cardsHTML(scene, curation, byNum, opts) {
    if (!curation.events.length) {
      return '<div class="cards-empty">No events yet. Click <b>+ Add event</b>, then click connectors ' +
        '(on the tree or in the list) to add them to that event.</div>';
    }
    return curation.events.map(function (ev) { return eventCardHTML(scene, ev, byNum, opts); }).join('');
  }

  // ---- composite figure (overview + table + one facet per event, equal cells) ----
  var SVGNS = '<svg xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"';

  function tableSVG(scene, tally, W, H) {
    var pad = 30, x = pad, top = pad + 14;
    var s = SVGNS + ' viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>' +
      '<text x="' + x + '" y="' + top + '" font-size="22" font-weight="700">Connector tally</text>';
    var assigned = 0, un = 0, sh = 0;
    scene.events.forEach(function (e) { var c = tally[e.num].count; if (c === 0) un++; else { assigned++; if (c > 1) sh++; } });
    s += '<text x="' + x + '" y="' + (top + 26) + '" font-size="14" fill="#666">' + assigned + ' assigned · ' +
      un + ' unassigned · ' + sh + ' shared</text>';
    var cID = x, cCt = x + 110, cIn = x + 200, hY = top + 58;
    s += '<text x="' + cID + '" y="' + hY + '" font-size="13" fill="#888" font-weight="700">ID</text>' +
      '<text x="' + cCt + '" y="' + hY + '" font-size="13" fill="#888" font-weight="700"># EVENTS</text>' +
      '<text x="' + cIn + '" y="' + hY + '" font-size="13" fill="#888" font-weight="700">INCLUDED IN</text>' +
      '<line x1="' + x + '" y1="' + (hY + 8) + '" x2="' + (W - pad) + '" y2="' + (hY + 8) + '" stroke="#e0e0e0"/>';
    var n = scene.events.length, rowH = Math.max(20, Math.min(40, (H - hY - pad - 14) / Math.max(n, 1)));
    var y = hY + 8;
    scene.events.forEach(function (e) {
      y += rowH; var t = tally[e.num], by = y - rowH * 0.32;
      var cc = t.count === 0 ? '#b35900' : (t.count > 1 ? '#444' : '#1b7837');
      s += '<circle cx="' + (cID + 7) + '" cy="' + f1(by - 5) + '" r="6" fill="' + e.color + '"/>' +
        '<text x="' + (cID + 20) + '" y="' + f1(by) + '" font-size="17">' + e.num + '</text>' +
        '<text x="' + (cCt + 22) + '" y="' + f1(by) + '" font-size="17" font-weight="700" fill="' + cc + '" text-anchor="middle">' + t.count + '</text>';
      if (t.count === 0) s += '<text x="' + cIn + '" y="' + f1(by) + '" font-size="14" fill="#999" font-style="italic">unassigned</text>';
      else {
        var cx = cIn;
        t.events.forEach(function (ev) {
          var w = ev.name.length * 7.6 + 14;
          s += '<rect x="' + f1(cx) + '" y="' + f1(by - 14) + '" width="' + f1(w) + '" height="20" rx="10" fill="' + ev.color + '"/>' +
            '<text x="' + f1(cx + w / 2) + '" y="' + f1(by) + '" font-size="12.5" fill="#fff" text-anchor="middle">' + esc(ev.name) + '</text>';
          cx += w + 6;
        });
      }
    });
    return s + '</svg>';
  }

  function chooseCols(n) { return Math.max(1, Math.ceil(Math.sqrt(n))); }
  function asCell(svg, x, y) { return svg.replace('<svg ', '<svg x="' + x + '" y="' + y + '" '); }

  function buildFigureSVG(scene, curation, opts) {
    opts = opts || {};
    var uy = opts.unitY || UNIT_Y, sc = opts.scale || 1;
    var rOpts = { showRaw: opts.showRaw, showZ: opts.showZ, widthBy: opts.widthBy, bgFade: opts.bgFade };
    var Wp = PAD_L + scene.layout.maxd * UNIT_X + PAD_R;
    var Hp = titleLayout(sc, true).topH + (scene.layout.nleaves - 1) * uy + PAD_B;   // matches scaled facet height
    var tally = tallyOf(scene, curation);
    var facets = [renderScene(scene, buildTopView(scene, curation, null, rOpts), { unitY: uy, scale: sc }), tableSVG(scene, tally, Wp, Hp)];
    curation.events.forEach(function (ev) { facets.push(renderScene(scene, buildEventView(scene, ev, rOpts), { unitY: uy, scale: sc })); });
    var N = facets.length, ncols = chooseCols(N), nrows = Math.ceil(N / ncols), GAP = 18, PAD = 20;
    var W = PAD * 2 + ncols * Wp + (ncols - 1) * GAP, H = PAD * 2 + nrows * Hp + (nrows - 1) * GAP;
    var s = SVGNS + ' viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    facets.forEach(function (fsvg, i) {
      var col = i % ncols, row = Math.floor(i / ncols), x = PAD + col * (Wp + GAP), y = PAD + row * (Hp + GAP);
      s += '<rect x="' + x + '" y="' + y + '" width="' + Wp + '" height="' + Hp + '" fill="none" stroke="#e0e0e0"/>' + asCell(fsvg, x, y);
    });
    return { svg: s + '</svg>', w: W, h: H };
  }

  // ---- curation model ops ----
  function letter(n) { return n <= 26 ? String.fromCharCode(64 + n) : 'Event ' + n; }
  function nextIndex(curation) {            // lowest free slot -> empty list restarts at 'A', fills gaps
    var used = {};
    curation.events.forEach(function (e) { var m = /^e(\d+)$/.exec(e.id || ''); if (m) used[+m[1]] = 1; });
    var i = 1; while (used[i]) i++; return i;
  }
  function addEvent(curation) {
    var i = nextIndex(curation);
    curation.events.push({ id: 'e' + i, name: 'Event ' + letter(i), color: EVENT_PALETTE[(i - 1) % EVENT_PALETTE.length], connectors: [] });
  }
  function findEvent(curation, id) { for (var i = 0; i < curation.events.length; i++) if (curation.events[i].id === id) return curation.events[i]; return null; }
  function toggleMember(curation, id, num) {
    var ev = findEvent(curation, id); if (!ev) return;
    var i = ev.connectors.indexOf(num);
    if (i >= 0) ev.connectors.splice(i, 1); else { ev.connectors.push(num); ev.connectors.sort(function (a, b) { return a - b; }); }
  }

  // ---- persistence ----
  function storageKey(scene) { return 'daftAtlasCuration:' + scene.meta.dataset; }
  function loadCuration(scene) {
    try {
      var raw = global.localStorage && localStorage.getItem(storageKey(scene));
      if (raw) {
        var o = JSON.parse(raw);
        if (o && Array.isArray(o.events)) return { events: o.events, seq: o.seq || (o.events.length + 1) };
      }
    } catch (e) { /* ignore */ }
    return { events: [], seq: 1 };
  }
  function saveCuration(scene, curation) {
    try { if (global.localStorage) localStorage.setItem(storageKey(scene), JSON.stringify(curation)); } catch (e) { /* ignore */ }
  }
  function prefsKey(scene) { return 'daftAtlasPrefs:' + scene.meta.dataset; }
  function loadPrefs(scene) {
    var p = { cardVY: 1, cardScale: 1, showRaw: false, showZ: false, widthBy: 'equal', bgFade: 1 };
    try {
      var r = global.localStorage && localStorage.getItem(prefsKey(scene));
      if (r) {
        var o = JSON.parse(r);
        if (o) {
          if (o.cardVY) p.cardVY = +o.cardVY; if (o.cardScale) p.cardScale = +o.cardScale;
          p.showRaw = !!o.showRaw; p.showZ = !!o.showZ; if (o.widthBy) p.widthBy = o.widthBy;
          if (o.bgFade != null) p.bgFade = +o.bgFade;
        }
      }
    } catch (e) { /* ignore */ }
    return p;
  }
  function savePrefs(scene, p) {
    try { if (global.localStorage) localStorage.setItem(prefsKey(scene), JSON.stringify(p)); } catch (e) { /* ignore */ }
  }
  function clearAllCached() {               // nuke every key this app has stored, across datasets
    try {
      if (!global.localStorage) return;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('daftAtlas') === 0) keys.push(k); }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }
  function csvOf(scene, tally) {
    var lines = ['connector_id,n_inclusions,included_in'];
    scene.events.forEach(function (e) {
      var t = tally[e.num], names = t.events.map(function (ev) { return ev.name; }).join('; ');
      lines.push(e.num + ',' + t.count + ',"' + names.replace(/"/g, '""') + '"');
    });
    return lines.join('\n');
  }

  function triggerDownload(href, name) { var a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function downloadText(text, mime, name) { triggerDownload(URL.createObjectURL(new Blob([text], { type: mime })), name); }
  function downloadSVGEl(svg, name) { downloadText(svg.outerHTML, 'image/svg+xml', name); }
  function downloadPNGEl(svg, name) { downloadPNGString(new XMLSerializer().serializeToString(svg), svg.viewBox.baseVal.width, svg.viewBox.baseVal.height, name); }
  function downloadPNGString(xml, w, h, name) {
    var s = 2, img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = w * s; c.height = h * s;
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(s, 0, 0, s, 0, 0); ctx.drawImage(img, 0, 0);
      triggerDownload(c.toDataURL('image/png'), name);
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  }

  // =====================================================================
  //  MOUNT
  // =====================================================================
  function mount() {
    var scene = JSON.parse(document.getElementById('atlas-data').textContent);
    var byNum = eventByNumMap(scene);
    var nodeById = {}; scene.nodes.forEach(function (n) { nodeById[n.id] = n; });
    document.getElementById('dataset-name').textContent = '· ' + scene.meta.dataset;

    var app = {
      tab: 'explore',
      explore: { focal: null, overrides: {}, selected: null },
      curation: loadCuration(scene),
      prefs: loadPrefs(scene),
      selConn: null
    };

    var atlas = document.getElementById('atlas'), detail = document.getElementById('detail');
    var top = document.getElementById('events-top'), cards = document.getElementById('event-cards');
    document.getElementById('legend').innerHTML = legendHTML();

    function drawExplore() { app.explore.widthBy = app.prefs.widthBy; app.explore.bgFade = app.prefs.bgFade; atlas.innerHTML = renderScene(scene, buildExploreView(scene, app.explore, nodeById)); detail.innerHTML = detailHTML(scene, app.explore); }
    function drawTopTally() {
      var tally = tallyOf(scene, app.curation);
      top.innerHTML = renderScene(scene, buildTopView(scene, app.curation, app.selConn, { widthBy: app.prefs.widthBy, bgFade: app.prefs.bgFade }));
      document.getElementById('coverage').innerHTML = coverageHTML(scene, tally);
      document.getElementById('tally').innerHTML = tallyTableHTML(scene, tally, app.selConn);
    }
    function cardOpts() {
      return { unitY: UNIT_Y * app.prefs.cardVY, scale: app.prefs.cardScale,
        showRaw: app.prefs.showRaw, showZ: app.prefs.showZ, widthBy: app.prefs.widthBy, bgFade: app.prefs.bgFade };
    }
    function drawCards() {
      cards.innerHTML = cardsHTML(scene, app.curation, byNum, cardOpts());
      cards.querySelectorAll('.event-card').forEach(function (card) {   // keep the connector list scrollable at the tree's height
        var svg = card.querySelector('.card-svg svg'), list = card.querySelector('.card-list');
        if (svg && list) { var h = svg.getBoundingClientRect().height; if (h > 0) list.style.maxHeight = h + 'px'; }
      });
    }
    function drawEvents() { drawTopTally(); drawCards(); }
    function persist() { saveCuration(scene, app.curation); }

    drawExplore();

    // ---- tab switching ----
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () {
        app.tab = b.dataset.tab;
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
        document.getElementById('tab-explore').classList.toggle('active', app.tab === 'explore');
        document.getElementById('tab-events').classList.toggle('active', app.tab === 'events');
        if (app.tab === 'events') drawEvents();
      });
    });

    // ---- explore handlers ----
    atlas.addEventListener('click', function (ev) {
      var c = ev.target.closest('.conn-hit');
      if (c) { var n = +c.dataset.ev; app.explore.overrides[n] = fgSetFor(scene, app.explore)[n] ? 'bg' : 'fg'; app.explore.selected = n; drawExplore(); return; }
      var b = ev.target.closest('.branch-hit');
      if (b && scene.focals[b.dataset.branch]) { app.explore.focal = b.dataset.branch; app.explore.overrides = {}; app.explore.selected = null; drawExplore(); }
    });
    document.getElementById('btn-all').onclick = function () { app.explore = { focal: null, overrides: {}, selected: null }; drawExplore(); };
    var exW = document.getElementById('ex-width-by');
    exW.value = app.prefs.widthBy;
    exW.addEventListener('change', function () {
      app.prefs.widthBy = exW.value; savePrefs(scene, app.prefs);
      var cw = document.getElementById('width-by'); if (cw) cw.value = exW.value;
      drawExplore();
    });
    var exBg = document.getElementById('ex-bg-fade');
    exBg.value = app.prefs.bgFade;
    exBg.addEventListener('input', function () {
      app.prefs.bgFade = parseFloat(exBg.value); savePrefs(scene, app.prefs);
      var bf = document.getElementById('bg-fade'); if (bf) bf.value = exBg.value;
      drawExplore();
    });
    document.getElementById('btn-reset').onclick = function () { app.explore.overrides = {}; drawExplore(); };
    document.getElementById('btn-svg').onclick = function () { downloadSVGEl(atlas.querySelector('svg'), 'attachment_atlas.svg'); };
    document.getElementById('btn-png').onclick = function () { downloadPNGEl(atlas.querySelector('svg'), 'attachment_atlas.png'); };
    document.getElementById('btn-nuke').onclick = function () {
      if (!confirm('Are you sure? This will delete all your saved progress (every event grouping and saved setting).')) return;
      clearAllCached();
      app.curation = { events: [] };
      app.prefs = { cardVY: 1, cardScale: 1, showRaw: false, showZ: false, widthBy: 'equal', bgFade: 1 };
      app.explore = { focal: null, overrides: {}, selected: null };
      app.selConn = null;
      var ph = document.getElementById('panel-h'); if (ph) ph.value = 1;
      var cs = document.getElementById('card-scale'); if (cs) cs.value = 0;
      var cr = document.getElementById('show-raw'); if (cr) cr.checked = false;
      var cz = document.getElementById('show-z'); if (cz) cz.checked = false;
      var cw = document.getElementById('width-by'); if (cw) cw.value = 'equal';
      var ew = document.getElementById('ex-width-by'); if (ew) ew.value = 'equal';
      var bf = document.getElementById('bg-fade'); if (bf) bf.value = 1;
      var eb = document.getElementById('ex-bg-fade'); if (eb) eb.value = 1;
      drawExplore(); drawEvents();
    };

    // ---- events: top panel + tally select (cross-highlight) ----
    top.addEventListener('click', function (ev) {
      var c = ev.target.closest('.conn-hit');
      if (c) { app.selConn = (app.selConn === +c.dataset.ev) ? null : +c.dataset.ev; drawTopTally(); }
    });
    document.getElementById('tally').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-ev]');
      if (tr) { var n = +tr.dataset.ev; app.selConn = (app.selConn === n) ? null : n; drawTopTally(); }
    });

    // ---- events: card interactions ----
    cards.addEventListener('click', function (ev) {
      var del = ev.target.closest('.ev-del');
      if (del) { app.curation.events = app.curation.events.filter(function (e) { return e.id !== del.dataset.eventId; }); persist(); drawEvents(); return; }
      var chk = ev.target.closest('.chk');
      if (chk) { toggleMember(app.curation, chk.dataset.eventId, +chk.dataset.ev); persist(); drawEvents(); return; }
      var hit = ev.target.closest('.conn-hit');
      if (hit) { var card = ev.target.closest('.event-card'); if (card) { toggleMember(app.curation, card.dataset.eventId, +hit.dataset.ev); persist(); drawEvents(); } return; }
      // click a branch -> add ALL its incoming (touching, for NNI=1) connectors to this event
      var bh = ev.target.closest('.branch-hit');
      if (bh) {
        var card2 = ev.target.closest('.event-card'), f = scene.focals[bh.dataset.branch];
        if (card2 && f) {
          var evt = findEvent(app.curation, card2.dataset.eventId);
          if (evt) {
            f.foreground_event_ids.forEach(function (num) { if (evt.connectors.indexOf(num) < 0) evt.connectors.push(num); });
            evt.connectors.sort(function (a, b) { return a - b; });
            persist(); drawEvents();
          }
        }
      }
    });
    cards.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('ev-name')) {
        var e = findEvent(app.curation, ev.target.dataset.eventId); if (e) { e.name = ev.target.value; persist(); drawTopTally(); }
      }
    });
    cards.addEventListener('change', function (ev) {
      if (ev.target.classList.contains('ev-color')) {
        var e = findEvent(app.curation, ev.target.dataset.eventId); if (e) { e.color = ev.target.value; persist(); drawEvents(); }
      }
    });

    // ---- events: panel-height + element-size sliders ----
    var ph = document.getElementById('panel-h');
    ph.value = app.prefs.cardVY;
    ph.addEventListener('input', function () {
      app.prefs.cardVY = parseFloat(ph.value) || 1; savePrefs(scene, app.prefs); drawCards();
    });
    var cs = document.getElementById('card-scale');
    cs.value = Math.max(-1, Math.min(1, Math.log(app.prefs.cardScale) / Math.log(4)));  // log slider: 4^t
    cs.addEventListener('input', function () {
      app.prefs.cardScale = Math.pow(4, parseFloat(cs.value) || 0); savePrefs(scene, app.prefs); drawCards();
    });

    // ---- events: annotation toggles + connector-width dropdown ----
    var cRaw = document.getElementById('show-raw'), cZ = document.getElementById('show-z'),
        cW = document.getElementById('width-by');
    cRaw.checked = app.prefs.showRaw; cZ.checked = app.prefs.showZ; cW.value = app.prefs.widthBy;
    cRaw.addEventListener('change', function () { app.prefs.showRaw = cRaw.checked; savePrefs(scene, app.prefs); drawCards(); });
    cZ.addEventListener('change', function () { app.prefs.showZ = cZ.checked; savePrefs(scene, app.prefs); drawCards(); });
    cW.addEventListener('change', function () {
      app.prefs.widthBy = cW.value; savePrefs(scene, app.prefs);
      var ew = document.getElementById('ex-width-by'); if (ew) ew.value = cW.value;
      drawCards(); drawTopTally();
    });
    var cBg = document.getElementById('bg-fade');
    cBg.value = app.prefs.bgFade;
    cBg.addEventListener('input', function () {
      app.prefs.bgFade = parseFloat(cBg.value); savePrefs(scene, app.prefs);
      var eb = document.getElementById('ex-bg-fade'); if (eb) eb.value = cBg.value;
      drawCards(); drawTopTally();
    });

    // ---- events: toolbar ----
    document.getElementById('btn-add-event').onclick = function () { addEvent(app.curation); persist(); drawCards(); drawTopTally(); };
    document.getElementById('btn-exp-json').onclick = function () {
      downloadText(JSON.stringify({ dataset: scene.meta.dataset, events: app.curation.events }, null, 1), 'application/json', 'daft_events_' + scene.meta.dataset + '.json');
    };
    document.getElementById('btn-exp-csv').onclick = function () {
      downloadText(csvOf(scene, tallyOf(scene, app.curation)), 'text/csv', 'daft_event_tally_' + scene.meta.dataset + '.csv');
    };
    function figOpts() {
      return { unitY: UNIT_Y * app.prefs.cardVY, scale: app.prefs.cardScale,
        showRaw: app.prefs.showRaw, showZ: app.prefs.showZ, widthBy: app.prefs.widthBy, bgFade: app.prefs.bgFade };
    }
    document.getElementById('btn-exp-svg').onclick = function () {
      downloadText(buildFigureSVG(scene, app.curation, figOpts()).svg, 'image/svg+xml', 'daft_events_figure.svg');
    };
    document.getElementById('btn-exp-png').onclick = function () {
      var f = buildFigureSVG(scene, app.curation, figOpts()); downloadPNGString(f.svg, f.w, f.h, 'daft_events_figure.png');
    };
    document.getElementById('btn-imp-json').onclick = function () { document.getElementById('file-json').click(); };
    document.getElementById('file-json').addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var o = JSON.parse(rd.result), valid = new Set(scene.events.map(function (e) { return e.num; }));
          var seq = 1, evts = (o.events || []).map(function (e) {
            return { id: 'e' + (seq++), name: e.name || ('Event ' + letter(seq)), color: e.color || EVENT_PALETTE[(seq - 2) % EVENT_PALETTE.length],
              connectors: (e.connectors || []).filter(function (n) { return valid.has(n); }) };
          });
          app.curation = { events: evts, seq: seq }; persist(); drawEvents();
        } catch (err) { alert('Could not read grouping file: ' + err.message); }
      };
      rd.readAsText(f); ev.target.value = '';
    });
  }

  // ---- exports ----
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderScene: renderScene, buildExploreView: buildExploreView, buildTopView: buildTopView,
      buildEventView: buildEventView, tallyOf: tallyOf, detailHTML: detailHTML, eventByNumMap: eventByNumMap,
      buildFigureSVG: buildFigureSVG, tableSVG: tableSVG, addEvent: addEvent
    };
  }
  global.DAFTAtlas = { renderScene: renderScene, mount: mount };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
