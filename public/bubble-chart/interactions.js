import { escapeHtml } from './utils.js';

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
