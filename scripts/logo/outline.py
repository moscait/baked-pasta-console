import sys, json
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font_path, text, size, wght, tracking = (
    sys.argv[1],
    sys.argv[2],
    float(sys.argv[3]),
    float(sys.argv[4]),
    float(sys.argv[5]),
)
f = instancer.instantiateVariableFont(TTFont(font_path), {"wght": wght, "opsz": 72, "SOFT": 100, "WONK": 0})
upm = f["head"].unitsPerEm
s = size / upm
gs = f.getGlyphSet()
cmap = f.getBestCmap()
hmtx = f["hmtx"]
pen = SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
x = 0.0
for ch in text:
    g = cmap[ord(ch)]
    gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, 0)))
    x += hmtx[g][0] * s + tracking
print(
    json.dumps(
        {
            "d": pen.getCommands(),
            "width": x - tracking,
            "xheight": f["OS/2"].sxHeight * s,
            "cap": f["OS/2"].sCapHeight * s,
        }
    )
)
