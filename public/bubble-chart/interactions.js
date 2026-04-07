import { escapeHtml, smoothClosed, convexHull } from './utils.js';

export function toggleFullscreen() {
    const container = this.canvas.parentElement;
    if (!document.fullscreenElement) {
        // Enter fullscreen
        container.requestFullscreen().catch((err) => {
            console.error("Error attempting to enable fullscreen:", err);
        });

        // Listen for fullscreen change to trigger resize
        const onFullscreenChange = () => {
            if (document.fullscreenElement) {
                // Entered fullscreen - ensure canvas fills container and resize
                this.canvas.style.width = "100%";
                this.canvas.style.height = "100%";
                // Let resize observer recalc - also call resize for immediate effect
                // Use a small timeout to allow layout to apply in some browsers
                setTimeout(() => {
                    this.resize();
                    // Recalculate any derived values
                    this.updateRadiusScale();
                    this.cohesionDecay =
                        Math.min(this.width, this.height) * 0.4;
                    this.updateViewTarget();
                }, 50);
            } else {
                // Exited fullscreen - clear explicit canvas style to go back to normal
                this.canvas.style.width = "";
                this.canvas.style.height = "";
                // Resize back to the parent container dimensions
                setTimeout(() => {
                    this.resize();
                }, 50);
                document.removeEventListener(
                    "fullscreenchange",
                    onFullscreenChange
                );
                document.removeEventListener(
                    "webkitfullscreenchange",
                    onFullscreenChange
                );
                document.removeEventListener(
                    "mozfullscreenchange",
                    onFullscreenChange
                );
            }
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        document.addEventListener(
            "webkitfullscreenchange",
            onFullscreenChange
        );
        document.addEventListener(
            "mozfullscreenchange",
            onFullscreenChange
        );
    } else {
        document.exitFullscreen();
    }
}

export function downloadHighRes() {
    // Create a temporary high-resolution canvas (4x current size)
    const scale = 4;
    const cssWidth = this.width;
    const cssHeight = this.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const newDpr = dpr * scale;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = Math.round(cssWidth * newDpr);
    tempCanvas.height = Math.round(cssHeight * newDpr);
    const tempCtx = tempCanvas.getContext("2d");
    // Map CSS pixel drawing coordinates to high-res pixels
    if (tempCtx && typeof tempCtx.setTransform === "function") {
        tempCtx.setTransform(newDpr, 0, 0, newDpr, 0, 0);
    }

    // Store original context and dimensions
    const originalCtx = this.ctx;
    const originalWidth = this.width;
    const originalHeight = this.height;
    const originalCenterX = this.centerX;
    const originalCenterY = this.centerY;

    // Freeze current nodes and animation so the render is based on the current state
    const wasAnimating = !!this.animationFrame;
    if (wasAnimating) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
    }
    const originalNodes = this.nodes;
    // Create a shallow copy of nodes which captures their positions/velocities/radii
    const nodesSnapshot = originalNodes.map((n) => ({ ...n }));
    // Temporarily render from the snapshot to make sure we don't recalc positions
    this.nodes = nodesSnapshot;

    // Temporarily use high-res canvas for rendering but keep logical width/height the same
    this.ctx = tempCtx;
    this.width = cssWidth;
    this.height = cssHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;

    // Render one frame at high resolution using the snapshot
    this.draw();

    // Restore original context, nodes and dimensions
    this.ctx = originalCtx;
    this.width = originalWidth;
    this.height = originalHeight;
    this.centerX = originalCenterX;
    this.centerY = originalCenterY;
    this.nodes = originalNodes;
    if (wasAnimating) this.animate();

    // Convert canvas to blob and trigger download
    tempCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const timestamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, "-");
        link.download = `bubble-chart-${timestamp}.png`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }, "image/png");
}

export function exportSVG() {
    // --- Compute auto-fit at a resolution where the smallest node is still legible ---
    // World-space bounding box including radii
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let smallestRadius = Infinity;
    for (const n of this.nodes) {
        if (minX > n.x - n.radius) minX = n.x - n.radius;
        if (minY > n.y - n.radius) minY = n.y - n.radius;
        if (maxX < n.x + n.radius) maxX = n.x + n.radius;
        if (maxY < n.y + n.radius) maxY = n.y + n.radius;
        if (!n.isOther && n.radius < smallestRadius) smallestRadius = n.radius;
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const bcx = (minX + maxX) / 2;
    const bcy = (minY + maxY) / 2;

    // Target: smallest bubble should be at least MIN_R pixels on screen
    const MIN_R = 12;
    const neededScale = smallestRadius > 0 ? MIN_R / smallestRadius : 1;
    // SVG dimensions derived from world extent * neededScale (with 8% margin)
    const margin = 1.08;
    const svgWidth = Math.ceil(bw * neededScale * margin);
    const svgHeight = Math.ceil(bh * neededScale * margin);
    // Cap at 16384 to avoid browser rendering limits
    const maxDim = 16384;
    const dimClamp = Math.min(1, maxDim / Math.max(svgWidth, svgHeight));
    const finalWidth = Math.ceil(svgWidth * dimClamp);
    const finalHeight = Math.ceil(svgHeight * dimClamp);

    const fitScale = 0.92 * Math.min(finalWidth / bw, finalHeight / bh);
    const toSvgX = (wx) => (wx - bcx) * fitScale + finalWidth / 2;
    const toSvgY = (wy) => (wy - bcy) * fitScale + finalHeight / 2;
    const toSvgR = (r) => r * fitScale;

    // Stroke widths scale with resolution so they stay proportional
    const baseStroke = Math.max(0.3, Math.min(1.5, 600 / Math.max(finalWidth, finalHeight) * 1.5));
    const hullStroke = baseStroke * 1.3;

    let svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${finalHeight}" viewBox="0 0 ${finalWidth} ${finalHeight}">`;
    svgStr += `<style>
        .hull { fill-opacity: 0.1; stroke-opacity: 0.5; stroke-width: ${hullStroke.toFixed(2)}; }
        .label { font-family: Arial, sans-serif; text-anchor: middle; dominant-baseline: central; fill: #fff; pointer-events: none; font-weight: bold; }
        .sub-label { font-family: Arial, sans-serif; text-anchor: middle; dominant-baseline: central; fill: rgba(255,255,255,0.8); pointer-events: none; }
        .group-label { font-family: Arial, sans-serif; font-weight: bold; text-anchor: middle; dominant-baseline: central; fill: rgba(255,255,255,0.85); pointer-events: none; }
    </style>`;
    svgStr += `<rect width="100%" height="100%" fill="#121212"/>`;

    // Build component hull map
    const componentHulls = new Map();
    this.nodes.forEach(node => {
        if (node.isOther) return;
        if (!componentHulls.has(node.componentId)) componentHulls.set(node.componentId, { author: null, hue: null, nodes: [] });
        componentHulls.get(node.componentId).nodes.push(node);
    });

    // Resolve top author and hue per component
    componentHulls.forEach((hull, compId) => {
        // Hue
        hull.hue = (this.componentHue && typeof this.componentHue.get === 'function')
            ? (this.componentHue.get(compId) ?? 210) : 210;

        let topAuthor = null;
        if (this.componentStatsMap && this.componentStatsMap.has(compId)) {
            const stat = this.componentStatsMap.get(compId);
            if (stat && Array.isArray(stat.rankedAuthors) && stat.rankedAuthors.length > 0)
                topAuthor = stat.rankedAuthors[0];
        }
        if (!topAuthor) {
            const counts = new Map();
            for (const node of hull.nodes) {
                for (const a of (node.authors || [])) counts.set(a, (counts.get(a) || 0) + 1);
            }
            let best = null, bestCount = 0;
            for (const [a, c] of counts.entries()) if (c > bestCount) { best = a; bestCount = c; }
            topAuthor = best;
        }
        hull.author = topAuthor;
    });

    // Draw hulls using world-space convex hull + Chaikin smoothing (matches renderer)
    componentHulls.forEach(({ hue, nodes }) => {
        if (nodes.length < 2) return;
        // Sample K points around each bubble perimeter in world space
        const K = 12;
        const samples = [];
        for (const n of nodes) {
            const pad = n.radius * 1.5;
            for (let i = 0; i < K; i++) {
                const a = (i / K) * Math.PI * 2;
                samples.push({ x: n.x + Math.cos(a) * pad, y: n.y + Math.sin(a) * pad });
            }
        }
        const hull = convexHull(samples);
        if (hull.length < 3) return;
        // Apply Chaikin smoothing (2 iterations like renderer)
        const smoothed = smoothClosed(hull, 2);
        const stroke = `hsla(${hue}, 70%, 50%, 0.6)`;
        const fill = `hsla(${hue}, 70%, 40%, 0.12)`;
        let path = `M ${toSvgX(smoothed[0].x).toFixed(2)} ${toSvgY(smoothed[0].y).toFixed(2)}`;
        for (let i = 1; i < smoothed.length; i++) {
            path += ` L ${toSvgX(smoothed[i].x).toFixed(2)} ${toSvgY(smoothed[i].y).toFixed(2)}`;
        }
        path += ' Z';
        svgStr += `\n<path d="${path}" class="hull" fill="${fill}" stroke="${stroke}" />`;
    });

    // Draw nodes (sorted small first, large last — same as renderer)
    const sorted = [...this.nodes].sort((a, b) => {
        if (a.isOther && !b.isOther) return -1;
        if (b.isOther && !a.isOther) return 1;
        return a.radius - b.radius;
    });

    // Helper to estimate text width in SVG (Arial-ish)
    // Approximate: uppercase ~0.7em, lowercase ~0.5em, digits ~0.6em
    const estimateWidth = (text, size) => {
        let w = 0;
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            if (code >= 65 && code <= 90) w += 0.7; // A-Z
            else if (code >= 48 && code <= 57) w += 0.6; // 0-9
            else if (code === 32) w += 0.3; // space
            else w += 0.5; // lowercase/others
        }
        return w * size;
    };

    sorted.forEach(n => {
        const cx = toSvgX(n.x);
        const cy = toSvgY(n.y);
        const r = Math.max(toSvgR(n.radius), 0.5);
        
        // Node border at 2% of radius (capped for tiny/huge nodes)
        const nodeStrokeWidth = Math.max(0.2, Math.min(r * 0.02, 2.5));
        svgStr += `\n<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${n.color}" stroke="#fff" stroke-width="${nodeStrokeWidth.toFixed(2)}" />`;

        if (this.showLabels) {
            // Mirror renderer label logic: strip "Create" prefix
            let name = n.name;
            const createPrefixMatch = name.match(/^Create\s*(:|\s)/i);
            if (createPrefixMatch) {
                const stripped = name.substring(createPrefixMatch[0].length).trim();
                if (stripped.length > 0) name = stripped;
            }

            let baseFontSize = Math.max(1.5, r * 0.35);
            
            // Constrain width: title must fit inside circle (with padding)
            const pad = Math.max(0.5, r * 0.05);
            const maxWidth = Math.max(2, (r - pad) * 2);
            let titleWidth = estimateWidth(name, baseFontSize);
            if (titleWidth > maxWidth) {
                baseFontSize *= (maxWidth / titleWidth);
            }
            
            // Ensure font size is at least 1px for export
            baseFontSize = Math.max(1, baseFontSize);

            const subFontSize = baseFontSize * 0.8;
            const spacing = baseFontSize * 0.4;
            const sub = n.isOther ? `${n.count} mods` : `${Math.round(n.downloadRate || 0)}/day`;

            // Show subtitle if there's room vertically
            const totalHeight = baseFontSize + spacing + subFontSize;
            const maxTextHeight = Math.max(2, r * 2 - 2);
            let includeSubtitle = totalHeight <= maxTextHeight;

            if (includeSubtitle) {
                // Also check if subtitle fits horizontally
                let subWidth = estimateWidth(sub, subFontSize);
                if (subWidth > maxWidth) includeSubtitle = false;
            }

            if (includeSubtitle) {
                const titleY = cy - spacing * 0.4;
                const subY = cy + spacing * 0.4 + subFontSize * 0.3;
                svgStr += `\n<text x="${cx.toFixed(2)}" y="${titleY.toFixed(2)}" font-size="${baseFontSize.toFixed(2)}px" class="label">${escapeHtml(name)}</text>`;
                svgStr += `\n<text x="${cx.toFixed(2)}" y="${subY.toFixed(2)}" font-size="${subFontSize.toFixed(2)}px" class="sub-label">${escapeHtml(sub)}</text>`;
            } else {
                svgStr += `\n<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="${baseFontSize.toFixed(2)}px" class="label">${escapeHtml(name)}</text>`;
            }
        }
    });

    // Group labels
    if (this.showGroupLabels) {
        componentHulls.forEach(({ author, nodes }) => {
            if (!author || nodes.length < 2) return;
            let sumX = 0, sumY = 0, totalR = 0;
            nodes.forEach(n => { sumX += n.x * n.radius; sumY += n.y * n.radius; totalR += n.radius; });
            const cx = toSvgX(sumX / totalR);
            const cy = toSvgY(sumY / totalR);
            const avgR = toSvgR(totalR / nodes.length);
            let fontSize = Math.max(8, avgR * 0.6);
            
            // Constrain group label width
            const maxWidth = avgR * 2.5;
            const estimated = estimateWidth(author, fontSize);
            if (estimated > maxWidth) {
                fontSize *= (maxWidth / estimated);
            }
            if (fontSize < 4) return;

            svgStr += `\n<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="${fontSize.toFixed(1)}px" class="group-label">${escapeHtml(author)}</text>`;
        });
    }

    svgStr += `\n</svg>`;

    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    link.download = `bubble-chart-${timestamp}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
}

export function toggleLabels(show) {
    this.showLabels = show;
}

export function toggleGroupLabels(show) {
    this.showGroupLabels = show;
}

// Pan and Zoom methods
export function getBounds() {
    if (!this.nodes || this.nodes.length === 0) {
        return { minX: 0, maxX: this.width, minY: 0, maxY: this.height };
    }
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const n of this.nodes) {
        const nx1 = n.x - n.radius;
        const nx2 = n.x + n.radius;
        const ny1 = n.y - n.radius;
        const ny2 = n.y + n.radius;
        if (nx1 < minX) minX = nx1;
        if (ny1 < minY) minY = ny1;
        if (nx2 > maxX) maxX = nx2;
        if (ny2 > maxY) maxY = ny2;
    }
    return { minX, maxX, minY, maxY };
}

export function clampPan() {
    const bounds = this.getBounds();

    // Convert world bounds to framed space
    const framedMinX = (bounds.minX - this.viewCenterX) * this.viewScale;
    const framedMaxX = (bounds.maxX - this.viewCenterX) * this.viewScale;
    const framedMinY = (bounds.minY - this.viewCenterY) * this.viewScale;
    const framedMaxY = (bounds.maxY - this.viewCenterY) * this.viewScale;

    const framedWidth = framedMaxX - framedMinX;
    const framedHeight = framedMaxY - framedMinY;

    // Calculate visible viewport size in framed space
    const viewWidth = this.width / this.targetUserZoom;
    const viewHeight = this.height / this.targetUserZoom;

    // Allow panning with generous padding - keep at least 30% of content visible
    const paddingFactor = 0.7; // Allow 70% of content to go off-screen
    const maxPanOffsetX = framedWidth * paddingFactor + viewWidth / 2;
    const maxPanOffsetY = framedHeight * paddingFactor + viewHeight / 2;

    // Clamp target pan in framed space
    this.targetUserPanX = Math.max(
        -maxPanOffsetX,
        Math.min(maxPanOffsetX, this.targetUserPanX)
    );
    this.targetUserPanY = Math.max(
        -maxPanOffsetY,
        Math.min(maxPanOffsetY, this.targetUserPanY)
    );
}

export function zoomIn() {
    this.targetUserZoom = Math.min(
        this.maxUserZoom,
        this.targetUserZoom * 1.2
    );
    this.clampPan();
}

export function zoomOut() {
    this.targetUserZoom = Math.max(
        this.minUserZoom,
        this.targetUserZoom / 1.2
    );
    this.clampPan();
}

export function panUp() {
    this.targetUserPanY -= 50 / (this.targetUserZoom || this.userZoom || 1);
    this.clampPan();
}

export function panDown() {
    this.targetUserPanY += 50 / (this.targetUserZoom || this.userZoom || 1);
    this.clampPan();
}

export function panLeft() {
    this.targetUserPanX -= 50 / (this.targetUserZoom || this.userZoom || 1);
    this.clampPan();
}

export function panRight() {
    this.targetUserPanX += 50 / (this.targetUserZoom || this.userZoom || 1);
    this.clampPan();
}

export function resetZoom() {
    this.targetUserZoom = 1.0;
    this.targetUserPanX = 0;
    this.targetUserPanY = 0;
}

export function onMouseDown(e) {
    if (e.button === 0) {
        // Left click
        this.isPanning = true;
        const rect = this.canvas.getBoundingClientRect();
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.lastPanX = this.userPanX;
        this.lastPanY = this.userPanY;
        this.canvas.style.cursor = "grabbing";

        window.addEventListener("mousemove", this.onMouseMoveForPan);
        window.addEventListener("mouseup", this.onMouseUp);
        e.preventDefault();
    }
}

export function onMouseMoveForPan(e) {
    if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;

        // Pan in framed space (screen pixels -> framed units).
        // Scale by inverse of zoom so dragging is slower when zoomed in.
        const zoomForPan = this.userZoom || this.targetUserZoom || 1;
        const invZoom = 1 / Math.max(zoomForPan, 0.0001);
        // Direct manipulation - no smoothing during drag for responsive feel
        this.targetUserPanX = this.lastPanX - dx * invZoom;
        this.targetUserPanY = this.lastPanY - dy * invZoom;
        this.userPanX = this.targetUserPanX;
        this.userPanY = this.targetUserPanY;
        this.clampPan();
    }
}

export function onMouseUp(e) {
    if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = "default";
        window.removeEventListener("mousemove", this.onMouseMoveForPan);
        window.removeEventListener("mouseup", this.onMouseUp);
    }
}

export function onWheel(e) {
    e.preventDefault();

    // Only zoom on pinch gesture (ctrlKey is set by browser for pinch-to-zoom)
    // All other wheel events are treated as panning
    const isPinchZoom = e.ctrlKey;

    if (!isPinchZoom) {
        // Pan mode - handle all trackpad scrolling (vertical and horizontal)
        // Scale pan deltas by inverse zoom so scrolling remains in sync with scale
        const panSensitivity = 1.0;
        const zoomForPan = this.targetUserZoom || this.userZoom || 1;
        const invZoom = 1 / Math.max(zoomForPan, 0.0001);
        this.targetUserPanX += e.deltaX * panSensitivity * invZoom;
        this.targetUserPanY += e.deltaY * panSensitivity * invZoom;
        this.clampPan();
    } else {
        // Zoom mode - pinch zoom or ctrl+scroll
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert mouse position to logical canvas (CSS pixels) coordinates
        const scaleX = this.width / rect.width;
        const scaleY = this.height / rect.height;
        const canvasX = mouseX * scaleX;
        const canvasY = mouseY * scaleY;

        // Convert to framed space (before user zoom)
        const framedX =
            (canvasX - this.width / 2) / this.targetUserZoom +
            this.targetUserPanX;
        const framedY =
            (canvasY - this.height / 2) / this.targetUserZoom +
            this.targetUserPanY;

        // Apply zoom
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(
            this.minUserZoom,
            Math.min(this.maxUserZoom, this.targetUserZoom * zoomDelta)
        );

        // Adjust pan to keep mouse position fixed in framed space
        this.targetUserPanX =
            framedX - (canvasX - this.width / 2) / newZoom;
        this.targetUserPanY =
            framedY - (canvasY - this.height / 2) / newZoom;

        this.targetUserZoom = newZoom;
        this.clampPan();
    }
}

// Mouse handlers
export function onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Convert screen -> framed view -> world coordinates
    // First undo user pan/zoom (screen -> framed view)
    const framedX =
        (mouseX - this.width / 2) / this.userZoom + this.userPanX;
    const framedY =
        (mouseY - this.height / 2) / this.userZoom + this.userPanY;
    // Then undo auto-framing (framed view -> world)
    const worldX = framedX / this.viewScale + this.viewCenterX;
    const worldY = framedY / this.viewScale + this.viewCenterY;

    // Find top-most node under cursor (prefer larger drawn last)
    let found = null;
    const sorted = [...this.nodes].sort((a, b) => a.radius - b.radius);
    for (let i = 0; i < sorted.length; i++) {
        const n = sorted[i];
        const dx = worldX - n.x;
        const dy = worldY - n.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= n.radius * n.radius) {
            found = n; // later (larger) replaces earlier
        }
    }

    if (found) {
        this.hoverNode = found;
        this.highlightComponentId = found.isOther
            ? null
            : found.componentId != null && found.componentSize > 1
            ? found.componentId
            : null;
        this.updateTooltip(found, mouseX, mouseY);
    } else {
        this.hoverNode = null;
        this.highlightComponentId = null;
        this.tooltip.style.display = "none";
    }
}

export function onMouseLeave() {
    this.hoverNode = null;
    this.highlightComponentId = null;
    this.tooltip.style.display = "none";
}

export function getAuthorKey(node) {
    const authors = (node.authors || []).slice().sort();
    return authors.join("|");
}

export function updateTooltip(node, mouseX, mouseY) {
    const rect = this.canvas.getBoundingClientRect();
    // Position tooltip relative to parent container
    const parentRect = this.canvas.parentElement.getBoundingClientRect();
    const offsetX = 12;
    const offsetY = 12;
    const pageX = rect.left + mouseX; // mouseX is already in CSS pixels relative to rect
    const pageY = rect.top + mouseY;
    const localX = pageX - parentRect.left;
    const localY = pageY - parentRect.top;

    const authorsList =
        node.authors && node.authors.length ? node.authors.join(", ") : "—";
    const rate = Math.round(node.downloadRate || 0);
    const downloads = node.downloadCount ?? "—";
    this.tooltip.innerHTML =
        `<strong>${escapeHtml(node.name)}</strong><br>` +
        `<span>Authors: ${escapeHtml(authorsList)}</span><br>` +
        `<span>Downloads: ${downloads}</span><br>` +
        `<span>Rate: ${rate}/day</span>`;

    this.tooltip.style.left = `${localX + offsetX}px`;
    this.tooltip.style.top = `${localY + offsetY}px`;
    this.tooltip.style.display = "block";
}
