#!/usr/bin/env python
"""
Build the data file for the INTERACTIVE DAFT attachment atlas (web version).

This is a fully independent re-derivation of the DAFT outputs -- it does NOT import
from daft_attachment_atlas.py. It reads the same three DAFT CSVs and emits a single
JSON "scene graph" that a static HTML+SVG viewer renders. Python is the brain; the
browser only renders precomputed values, so the figure stays faithful to DAFT.

Outputs:
  atlas_data.json           the scene graph (geometry + events + per-focal annotations)
  attachment_atlas.html     (optional, --inline) a self-contained viewer with the data,
                            JS and CSS baked in, so it can be emailed / opened offline.

Run (defaults to the bundled ./example data):
  python build_atlas.py --dataset cichlid
"""
import os
import csv
import json
import argparse
import numpy as np
from ete3 import Tree

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- colours (duplicated from the matplotlib script, kept identical) ----------
UNI = "#d95f02"   # unidirectional inferred
BI = "#6a3d9a"    # bidirectional inferred
G = "#1b7837"     # focal highlight / NNI=0 species position
UNK = "#1f78b4"   # NNI=1, direction not estimable
GREY = "0.6"
ZSIG = -1.96      # corrected-Z significance threshold


# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(
        description="Build atlas_data.json for the interactive DAFT attachment atlas.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("--daft-dir", default=os.path.join(HERE, "example"),
                   help="folder holding rev_n.csv, results1.csv and Summary.csv")
    p.add_argument("--rev-n", default=None, help="override path to rev_n.csv")
    p.add_argument("--results1", default=None, help="override path to results1.csv")
    p.add_argument("--summary", default=None, help="override path to Summary.csv")
    p.add_argument("--species-tree", default=None,
                   help="optional newick; default derives the tree from results1.csv")
    p.add_argument("--out", default=os.path.join(HERE, "atlas_data.json"),
                   help="path for the JSON scene graph")
    p.add_argument("--dataset", default="DAFT", help="label shown in the viewer header")
    p.add_argument("--inline", dest="inline", action="store_true", default=True,
                   help="also write a self-contained attachment_atlas.html")
    p.add_argument("--no-inline", dest="inline", action="store_false")
    p.add_argument("--html-out", default=None,
                   help="path for the self-contained HTML (default: alongside --out)")
    return p.parse_args()


def hexcol(c):
    """matplotlib colour -> CSS hex. Passes #rgb through; converts grey floats ('0.6')."""
    if c is None or c == "":
        return None
    if isinstance(c, str) and c.startswith("#"):
        return c
    try:
        v = float(c)
        n = max(0, min(255, round(v * 255)))
        return f"#{n:02x}{n:02x}{n:02x}"
    except (TypeError, ValueError):
        return c


def load_csv(path):
    """Return [(file_line, row_dict), ...]; file_line is 1-based incl. the header."""
    with open(path) as f:
        rows = list(csv.DictReader(f))
    return [(i + 2, r) for i, r in enumerate(rows)]


def main():
    args = parse_args()
    REV_N = args.rev_n or os.path.join(args.daft_dir, "rev_n.csv")
    RESULTS1 = args.results1 or os.path.join(args.daft_dir, "results1.csv")
    SUMMARY = args.summary or os.path.join(args.daft_dir, "Summary.csv")
    for f in (REV_N, RESULTS1, SUMMARY):
        if not os.path.exists(f):
            raise SystemExit(f"DAFT output not found: {f}")

    rev_rows = load_csv(REV_N)
    res_rows = load_csv(RESULTS1)
    sum_rows = load_csv(SUMMARY)

    # -- tree -----------------------------------------------------------------
    if args.species_tree:
        t = Tree(open(args.species_tree).read().strip(), format=1)
        sp_src = {"file": os.path.basename(args.species_tree), "line": 1, "col": "newick"}
    else:
        ln, r0 = res_rows[0]
        nwk = r0["Labeled_species"].replace(" donor", "").replace(" receiver", "")
        t = Tree(nwk, format=1)
        sp_src = {"file": "results1.csv", "line": ln,
                  "col": "Labeled_species (stripped ' donor'/' receiver')"}

    leaves = t.get_leaves()
    KNOWN = set(l.name for l in leaves)
    setnode = {frozenset(n.get_leaf_names()): n for n in t.traverse()}

    def taxa_of(s):
        return frozenset(x for x in KNOWN if x in s)

    def node_of(s):
        return setnode.get(taxa_of(s))

    # -- geometry (shipped as coords; renderer just scales to pixels) ----------
    ypos = {lf.name: i for i, lf in enumerate(leaves)}

    def depth(n):
        d = 0
        while n.up:
            d += 1
            n = n.up
        return d

    maxd = max(depth(lf) for lf in leaves)
    X, Y = {}, {}
    for n in t.traverse("postorder"):
        if n.is_leaf():
            X[n], Y[n] = maxd, float(ypos[n.name])
        else:
            X[n], Y[n] = float(depth(n)), float(np.mean([Y[c] for c in n.children]))

    def abbr(nm):
        return nm[:4]

    def name_of(node):
        ls = node.get_leaf_names()
        return ls[0] if len(ls) == 1 else "+".join(abbr(x) for x in ls)

    # ids must be unique; name_of is the display label & doubles as the id here.
    nid = {}
    for n in t.traverse():
        k = name_of(n)
        if k in nid.values():
            raise SystemExit(f"name_of collision on '{k}' -- need a different id scheme")
        nid[n] = k

    def anchor(nd):
        return [(X[nd.up] + X[nd]) / 2.0, Y[nd]]

    # -- index source rows by taxa-set keys -----------------------------------
    rev_by_focal = {}     # focal_taxa -> {partner_node: (line, nni, total)}
    rev_pair = {}         # frozenset(pair) -> (line, nni, total)
    for line, r in rev_rows:
        wn = taxa_of(r["Where_at"])
        tn = node_of(r["What_moved"])
        if tn is None:
            continue
        rev_by_focal.setdefault(wn, {})[tn] = (line, int(r["NNI_sp"]), int(r["total_count"]))
        rev_pair[frozenset((wn, taxa_of(r["What_moved"])))] = (
            line, int(r["NNI_sp"]), int(r["total_count"]))

    res_pair = {}         # frozenset(pair) -> (line, row)
    for line, r in res_rows:
        res_pair[frozenset((taxa_of(r["Lineage1"]), taxa_of(r["Lineage2"])))] = (line, r)

    sum_pair = {}         # frozenset(pair) -> [(line, row), ...]
    for line, r in sum_rows:
        sum_pair.setdefault(
            frozenset((taxa_of(r["Focal_lineage"]), taxa_of(r["Test_lineage"]))), []
        ).append((line, r))

    def best_row_for(pair, zcol):
        """Pair's Summary row most significant (most negative) for a Z column, or None."""
        out = None
        for sl, sr in sum_pair.get(pair, []):
            try:
                z = float(sr.get(zcol, ""))
            except (TypeError, ValueError):
                continue
            if out is None or z < out[0]:
                out = (z, sl, sr)
        return out

    def excess(pair):
        """Per-baseline RAW excess (Test_count - baseline_count), read from the row where
        THAT baseline's corrected Z is most significant. Returns {'u':..., 's':...}."""
        out = {}
        for key, zcol, count_col, which in [
                ("u", "Z-value-uncle_corrected_scaled_down", "uncle_count", "uncle"),
                ("s", "Z-value-sibling_corrected_scaled_down", "sibling_count", "sibling")]:
            best = best_row_for(pair, zcol)
            if best is None:
                out[key] = {"value": None, "z": None, "sig": False, "comp": None,
                            "z_raw": None, "z_raw_sig": False, "src": None, "col": None,
                            "note": f"no {which} test for this pair"}
                continue
            z, sl, sr = best
            val = int(round(float(sr["Test_count"]) - float(sr[count_col])))
            comp = (sr.get(f"comparison_{which}") or "").strip().rstrip(";")
            zr = _f(sr.get(f"Z-value-{which}"))
            out[key] = {
                "value": val, "z": round(z, 1), "sig": z <= ZSIG, "comp": comp or None,
                "z_raw": (round(zr, 1) if zr is not None else None),
                "z_raw_sig": (zr is not None and zr <= ZSIG),
                "src": f"Summary.csv:{sl}", "col": f"Test_count - {count_col}",
                "note": (f"{int(round(float(sr['Test_count'])))} - {which}({comp}) "
                         f"{int(round(float(sr[count_col])))}; corrected Z={z:.2f}"
                         f"{' (sig)' if z <= ZSIG else ' (n.s.)'}")}
        return out

    def both_sig(d):
        return d.get("z") is not None and d.get("sig") and d.get("z_raw_sig")

    # a pair is kept ONLY if BOTH raw AND corrected Z are significant for at least one of the
    # avuncular / sibling tests (tutorial Step 7 retention rule). Otherwise it is not drawn.
    def included(ex):
        return both_sig(ex["u"]) or both_sig(ex["s"])

    # -- events (global, full pair-level detail computed once) ----------------
    events = []
    included_pairs = set()
    for ln, r in res_rows:
        n1, n2 = node_of(r["Lineage1"]), node_of(r["Lineage2"])
        if n1 is None or n2 is None:
            continue
        pair = frozenset((taxa_of(r["Lineage1"]), taxa_of(r["Lineage2"])))
        nni = rev_pair.get(pair, (None, None, None))[1]
        total = rev_pair.get(pair, (None, None, None))[2]
        ex = excess(pair)
        if not included(ex):
            continue                     # drop pairs not significant on raw AND corrected
        included_pairs.add(pair)
        det_z = []
        for sl, sr in sum_pair.get(pair, []):
            det_z.append({
                "src": f"Summary.csv:{sl}",
                "focal": (sr.get("Focal_lineage") or "").strip().rstrip(";"),
                "test": (sr.get("Test_lineage") or "").strip().rstrip(";"),
                "flag": sr.get("flag", ""),
                "comparison_sibling": (sr.get("comparison_sibling") or "").strip().rstrip(";"),
                "comparison_uncle": (sr.get("comparison_uncle") or "").strip().rstrip(";"),
                "z_sib_raw": sr.get("Z-value-sibling"),
                "z_sib_corr": sr.get("Z-value-sibling_corrected_scaled_down"),
                "z_unc_raw": sr.get("Z-value-uncle"),
                "z_unc_corr": sr.get("Z-value-uncle_corrected_scaled_down"),
                "test_count_population": sr.get("test_count_population")})

        ev = {"n1": nid[n1], "n2": nid[n2], "nni": nni, "recipient": None, "donor": None,
              "s_label": None, "detail": {
                  "total": total, "nni": nni,
                  "count1": {"v": int(r["Count1"]), "lineage": (r["Lineage1"] or "").strip().rstrip(";")},
                  "count2": {"v": int(r["Count2"]), "lineage": (r["Lineage2"] or "").strip().rstrip(";")},
                  "z_bidirectional": _f(r.get("Z_score_sibling")),
                  "u": ex["u"], "s": ex["s"], "detection_z": det_z}}

        ev["_pairkey"] = pair
        if nni == 1:
            ev["kind"], ev["color"] = "nni1", UNK
            ev["s_label"] = zbox(ex["s"])     # raw+corrected sibling Z for the arc label
            a, b = anchor(n1), anchor(n2)
        else:
            ev["kind"] = "bi" if r.get("CouldbeBidirectional") == "True" else "uni"
            ev["color"] = BI if ev["kind"] == "bi" else UNI
            rec = node_of(r["What_moved"])
            don = node_of(r["Minor_Moved"])
            ev["recipient"] = nid.get(rec)
            ev["donor"] = nid.get(don)
            a, b = anchor(don), anchor(rec)
        ev["a"], ev["b"] = a, b
        ev["rad"] = 0.28 if a[1] < b[1] else -0.28
        ev["_n1node"], ev["_n2node"], ev["_recnode"] = n1, n2, (None if nni == 1 else rec)
        events.append(ev)

    events.sort(key=lambda e: (min(Y[e["_n1node"]], Y[e["_n2node"]]),
                               max(Y[e["_n1node"]], Y[e["_n2node"]])))
    for i, e in enumerate(events, 1):
        e["num"] = i
    evnum_by_pair = {e["_pairkey"]: e["num"] for e in events}

    def highlighted(e, F):
        if e["recipient"] is None:
            return F in (e["_n1node"], e["_n2node"])
        return e["_recnode"] is F

    # -- nodes (geometry for the renderer) ------------------------------------
    where_at = set(rev_by_focal.keys())
    nodes = []
    for n in t.traverse("preorder"):
        leaves_here = n.get_leaf_names()
        selectable = frozenset(leaves_here) in where_at
        node = {
            "id": nid[n], "label": name_of(n),
            "kind": "leaf" if n.is_leaf() else "internal",
            "x": X[n], "y": Y[n],
            "px": (X[n.up] if n.up else None),
            "children": [nid[c] for c in n.children],
            "leaves": leaves_here, "selectable": selectable}
        if not n.is_leaf():
            cys = [Y[c] for c in n.children]
            node["vbar"] = [min(cys), max(cys)]   # vertical connector spans children
        nodes.append(node)

    # -- per-focal annotation sets (boxes) for EVERY Where_at branch ----------
    def boxes_for(F):
        f_taxa = frozenset(F.get_leaf_names())
        f_leaves = set(F.get_leaf_names())
        clade_nodes = set(F.traverse())
        measured = rev_by_focal.get(f_taxa, {})
        out = []
        for B in t.traverse():
            if B.up is None or B in clade_nodes:
                continue
            bid = nid[B]
            pair = frozenset((f_taxa, frozenset(B.get_leaf_names())))
            if B in measured:
                line, nni, total = measured[B]
                r1 = res_pair.get(pair)
                is_edge = (r1 is not None) and (pair in included_pairs)
                bidir = bool(is_edge and r1[1].get("CouldbeBidirectional") == "True")
                box_edge = G if nni == 0 else (UNK if (is_edge and nni == 1) else GREY)
                box = {"branch": bid, "type": "total", "total": total,
                       "edge": hexcol(box_edge), "nni": nni}
                if is_edge and nni > 1:
                    r1r = r1[1]
                    receiver = taxa_of(r1r["What_moved"])
                    major = max(int(r1r["Count1"]), int(r1r["Count2"]))
                    minor = min(int(r1r["Count1"]), int(r1r["Count2"]))
                    col = BI if bidir else UNI
                    if receiver == f_taxa:               # directed INTO focal
                        box["connector"] = evnum_by_pair.get(pair)
                        box["directional"] = {
                            "label": f"{major}/{minor}" if bidir else str(major),
                            "color": hexcol(col)}
                        ex = excess(pair)
                        box["u"] = zbox(ex["u"])
                        box["s"] = zbox(ex["s"])
                        box["excess_color"] = hexcol(col)
                out.append(box)
            elif f_leaves.issubset(set(B.get_leaf_names())):
                out.append({"branch": bid, "type": "na"})
            else:
                out.append({"branch": bid, "type": "zero"})
        return out

    focals = {}
    for n in t.traverse():
        if frozenset(n.get_leaf_names()) not in where_at:
            continue
        focals[nid[n]] = {
            "clade": [nid[c] for c in n.traverse()],
            "foreground_event_ids": [e["num"] for e in events if highlighted(e, n)],
            "boxes": boxes_for(n)}

    # -- assemble + strip private node refs -----------------------------------
    for e in events:
        for k in ("_n1node", "_n2node", "_recnode", "_pairkey"):
            e.pop(k, None)

    counts = {"uni": sum(e["kind"] == "uni" for e in events),
              "bi": sum(e["kind"] == "bi" for e in events),
              "nni1": sum(e["kind"] == "nni1" for e in events)}

    scene = {
        "meta": {"dataset": args.dataset, "ntaxa": len(leaves), "zsig": ZSIG,
                 "species_tree_source": sp_src,
                 "colors": {"uni": UNI, "bi": BI, "focal": G, "nni1": UNK}},
        "layout": {"maxd": maxd, "leaf_order": [lf.name for lf in leaves],
                   "nleaves": len(leaves)},
        "nodes": nodes,
        "events": events,
        "focals": focals,
        "all_events": {"counts": counts}}

    with open(args.out, "w") as f:
        json.dump(scene, f, indent=1)
    print(f"wrote {args.out}")
    print(f"  {len(leaves)} taxa, {len(nodes)} nodes, {len(events)} events, "
          f"{len(focals)} selectable focals")
    print(f"  events: {counts['uni']} uni, {counts['bi']} bi, {counts['nni1']} nni1")

    if args.inline:
        html_out = args.html_out or os.path.join(os.path.dirname(args.out),
                                                  "attachment_atlas.html")
        inline_html(scene, html_out)
        print(f"wrote {html_out}  (self-contained)")


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def zbox(ex):
    """Pack a baseline's raw + corrected Z (+ per-value significance) for the two-line box/arc
    label, or None if that test was never run."""
    if ex.get("z") is None and ex.get("z_raw") is None:
        return None
    return {"raw": ex.get("z_raw"), "rawSig": bool(ex.get("z_raw_sig")),
            "corr": ex.get("z"), "corrSig": bool(ex.get("sig"))}


def inline_html(scene, out_path):
    """Bake the data, JS and CSS into one self-contained HTML file."""
    assets = os.path.join(HERE, "assets")
    with open(os.path.join(assets, "atlas.html")) as f:
        html = f.read()
    with open(os.path.join(assets, "atlas.css")) as f:
        css = f.read()
    with open(os.path.join(assets, "atlas.js")) as f:
        js = f.read()
    data = json.dumps(scene)
    html = html.replace('<link rel="stylesheet" href="atlas.css">',
                        f"<style>\n{css}\n</style>")
    html = html.replace('<script id="atlas-data" src="atlas_data.json" type="application/json"></script>',
                        f'<script id="atlas-data" type="application/json">{data}</script>')
    html = html.replace('<script src="atlas.js"></script>', f"<script>\n{js}\n</script>")
    with open(out_path, "w") as f:
        f.write(html)


if __name__ == "__main__":
    main()
