"""Build the Baked Pasta Console logo set: mark, lockups (light/dark), favicon, and GitHub social preview.

Uses the ziti-in-marinara casserole dish mark, Fraunces wordmark outlines ("baked pasta console"),
and culinary brand palette (Deep Basil Green, Marinara Tomato, Ziti Gold, Warm Cream).

Usage, from the repo root:
    FRAUNCES_TTF=/tmp/Fraunces.ttf /tmp/logo-venv/bin/python scripts/logo/build_logo.py
    rsvg-convert -w 2400 assets/logo/baked-pasta-console-lockup.svg -o assets/logo/baked-pasta-console-lockup.png
    rsvg-convert -w 2400 assets/logo/baked-pasta-console-lockup-on-dark.svg -o assets/logo/baked-pasta-console-lockup-on-dark.png
    rsvg-convert -w 1280 assets/logo/social-preview.svg -o assets/logo/social-preview.png
"""
import json, os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT = Path(os.environ.get("FRAUNCES_TTF", "/tmp/Fraunces.ttf"))
ROOT = HERE.parent.parent
OUT = ROOT / "assets" / "logo"
PUBLIC = ROOT / "public"
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)

GREEN, TOMATO, GOLD, GOLD_END = "#14302B", "#D9481C", "#F2B544", "#FBE3A6"
CREAM = "#F6ECDC"


def outline(text, size, wght=720):
    r = subprocess.run(
        [sys.executable, "-I", str(HERE / "outline.py"), str(FONT), text, str(size), str(wght), "0"],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(r.stdout)


def mark(dish=GREEN, line=GREEN, hole=GREEN, uid="z"):
    """The Baked Pasta casserole mark on a 64x64 grid (no <svg> wrapper)."""
    return f'''<defs><g id="{uid}">
<path d="M0 -7 H20 A4 7 0 0 1 20 7 H0 Z" fill="{GOLD}" stroke="{line}" stroke-width="2.75" stroke-linejoin="round"/>
<ellipse rx="4" ry="7" fill="{GOLD_END}" stroke="{line}" stroke-width="2.75"/>
<ellipse rx="1.8" ry="3.7" fill="{hole}"/>
</g></defs>
<use href="#{uid}" transform="translate(22 17) rotate(-12)"/>
<path d="M27 12.6 Q33 10.8 39 9.6 Q42 9 42.5 11 Q43 13 41 14 Q40 16.5 38.5 15.5 Q37.5 14.8 36 15.6 Q33 18 31.5 16 Q30 15 28.6 16.4 Q26.5 17.5 26.3 15 Z" fill="{TOMATO}"/>
<use href="#{uid}" transform="translate(8 28) rotate(4)"/>
<use href="#{uid}" transform="translate(56 28) scale(-1 1) rotate(4)"/>
<path d="M4 36 Q4 31 9 32 Q14 33 17 30.5 Q20 28 23 31 Q26 34 30 30.5 Q33 28 36 31 Q39 34 42 31 Q45 28 48 30.5 Q51 33 55 32 Q60 31 60 36 Z" fill="{TOMATO}"/>
<rect class="dish" x="1" y="35" width="62" height="7" rx="3.5" fill="{dish}"/>
<path class="dish" d="M7 41 H57 L54 52 Q52.8 56 48.8 56 H15.2 Q11.2 56 10 52 Z" fill="{dish}"/>'''


def svg(view_w, view_h, body, label="Baked Pasta Console"):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w:g} {view_h:g}" role="img" '
        f'aria-label="{label}">{body}</svg>\n'
    )


def write(name, content):
    (OUT / name).write_text(content)


SIZE = 40
baked = outline("baked", SIZE)
pasta = outline("pasta", SIZE)
console = outline("console", SIZE, wght=560)
space = outline("a a", SIZE)["width"] - 2 * outline("a", SIZE)["width"]


def wordmark(x, baseline, word_color, accent=TOMATO, third_color=None, scale=1.0):
    if third_color is None:
        third_color = word_color
    gap = space * 0.9
    x_pasta = baked["width"] + gap
    x_console = x_pasta + pasta["width"] + gap
    total_w = (x_console + console["width"]) * scale
    g = (
        f'<g transform="translate({x:g} {baseline:g}) scale({scale:g})">'
        f'<path d="{baked["d"]}" fill="{word_color}"/>'
        f'<path transform="translate({x_pasta:.2f} 0)" d="{pasta["d"]}" fill="{accent}"/>'
        f'<path transform="translate({x_console:.2f} 0)" d="{console["d"]}" fill="{third_color}" opacity="0.88"/>'
        f"</g>"
    )
    return g, total_w


# 1. Marks (light & dark) + Favicon
write("baked-pasta-mark.svg", svg(64, 64, mark()))
write("baked-pasta-mark-on-dark.svg", svg(64, 64, mark(dish=CREAM)))
(PUBLIC / "favicon.svg").write_text(
    svg(64, 64, f"<style>@media (prefers-color-scheme: dark){{.dish{{fill:{CREAM}}}}}</style>" + mark())
)

# 2. Lockups: mark + "baked pasta console" wordmark (light & dark)
for name, word_color, dish in [
    ("baked-pasta-console-lockup.svg", GREEN, GREEN),
    ("baked-pasta-console-lockup-on-dark.svg", CREAM, CREAM),
]:
    words, w = wordmark(80, 44, word_color)
    write(name, svg(80 + w + 4, 64, mark(dish=dish) + words))

# 3. GitHub Social Preview (1280x640)
tag = outline("Access Canvas & zero-trust console for OpenZiti.", 28, wght=420)
sub = outline("Plug-compatible with ziti-console · Interactive Access Canvas & Wizards", 21, wght=420)
words, w = wordmark(0, 0, GREEN, scale=1.65)
mark_px = 260
text_w = max(w, tag["width"], sub["width"])
left = round((1280 - (mark_px + 52 + text_w)) / 2)
text_x = left + mark_px + 52
body = (
    f'<rect width="1280" height="640" fill="{CREAM}"/>'
    f'<rect x="0" y="616" width="1280" height="24" fill="{GREEN}"/>'
    f'<g transform="translate({left} 170) scale({mark_px / 64:g})">{mark()}</g>'
    f'<g transform="translate({text_x} 290)">{words}</g>'
    f'<path transform="translate({text_x + 4} 360)" d="{tag["d"]}" fill="{GREEN}"/>'
    f'<path transform="translate({text_x + 4} 404)" d="{sub["d"]}" fill="{GREEN}" opacity=".7"/>'
)
write("social-preview.svg", svg(1280, 640, body))
print(f"Wrote logos to {OUT}")
