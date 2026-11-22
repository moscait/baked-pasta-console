"""Build the Baked Pasta Console README diagrams as light and dark SVGs (+ high-DPI PNGs).

Uses the Baked Pasta brand palette (Deep Basil Green, Marinara Tomato, Ziti Gold,
and Warm Cream).

Usage, from the repo root:
    python3 scripts/diagrams/build_diagrams.py
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent.parent / "assets" / "diagrams"

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

# Brand palette matching baked-pasta/scripts/diagrams/build_diagrams.py
THEMES = {
    "light": dict(
        bg="#FFFDF9",
        zone="#F6ECDC",
        zone_line="#E3D3B8",
        inner="#FBF5EA",
        inner_line="#D9C7A6",
        card="#FFFFFF",
        card_line="#CDBFA6",
        ink="#14302B",
        muted="#5E6E69",
        http="#3E5A54",
        overlay="#D9481C",
        router="#2A7B62",
        pending="#C88A14",
        pending_bg="#FEF7E0",
        badge="#FBE3A6",
        badge_ink="#14302B",
        accent_card="#FFF4E8",
        accent_line="#E9A27F",
        ok="#1E7A46",
        ok_bg="#E6F4EC",
        bad="#C9352B",
        bad_bg="#FCEAE8",
    ),
    "dark": dict(
        bg="#0F1A18",
        zone="#15241F",
        zone_line="#2A3F39",
        inner="#1A2C27",
        inner_line="#35504A",
        card="#1E322C",
        card_line="#3D5A53",
        ink="#F6ECDC",
        muted="#A8B8B2",
        http="#9FC2B8",
        overlay="#FF7A4D",
        router="#4AC29B",
        pending="#F2B544",
        pending_bg="#2E2718",
        badge="#3B3220",
        badge_ink="#FBE3A6",
        accent_card="#2A211B",
        accent_line="#9A4A2C",
        ok="#4ADE80",
        ok_bg="#143325",
        bad="#F87171",
        bad_bg="#3A1D1D",
    ),
}


class Svg:
    def __init__(self, w, h, t, title, desc):
        self.w, self.h, self.t = w, h, t
        self.parts = []
        self.head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-labelledby="t d" font-family="{SANS}">\n'
            f'<title id="t">{escape(title)}</title>\n<desc id="d">{escape(desc)}</desc>\n'
            "<defs>\n"
            + "".join(
                f'<marker id="arr-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
                f'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="{t[k]}"/></marker>\n'
                for k in ("http", "overlay", "router")
            )
            + "</defs>\n"
            f'<rect width="{w}" height="{h}" rx="14" fill="{t["bg"]}"/>\n'
        )

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=13, color="ink", weight=400, anchor="start", mono=False, spacing=None):
        fam = f' font-family="{MONO}"' if mono else ""
        ls = f' letter-spacing="{spacing}"' if spacing else ""
        col = self.t.get(color, color)
        self.add(
            f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{col}" '
            f'text-anchor="{anchor}"{fam}{ls}>{escape(s)}</text>'
        )

    def zone(self, x, y, w, h, label, fill="zone", line="zone_line", dashed=False, label_x=20):
        dash = ' stroke-dasharray="6 5"' if dashed else ""
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{self.t[fill]}" '
            f'stroke="{self.t[line]}" stroke-width="1.5"{dash}/>'
        )
        self.text(x + label_x, y + 26, label, size=11.5, color="muted", weight=700, spacing="0.08em")

    def card(self, x, y, w, h, title, lines=(), badges=(), accent=False, mono_title=True):
        fill, line = ("accent_card", "accent_line") if accent else ("card", "card_line")
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{self.t[fill]}" '
            f'stroke="{self.t[line]}" stroke-width="1.5"/>'
        )
        self.text(x + 16, y + 26, title, size=15, weight=650, mono=mono_title)
        for i, ln in enumerate(lines):
            self.text(x + 16, y + 47 + i * 18, ln, size=12.5, color="muted")
        bx = x + 16
        by = y + h - 30
        for b in badges:
            bw = round(len(b) * 7.0 + 16)
            self.add(f'<rect x="{bx}" y="{by}" width="{bw}" height="20" rx="10" fill="{self.t["badge"]}"/>')
            self.text(bx + bw / 2, by + 14, b, size=11.5, color="badge_ink", weight=600, anchor="middle", mono=True)
            bx += bw + 6

    def arrow(self, pts, kind="http", label=None, at=None, both=False, dashed=False):
        d = "M" + " L".join(f"{x} {y}" for x, y in pts)
        start = f' marker-start="url(#arr-{kind})"' if both else ""
        dash = ' stroke-dasharray="5 4"' if dashed else ""
        self.add(
            f'<path d="{d}" fill="none" stroke="{self.t[kind]}" stroke-width="2" stroke-linejoin="round"'
            f'{dash} marker-end="url(#arr-{kind})"{start}/>'
        )
        if label:
            lx, ly = at
            lw = round(len(label) * 6.8 + 16)
            self.add(
                f'<rect x="{lx - lw / 2}" y="{ly - 11}" width="{lw}" height="20" rx="10" fill="{self.t["bg"]}" '
                f'stroke="{self.t[kind]}" stroke-width="1"/>'
            )
            self.text(lx, ly + 3.5, label, size=11.5, color=kind, weight=600, anchor="middle")

    def bezier(self, x1, y1, x2, y2, kind="http", dashed=False):
        mx = (x1 + x2) / 2
        dash = ' stroke-dasharray="5 4"' if dashed else ""
        self.add(
            f'<path d="M {x1} {y1} C {mx} {y1}, {mx} {y2}, {x2} {y2}" fill="none" '
            f'stroke="{self.t[kind]}" stroke-width="2.2"{dash}/>'
        )

    def save(self, path):
        path.write_text(self.head + "\n".join(self.parts) + "\n</svg>\n", encoding="utf-8")


def access_canvas(t):
    s = Svg(
        1040,
        590,
        t,
        "Access Canvas · Free-form drag-and-drop board, policy hubs, and live reachability advisor",
        "Client identity groups (#employees, #sales, #ssh-users) connect through Dial policy hubs to zero-trust "
        "service groups (#crm-https, #devbox-ssh), which connect through Bind policy hubs to hosting identities "
        "(#crm-https-hosts, #devbox-hosts) and Edge Router policies underneath. A floating right drawer diagnoses "
        "why an identity can or cannot reach a service and previews staged REST API calls.",
    )
    s.text(32, 40, "Access Canvas · Drag-and-drop groups, policy lines, and path advisor", size=19, weight=700)
    s.text(
        32,
        61,
        "Drag cards between #attribute groups, or drag an identity onto a service. Nothing is sent until you apply.",
        size=12.5,
        color="muted",
    )

    # Legend in top-right
    for i, (k, lbl, dash) in enumerate(
        (
            ("http", "Dial (use)", False),
            ("overlay", "Bind (host)", False),
            ("router", "Routers", False),
            ("pending", "Pending", True),
        )
    ):
        ox = 668 + i * 88
        d_attr = ' stroke-dasharray="5 3"' if dash else ""
        s.add(f'<line x1="{ox}" y1="40" x2="{ox + 18}" y2="40" stroke="{t[k]}" stroke-width="2.5"{d_attr}/>')
        s.text(ox + 23, 44, lbl, size=11, color="muted", weight=600)

    # Main Canvas Zone
    s.zone(24, 80, 992, 486, "ACCESS CANVAS BOARD · FREE-FORM OR REACT FLOW GRAPH")

    # Column subheaders
    for cx, lbl in (
        (44, "CLIENT IDENTITIES"),
        (216, "DIAL POLICIES"),
        (356, "SERVICES"),
        (518, "BIND POLICIES"),
        (644, "HOSTING IDENTITIES"),
    ):
        s.text(cx, 132, lbl, size=10, color="muted", weight=700, spacing="0.07em")

    # Bezier policy lines
    s.bezier(188, 174, 210, 194, "http")
    s.bezier(188, 286, 210, 194, "pending", dashed=True)
    s.bezier(326, 194, 348, 194, "http")

    s.bezier(188, 396, 210, 326, "http")
    s.bezier(326, 326, 348, 326, "http")

    s.bezier(490, 194, 512, 194, "overlay")
    s.bezier(618, 194, 638, 194, "overlay")

    s.bezier(490, 326, 512, 326, "overlay")
    s.bezier(618, 326, 638, 326, "overlay")

    # Router connections at bottom
    s.bezier(188, 420, 230, 508, "router")
    s.bezier(490, 346, 405, 508, "router")
    s.bezier(354, 508, 405, 508, "router")
    s.bezier(535, 508, 566, 508, "router")

    def group_box(x, y, w, kind_ch, kind_col, attr, count, rows, pending_box=False):
        dash = f' stroke="{t["pending"]}" stroke-dasharray="5 3"' if pending_box else f' stroke="{t["card_line"]}"'
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{32 + len(rows) * 26 + 6}" rx="10" fill="{t["card"]}"{dash} stroke-width="1.5"/>')
        s.add(f'<line x1="{x + 4}" y1="{y + 1.5}" x2="{x + w - 4}" y2="{y + 1.5}" stroke="{t[kind_col]}" stroke-width="3"/>')
        s.add(f'<rect x="{x + 10}" y="{y + 8}" width="16" height="16" rx="4" fill="{t["badge"]}"/>')
        s.text(x + 18, y + 20, kind_ch, size=10.5, color="badge_ink", weight=700, anchor="middle", mono=True)
        s.text(x + 32, y + 20, f"#{attr}", size=12, weight=700, mono=True)
        s.text(x + w - 12, y + 20, str(count), size=11, color="muted", anchor="end", mono=True)
        s.add(f'<line x1="{x}" y1="{y + 32}" x2="{x + w}" y2="{y + 32}" stroke="{t["card_line"]}" stroke-width="1"/>')
        for idx, (rname, status) in enumerate(rows):
            ry = y + 32 + idx * 26
            if status == "pending":
                s.add(f'<rect x="{x + 3}" y="{ry + 2}" width="{w - 6}" height="22" rx="4" fill="{t["pending_bg"]}"/>')
            s.text(x + 12, ry + 17, f"⠿ {rname}", size=11.5, color="ink")
            dot_col = t["ok"] if status == "ok" else t["pending"] if status == "pending" else t["bad"]
            s.add(f'<circle cx="{x + w - 14}" cy="{ry + 13}" r="3.5" fill="{dot_col}"/>')

    def hub_pill(x, y, w, fam_lbl, name, kind_col):
        fill = t["accent_card"] if kind_col == "overlay" else t["inner"]
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="26" rx="13" fill="{fill}" stroke="{t[kind_col]}" stroke-width="1.5"/>')
        s.text(x + 10, y + 17, fam_lbl, size=9.5, color=kind_col, weight=700)
        s.text(x + 12 + len(fam_lbl) * 6.5, y + 17, name, size=10.5, weight=600, mono=True)

    # Col 0: Identity Groups
    group_box(40, 148, 148, "I", "http", "employees", 2, [("alice-macbook", "ok"), ("bob-thinkpad", "ok")])
    group_box(40, 256, 148, "I", "http", "sales", 2, [("alice-macbook", "ok"), ("dave-tablet", "pending")], pending_box=True)
    group_box(40, 364, 148, "I", "http", "ssh-users", 2, [("bob-thinkpad", "ok"), ("carla-linux", "ok")])

    # Col 1: Dial Policy Hubs
    hub_pill(210, 181, 116, "DIAL", "crm-dial", "http")
    hub_pill(210, 313, 116, "DIAL", "devbox-dial", "http")

    # Col 2: Service Groups
    group_box(348, 158, 142, "S", "overlay", "crm-https", 1, [("crm-https", "ok")])
    group_box(348, 290, 142, "S", "overlay", "devbox-ssh", 1, [("devbox-ssh", "ok")])

    # Col 3: Bind Policy Hubs
    hub_pill(505, 181, 120, "BIND", "crm-bind", "overlay")
    hub_pill(505, 313, 120, "BIND", "devbox-bind", "overlay")

    # Col 4: Hosting Identities
    group_box(638, 158, 148, "I", "http", "crm-hosts", 1, [("crm-prod-01", "ok")])
    group_box(638, 290, 148, "I", "http", "devbox-hosts", 1, [("devbox", "ok")])

    # Bottom Router Band
    hub_pill(230, 495, 124, "ERP", "all-public", "router")
    hub_pill(405, 495, 130, "SERP", "all-services", "router")
    group_box(566, 476, 198, "R", "router", "public", 2, [("us-east-edge-01 · eu-west", "ok")])

    # Floating Right Advisor & Staged Diff Drawer
    dx, dy, dw, dh = 800, 112, 200, 436
    s.add(f'<rect x="{dx}" y="{dy}" width="{dw}" height="{dh}" rx="12" fill="{t["card"]}" stroke="{t["card_line"]}" stroke-width="1.5"/>')
    s.text(dx + 14, dy + 24, "Why can't they connect?", size=12.5, weight=700)
    s.add(f'<line x1="{dx}" y1="{dy + 34}" x2="{dx + dw}" y2="{dy + 34}" stroke="{t["card_line"]}" stroke-width="1"/>')

    s.add(f'<rect x="{dx + 12}" y="{dy + 44}" width="{dw - 24}" height="26" rx="6" fill="{t["inner"]}" stroke="{t["inner_line"]}"/>')
    s.text(dx + 20, dy + 61, "bob-thinkpad → devbox-ssh", size=10.5, weight=600, mono=True)

    s.add(f'<rect x="{dx + 12}" y="{dy + 78}" width="{dw - 24}" height="28" rx="6" fill="{t["ok_bg"]}"/>')
    s.text(dx + 20, dy + 96, "✓ Path & routers verified", size=11, color="ok", weight=700)

    steps = [
        ("ok", "Dial allowed", "by devbox-ssh-dial"),
        ("pending", "Posture: MFA check", "TOTP required on connect"),
        ("ok", "Service is hosted", "by devbox (enrolled)"),
        ("ok", "Shared router online", "us-east-edge-01 (:8444)"),
        ("ok", "Host reaches router", "all-public ERP"),
    ]
    for idx, (st, title, sub) in enumerate(steps):
        sy = dy + 122 + idx * 42
        col = t["ok"] if st == "ok" else t["pending"]
        bg = t["ok_bg"] if st == "ok" else t["pending_bg"]
        mark_ch = "✓" if st == "ok" else "!"
        s.add(f'<circle cx="{dx + 22}" cy="{sy + 8}" r="8" fill="{bg}"/>')
        s.text(dx + 22, sy + 12, mark_ch, size=10.5, color=col, weight=700, anchor="middle")
        s.text(dx + 36, sy + 11, title, size=11, weight=650)
        s.text(dx + 36, sy + 25, sub, size=10, color="muted")

    # Staged API Diff Box at bottom of drawer
    s.add(
        f'<rect x="{dx + 12}" y="{dy + 340}" width="{dw - 24}" height="82" rx="8" '
        f'fill="{t["pending_bg"]}" stroke="{t["pending"]}" stroke-dasharray="4 3"/>'
    )
    s.text(dx + 20, dy + 358, "STAGED API CALL PREVIEW", size=9.5, color="pending", weight=700)
    s.text(dx + 20, dy + 376, "PATCH /edge/management/v1/", size=9.5, mono=True)
    s.text(dx + 20, dy + 391, "  identities/id-dave", size=9.5, mono=True)
    s.text(dx + 20, dy + 408, '{"roleAttributes":["sales"]}', size=9.5, color="muted", mono=True)

    return s


def service_wizard(t):
    s = Svg(
        1040,
        360,
        t,
        "4-step guided service setup wizard",
        "Four steps create everything an OpenZiti service needs: 1. Service Template (16 templates such as SSH, "
        "Ollama, HTTPS, PostgreSQL, Kubernetes API), 2. Hosting Server (new or existing identity + host.v1 forward target), "
        "3. Users & Groups (role attribute + user device or existing identities), and 4. Review & Stage into "
        "Pending Changes with CLI enrollment commands.",
    )
    s.text(32, 40, "4-Step End-to-End Service Setup Wizard", size=19, weight=700)
    s.text(
        32,
        61,
        "Creates intercept.v1 & host.v1 configs, service, hosting identity, user group/device, Bind & Dial policies, and router coverage.",
        size=12.5,
        color="muted",
    )

    s.zone(24, 80, 992, 256, "GUIDED WIZARD FLOW · STAGED INTO PENDING CHANGES")

    steps = [
        (
            44,
            "1 · Service Template",
            [
                "16 built-in templates:",
                "SSH, RDP, Ollama, HTTPS,",
                "Postgres, Redis, K8s, Custom",
                "",
                "Suggests idiomatic names:",
            ],
            ["crm-https", "crm.ziti:443"],
            False,
        ),
        (
            288,
            "2 · Hosting Server",
            [
                "New or existing host identity",
                "running ziti-edge-tunnel.",
                "",
                "Forwards traffic to target:",
                "127.0.0.1:5432 (host.v1)",
            ],
            ["#billing-db-hosts"],
            False,
        ),
        (
            532,
            "3 · Users & Groups",
            [
                "Role attribute group (#dbas,",
                "#developers, #sre, #sales).",
                "",
                "Ensures reachability via new",
                "device or existing identities.",
            ],
            ["#dbas", "jdoe-laptop"],
            False,
        ),
        (
            776,
            "4 · Review & Stage",
            [
                "✓ intercept.v1 & host.v1",
                "✓ service + identities",
                "✓ Bind & Dial policies",
                "✓ ERP / SERP if uncovered",
                "✓ CLI enrollment commands",
            ],
            ["Stage & Apply"],
            True,
        ),
    ]

    for x, title, lines, badges, accent in steps:
        s.card(x, 120, 220, 194, title, lines, badges, accent=accent, mono_title=False)

    s.arrow([(264, 217), (288, 217)], "http")
    s.arrow([(508, 217), (532, 217)], "http")
    s.arrow([(752, 217), (776, 217)], "overlay")

    return s


def controller_architecture(t):
    s = Svg(
        1040,
        420,
        t,
        "Plug-compatible architecture with OpenZiti Controller and ZAC binding",
        "Baked Pasta Console builds a drop-in static SPA bundle (ziti-console.zip) served directly by an OpenZiti "
        "Controller zac binding or any static web server, communicating with the OpenZiti Edge Management API "
        "(/edge/management/v1) and OIDC PKCE (/oidc).",
    )
    s.text(32, 40, "Plug-Compatible Architecture · OpenZiti Controller & ZAC Binding", size=19, weight=700)
    s.text(
        32,
        61,
        "Drop-in static SPA bundle (ziti-console.zip) speaking standard OpenZiti Edge Management REST & OIDC PKCE.",
        size=12.5,
        color="muted",
    )

    # Left Zone: Baked Pasta Console SPA
    s.zone(24, 84, 330, 312, "BAKED PASTA CONSOLE · STATIC SPA")
    s.card(
        44,
        124,
        290,
        250,
        "baked-pasta-console",
        [
            "React 19 + TypeScript + Vite",
            "Access Canvas (Board & Flow)",
            "4-Step Guided Service Wizard",
            "Reachability Advisor & Diff",
            "Full Edge Management CRUD",
            "Interactive Demo Sandbox",
            "",
            "Drop-in build artifacts:",
        ],
        ["dist/", "ziti-console.zip"],
        accent=True,
    )

    # Right Zone: OpenZiti Controller & Deployment
    s.zone(416, 84, 600, 312, "OPENZITI CONTROLLER & WEB BINDING")
    s.card(
        446,
        124,
        252,
        116,
        "Controller Web Binding (zac)",
        [
            "Mount static SPA at /zac/ or /",
            "/opt/openziti/share/console",
        ],
        ["binding: zac", "./build.sh /zac/"],
        mono_title=False,
    )
    s.card(
        712,
        124,
        282,
        116,
        "Authentication & Session",
        [
            "UPDB password & OIDC PKCE",
            "zt-session & Bearer JWT tokens",
        ],
        ["UPDB / OIDC", "ziti.settings"],
        mono_title=False,
    )
    s.card(
        446,
        258,
        548,
        116,
        "OpenZiti Edge Management API (/edge/management/v1)",
        [
            "Identities · Services · Configs · Edge Routers · Posture Checks",
            "Service Policies (Dial/Bind) · Edge Router & Service Router Policies · Terminators",
        ],
        ["GET / POST / PATCH / DELETE", "ziti.access-canvas.layout.<ctrl>"],
        mono_title=False,
    )

    s.arrow([(334, 182), (446, 182)], "overlay", "ziti-console.zip", (390, 166))
    s.arrow([(334, 316), (446, 316)], "http", "REST + OIDC", (390, 300))

    return s


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in (
        ("access-canvas", access_canvas),
        ("service-wizard", service_wizard),
        ("controller-architecture", controller_architecture),
    ):
        for theme, t in THEMES.items():
            suffix = "" if theme == "light" else "-on-dark"
            build(t).save(OUT / f"{name}{suffix}.svg")
    print(f"Wrote diagrams to {OUT}")


if __name__ == "__main__":
    main()
