import * as Renderer from './renderer.js';
import * as Interactions from './interactions.js';
import * as Data from './data.js';

export class BubbleChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        this.nodes = [];
        this.animationFrame = null;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.centerX = this.width / 2;
        this.centerY = this.height / 2;
        this.showLabels = false; // default: labels hidden
        this.minBubblePx = 6; // lower bound for smallest bubbles
        this.warmupStepsDefault = 250; // run physics without drawing initially
        this.warmupSteps = 0;
        this.topNExplicit = 100; // always show top N by downloadRate (default changed to 100)
        this.includeFullGroups = false; // whether to include all connected mods in groups

        // Loading screen & worker control
        this.simulationComplete = false;
        this.totalWarmupSteps = 0;
        this.completedWarmupSteps = 0;
        this.currentChunkSteps = 0;
        this.lastMessageTime = 0;
        this.loadingMessages = [
            "Calculating graph",
            "Reorienting charge drive",
            "Combulationizing",
            "Crunching the numbers",
            "Burning some books",
            "Feeding the hamsters",
            "Reticulating splines",
            "Mining more andesite",
            "Mixing it up",
        ];

        // View/zoom state for smooth auto-fit
        this.viewScale = 1;
        this.targetScale = 1;
        this.viewCenterX = this.centerX;
        this.viewCenterY = this.centerY;
        this.targetCenterX = this.centerX;
        this.targetCenterY = this.centerY;
        this.zoomLerp = 0.1; // smoothing factor for scale/center
        this.minViewScale = 0.05;
        this.maxViewScale = 10.0;
        this.fitPadding = 0.9; // leave 10% margin when fitting

        // User-controlled pan and zoom (independent of auto-framing)
        this.userPanX = 0;
        this.userPanY = 0;
        this.userZoom = 1.0;
        this.targetUserPanX = 0;
        this.targetUserPanY = 0;
        this.targetUserZoom = 1.0;
        this.userPanLerp = 0.3; // Smoothing factor for pan
        this.userZoomLerp = 0.15; // Smoothing factor for zoom
        this.minUserZoom = 0.05;
        this.maxUserZoom = 30.0;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // Cohesion forces to keep clusters from splitting apart
        this.cohesionStrength = 0.002; // base pull between all mods
        this.cohesionDecay = 200; // distance scale for exponential pull (updated on resize)

        // Physics constants
        this.baseFriction = 0.4;
        this.friction = this.baseFriction;
        this.renderStartTime = null;

        this.collisionStrength = 0.2;
        this.attractionStrength = 0.9;
        this.unrelatedRepulsion = 2.0;

        this.neighborGravityCount = 0; // disabled
        this.neighborGravityStrength = 0.015; // small per-tick pull (tweakable)
        this.neighborGravityDamping = 0.02; // 0 = no damping, 1 = immediate velocity match
        this.neighborGravityMaxDelta = 0.6;
        // Optional, gentle global gravity toward canvas center for cohesion. It is
        // intentionally scaled to avoid causing a central singularity. Set to 0 to disable.
        // Increased default strength slightly and allow larger per-tick delta.
        this.globalGravityStrength = 2.0;
        this.globalGravityMaxDelta = 1.5;
        // Note: global gravity is now a linear radial gradient where strength = dist / maxDist
        // (clamped 0..1). Edge boost is applied on top of this and uses a fraction of the current
        // maximum node distance (globalGravityEdgeStart).
        // Edge boost: additional multiplier applied to gravity for nodes that are
        // far from the canvas center (to pull stray/outer nodes back in more strongly)
        // NOTE: globalGravityEdgeStart is now interpreted as a fraction of the
        // maximum node distance from center (0..1), e.g., 0.6 starts boost at 60% of max distance.
        this.globalGravityEdgeStart = 0.6; // fraction of max node distance where boost starts
        this.globalGravityEdgeBoostFactor = 1.8; // extra multiplier at max distance
        // Long-range cohesion: strengthen per-group pull for nodes far from their group leader
        this.groupCohesionLongRangeThreshold = 2.0; // multiplier of targetRadius where boost starts
        this.groupCohesionLongRangeMultiplier = 1.6; // per-unit multiplier for long-range gap
        this.groupCohesionLongRangeMaxMultiplier = 6.0; // clamp multiplier to avoid extreme forces

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas.parentElement);

        // Bind methods
        this.animate = this.animate.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseLeave = this.onMouseLeave.bind(this);

        // Tooltip element
        this.tooltip = document.createElement("div");
        this.tooltip.style.position = "absolute";
        this.tooltip.style.pointerEvents = "none";
        this.tooltip.style.background = "rgba(0,0,0,0.8)";
        this.tooltip.style.color = "#fff";
        this.tooltip.style.padding = "6px 8px";
        this.tooltip.style.borderRadius = "6px";
        this.tooltip.style.font = "12px Arial";
        this.tooltip.style.maxWidth = "280px";
        this.tooltip.style.display = "none";
        this.tooltip.style.zIndex = "10";
        this.canvas.parentElement.style.position =
            this.canvas.parentElement.style.position || "relative";
        this.canvas.parentElement.appendChild(this.tooltip);

        // Hover state
        this.hoverNode = null;
        this.highlightComponentId = null;
        this.canvas.addEventListener("mousemove", this.onMouseMove);
        this.canvas.addEventListener("mouseleave", this.onMouseLeave);

        // Pan and zoom event listeners
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMoveForPan = this.onMouseMoveForPan.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);
        this.canvas.addEventListener("mousedown", this.onMouseDown);
        this.canvas.addEventListener("wheel", this.onWheel, { passive: false });

        // Leaderboard state
        this.componentStats = [];
        this.componentStatsMap = new Map();
        this.showGroupLabels = false; // whether to paint component-level author labels

        this.resize();
    }

    resize() {
        const parent = this.canvas.parentElement;
        // Respect devicePixelRatio for crisp rendering
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const cssWidth = parent.clientWidth;
        const cssHeight = parent.clientHeight;

        // Visual size uses CSS pixels; internal buffer uses physical pixels
        this.canvas.style.width = cssWidth + "px";
        this.canvas.style.height = cssHeight + "px";
        this.canvas.width = Math.round(cssWidth * dpr);
        this.canvas.height = Math.round(cssHeight * dpr);

        // Keep logical dimensions as CSS pixels for layout math
        this.width = cssWidth;
        this.height = cssHeight;
        // Reset transform so drawing coordinates map to CSS pixels
        if (this.ctx && typeof this.ctx.setTransform === "function") {
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        this.centerX = this.width / 2;
        this.centerY = this.height / 2;

        // Recalculate bubble radii on resize for dynamic scaling
        this.updateRadiusScale();

        // Keep view center aligned and clamp scale after resize
        this.viewCenterX = this.centerX;
        this.viewCenterY = this.centerY;
        this.targetCenterX = this.centerX;
        this.targetCenterY = this.centerY;
        this.targetScale = Math.min(
            this.maxViewScale,
            Math.max(this.minViewScale, this.viewScale)
        );
        this.viewScale = this.targetScale;
        // Update cohesion decay with canvas size
        this.cohesionDecay = Math.min(this.width, this.height) * 0.4;
    }

    updateViewTarget() {
        if (!this.nodes || this.nodes.length === 0) return;
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        for (let i = 0; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            const nx1 = n.x - n.radius;
            const nx2 = n.x + n.radius;
            const ny1 = n.y - n.radius;
            const ny2 = n.y + n.radius;
            if (nx1 < minX) minX = nx1;
            if (ny1 < minY) minY = ny1;
            if (nx2 > maxX) maxX = nx2;
            if (ny2 > maxY) maxY = ny2;
        }
        const bw = Math.max(1, maxX - minX);
        const bh = Math.max(1, maxY - minY);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const scaleFit =
            this.fitPadding * Math.min(this.width / bw, this.height / bh);
        const clampedScale = Math.min(
            this.maxViewScale,
            Math.max(this.minViewScale, scaleFit)
        );
        this.targetCenterX = cx;
        this.targetCenterY = cy;
        this.targetScale = clampedScale;
    }

    updateViewLerp() {
        this.viewCenterX +=
            (this.targetCenterX - this.viewCenterX) * this.zoomLerp;
        this.viewCenterY +=
            (this.targetCenterY - this.viewCenterY) * this.zoomLerp;
        this.viewScale += (this.targetScale - this.viewScale) * this.zoomLerp;
    }

    updateUserViewLerp() {
        // Smooth interpolation for user pan and zoom
        this.userPanX +=
            (this.targetUserPanX - this.userPanX) * this.userPanLerp;
        this.userPanY +=
            (this.targetUserPanY - this.userPanY) * this.userPanLerp;
        this.userZoom +=
            (this.targetUserZoom - this.userZoom) * this.userZoomLerp;
    }

    runWarmup(steps) {
        const s = Math.max(0, steps | 0);
        this.totalWarmupSteps = s;
        this.completedWarmupSteps = 0;
        this.simulationComplete = false;
        
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'flex';
        
        const fill = document.getElementById('loading-progress-fill');
        if (fill) fill.style.width = '0%';
        
        const text = document.getElementById('loading-text');
        if (text) text.innerText = "Initializing...";
        
        this.draw();
    }

    initWorker() {
        this.worker = new Worker('./bubble-chart/physics-worker.js');
        this.physicsUpdating = false;
        this.worker.onmessage = (e) => {
            this.nodes = e.data.nodes;
            this.completedWarmupSteps += this.currentChunkSteps;
            this.physicsUpdating = false;

            if (this.completedWarmupSteps >= this.totalWarmupSteps && !this.simulationComplete) {
                this.simulationComplete = true;
                const overlay = document.getElementById('loading-overlay');
                if (overlay) overlay.style.display = 'none';
            }
        };
    }

    animate() {
        if (!this.renderStartTime) {
            this.renderStartTime = Date.now();
        }
        
        if (!this.worker) {
            this.initWorker();
        }

        // Step-count based progress ratio, updated every frame from completedWarmupSteps
        const progressRatio = this.totalWarmupSteps > 0
            ? Math.min(this.completedWarmupSteps / this.totalWarmupSteps, 1.0)
            : 1.0;

        // Update progress bar every frame (smooth, not dependent on worker reply speed)
        if (!this.simulationComplete) {
            const fill = document.getElementById('loading-progress-fill');
            if (fill) fill.style.width = Math.round(progressRatio * 100) + '%';

            // Rotate messages every ~2 seconds
            const now = Date.now();
            if (now - this.lastMessageTime > 2000) {
                this.lastMessageTime = now;
                const text = document.getElementById('loading-text');
                if (text) {
                    text.innerText = this.loadingMessages[Math.floor(Math.random() * this.loadingMessages.length)] + "...";
                }
            }
        }

        // Friction: starts at 0.92 (nodes move freely), eases to ~0 as steps complete.
        // Simple linear decay so it never hits 0 before all steps are done.
        this.friction = 0.92 * (1 - progressRatio);

        if (!this.physicsUpdating && !this.simulationComplete) {
            this.currentChunkSteps = Math.min(4, this.totalWarmupSteps - this.completedWarmupSteps);
            if (this.currentChunkSteps <= 0) {
                this.simulationComplete = true;
            } else {
                this.physicsUpdating = true;
                this.worker.postMessage({
                    nodes: this.nodes,
                    steps: this.currentChunkSteps,
                    config: {
                        centerX: this.centerX,
                        centerY: this.centerY,
                        width: this.width,
                        height: this.height,
                        neighborGravityStrength: this.neighborGravityStrength,
                        neighborGravityCount: this.neighborGravityCount,
                        neighborGravityDamping: this.neighborGravityDamping,
                        neighborGravityMaxDelta: this.neighborGravityMaxDelta,
                        cohesionDecay: this.cohesionDecay,
                        globalGravityStrength: this.globalGravityStrength,
                        globalGravityMaxDelta: this.globalGravityMaxDelta,
                        globalGravityEdgeStart: this.globalGravityEdgeStart,
                        globalGravityEdgeBoostFactor: this.globalGravityEdgeBoostFactor,
                        friction: this.friction,
                        collisionStrength: this.collisionStrength,
                        attractionStrength: this.attractionStrength,
                        unrelatedRepulsion: this.unrelatedRepulsion,
                        cohesionStrength: this.cohesionStrength,
                        groupCohesionLongRangeThreshold: this.groupCohesionLongRangeThreshold,
                        groupCohesionLongRangeMultiplier: this.groupCohesionLongRangeMultiplier,
                        groupCohesionLongRangeMaxMultiplier: this.groupCohesionLongRangeMaxMultiplier
                    }
                });
            }
        }

        this.updateViewTarget();
        this.updateViewLerp();
        this.updateUserViewLerp();
        this.draw();
        this.animationFrame = requestAnimationFrame(this.animate);
    }

    dispose() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener("mousemove", this.onMouseMove);
        this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
        this.canvas.removeEventListener("mousedown", this.onMouseDown);
        this.canvas.removeEventListener("wheel", this.onWheel);
        window.removeEventListener("mousemove", this.onMouseMoveForPan);
        window.removeEventListener("mouseup", this.onMouseUp);
        if (this.tooltip && this.tooltip.parentElement) {
            this.tooltip.parentElement.removeChild(this.tooltip);
        }
    }
}

// Mixin methods
Object.assign(BubbleChart.prototype, Renderer);
Object.assign(BubbleChart.prototype, Interactions);
Object.assign(BubbleChart.prototype, Data);
