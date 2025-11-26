export function hashToHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h % 360;
}

export function escapeHtml(str) {
    return String(str).replace(
        /[&<>"]/g,
        (s) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[s])
    );
}

// Chaikin's corner cutting for closed polygons
export function smoothClosed(points, iterations = 1) {
    let pts = points.slice();
    for (let it = 0; it < iterations; it++) {
        const res = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const q = {
                x: a.x * 0.75 + b.x * 0.25,
                y: a.y * 0.75 + b.y * 0.25,
            };
            const r = {
                x: a.x * 0.25 + b.x * 0.75,
                y: a.y * 0.25 + b.y * 0.75,
            };
            res.push(q, r);
        }
        pts = res;
    }
    return pts;
}

// Andrew's monotone chain convex hull
export function convexHull(points) {
    const pts = points
        .slice()
        .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o, a, b) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
        while (
            lower.length >= 2 &&
            cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
        )
            lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (
            upper.length >= 2 &&
            cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
        )
            upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}
