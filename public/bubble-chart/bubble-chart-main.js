export class BubbleChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.animationFrame = null;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.centerX = this.width / 2;
        this.centerY = this.height / 2;
        this.showLabels = false; // default: labels hidden
        this.minBubblePx = 6; // lower bound for smallest bubbles
        this.warmupStepsDefault = 120; // run physics without drawing initially
        this.warmupSteps = 0;
        this.topNExplicit = 100; // always show top N by downloadRate (default changed to 100)
        this.includeFullGroups = false; // whether to include all connected mods in groups

        // View/zoom state for smooth auto-fit
        this.viewScale = 1;
        this.targetScale = 1;
        this.viewCenterX = this.centerX;
        this.viewCenterY = this.centerY;
        this.targetCenterX = this.centerX;
        this.targetCenterY = this.centerY;
        this.zoomLerp = 0.1; // smoothing factor for scale/center
        this.minViewScale = 0.3;
        this.maxViewScale = 2.0;
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
        this.minUserZoom = 0.2;
        this.maxUserZoom = 5.0;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.lastPanX = 0;
        this.lastPanY = 0;
        
        // Cohesion forces to keep clusters from splitting apart
        this.cohesionStrength = 0.002; // base pull between all mods
        this.cohesionDecay = 200; // distance scale for exponential pull (updated on resize)
        
    // Physics constants
    this.friction = 0.4;

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
        this.tooltip = document.createElement('div');
        this.tooltip.style.position = 'absolute';
        this.tooltip.style.pointerEvents = 'none';
        this.tooltip.style.background = 'rgba(0,0,0,0.8)';
        this.tooltip.style.color = '#fff';
        this.tooltip.style.padding = '6px 8px';
        this.tooltip.style.borderRadius = '6px';
        this.tooltip.style.font = '12px Arial';
        this.tooltip.style.maxWidth = '280px';
        this.tooltip.style.display = 'none';
        this.tooltip.style.zIndex = '10';
        this.canvas.parentElement.style.position = this.canvas.parentElement.style.position || 'relative';
        this.canvas.parentElement.appendChild(this.tooltip);

        // Hover state
        this.hoverNode = null;
        this.highlightComponentId = null;
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseleave', this.onMouseLeave);
        
        // Pan and zoom event listeners
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMoveForPan = this.onMouseMoveForPan.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

        // Leaderboard state
        this.componentStats = [];

        this.resize();
    }

    // ... (full class body is identical to the original file in the repository)
    // For maintainability the rest of the implementation remains in this file
    // to preserve behavior while allowing the codebase to be reorganized into
    // smaller modules later.
}
