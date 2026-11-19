"""Tiny connected-component labeler (no scipy needed)."""
import numpy as np

def components(mask):
    H, W = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    ys, xs = np.nonzero(mask)
    for y, x in zip(ys, xs):
        if seen[y, x]:
            continue
        stack = [(y, x)]; seen[y, x] = True
        minx = maxx = x; miny = maxy = y; n = 0
        while stack:
            cy, cx = stack.pop(); n += 1
            minx = min(minx, cx); maxx = max(maxx, cx); miny = min(miny, cy); maxy = max(maxy, cy)
            for ny, nx in ((cy+1, cx), (cy-1, cx), (cy, cx+1), (cy, cx-1)):
                if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; stack.append((ny, nx))
        out.append((minx, miny, maxx - minx + 1, maxy - miny + 1, n))
    return out
