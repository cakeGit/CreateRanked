
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

    resize() {
        const parent = this.canvas.parentElement;
        // Respect devicePixelRatio for crisp rendering
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const cssWidth = parent.clientWidth;
        const cssHeight = parent.clientHeight;

        // Visual size uses CSS pixels; internal buffer uses physical pixels
        this.canvas.style.width = cssWidth + 'px';
        this.canvas.style.height = cssHeight + 'px';
        this.canvas.width = Math.round(cssWidth * dpr);
        this.canvas.height = Math.round(cssHeight * dpr);

        // Keep logical dimensions as CSS pixels for layout math
        this.width = cssWidth;
        this.height = cssHeight;
        // Reset transform so drawing coordinates map to CSS pixels
        if (this.ctx && typeof this.ctx.setTransform === 'function') {
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
        this.targetScale = Math.min(this.maxViewScale, Math.max(this.minViewScale, this.viewScale));
        this.viewScale = this.targetScale;
        // Update cohesion decay with canvas size
        this.cohesionDecay = Math.min(this.width, this.height) * 0.4;
    }

    setSearchTerm(searchTerm) {
        // Update search term without recreating the chart
        this.searchTermLower = (searchTerm || '').toLowerCase();
    }
    
    setIncludeFullGroups(include) {
        // Update full groups option and rebuild if data exists
        this.includeFullGroups = include;
        if (this.rawData) {
            this.setData(this.rawData);
        }
    }
    
    setData(data) {
        // Stop any existing animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        if (!data || !data.items) return;
        
        // Store raw data for rebuilding when options change
        this.rawData = data;

        // 1. Filter and Group: explicitly take top N by downloadRate
        const sortedByRate = [...data.items].sort((a, b) => (b.downloadRate || 0) - (a.downloadRate || 0));
        let mainMods = sortedByRate.slice(0, this.topNExplicit);
        let otherMods = sortedByRate.slice(this.topNExplicit);
        
        // 2. If includeFullGroups is enabled, recursively expand groups
        if (this.includeFullGroups && otherMods.length > 0) {
            const expanded = this.expandGroups(mainMods, otherMods);
            mainMods = expanded.mainMods;
            otherMods = expanded.otherMods;
        }
        const otherDownloadRate = otherMods.reduce((sum, m) => sum + (m.downloadRate || 0), 0);
        const otherCount = otherMods.length;

        // 3. Create Nodes with better initial spacing
        this.nodes = mainMods.map(mod => ({
            id: mod.id,
            name: mod.name,
            downloadCount: mod.downloadCount,
            downloadRate: mod.downloadRate,
            authors: mod.authors || [],
            x: this.centerX,
            y: this.centerY,
            vx: 0,
            vy: 0,
            radius: 1, // placeholder; will be set by dynamic scaling
            color: 'hsla(210, 2%, 52%, 1.00)', // Placeholder
            isOther: false
        }));

        // Store otherMods for search highlighting
        this.otherMods = otherMods;
        
        if (otherCount > 0) {
            var otherDownloadsTotal = otherMods.reduce((sum, m) => sum + (m.downloadCount || 0), 0);
            this.nodes.push({
                id: 'other',
                name: 'Other',
                downloadCount: otherDownloadsTotal, // Or sum
                downloadRate: otherDownloadRate,
                authors: [],
                x: this.centerX,
                y: this.centerY,
                vx: 0,
                vy: 0,
                radius: 1, // placeholder; will be set by dynamic scaling
                color: '#cccccc',
                isOther: true,
                count: otherCount
            });
        }

        // 4. Assign Colors
        this.assignColors();
        
        // 4.5. Initialize positions based on components to start with better separation
        this.initializeComponentPositions();

        // Store search term for highlight-only behavior
        this.searchTermLower = (data.searchTerm || '').toLowerCase();

        // 5. Dynamic radius scaling (fit to canvas and count)
        this.updateRadiusScale();

        // 6. Compute component stats for leaderboard
        this.computeComponentStats();

        // 7. Fast warm-up: run physics steps synchronously before first draw
        this.runWarmup(this.warmupStepsDefault);

        // 8. Start Animation
        this.animate();
    }

    expandGroups(mainMods, otherMods) {
        // Recursively expand groups to include all connected mods from otherMods
        // that share authors with any mod in mainMods
        
        const included = new Set(mainMods.map(m => m.id));
        const remaining = [...otherMods];
        let addedInLastPass = true;
        
        // Keep searching until no new mods are found
        while (addedInLastPass && remaining.length > 0) {
            addedInLastPass = false;
            
            // Build author set from currently included mods
            const includedAuthors = new Set();
            for (const mod of mainMods) {
                for (const author of (mod.authors || [])) {
                    includedAuthors.add(author);
                }
            }
            
            // Find mods in remaining that share any author with included mods
            for (let i = remaining.length - 1; i >= 0; i--) {
                const mod = remaining[i];
                const modAuthors = mod.authors || [];
                
                // Check if this mod shares any author with included mods
                const hasSharedAuthor = modAuthors.some(author => includedAuthors.has(author));
                
                if (hasSharedAuthor) {
                    mainMods.push(mod);
                    included.add(mod.id);
                    remaining.splice(i, 1);
                    addedInLastPass = true;
                }
            }
        }
        
        return {
            mainMods: mainMods,
            otherMods: remaining
        };
    }
    
    initializeComponentPositions() {
        // Group nodes by component
        const componentGroups = new Map();
        for (const node of this.nodes) {
            if (node.isOther) continue;
            const cid = node.componentId ?? -1;
            if (!componentGroups.has(cid)) {
                componentGroups.set(cid, []);
            }
            componentGroups.get(cid).push(node);
        }
        
        // Arrange components in a grid
        const components = Array.from(componentGroups.entries());
        const gridSize = Math.ceil(Math.sqrt(components.length));
        const spacing = Math.min(this.width, this.height) / (gridSize + 1);
        
        components.forEach(([cid, nodes], index) => {
            const row = Math.floor(index / gridSize);
            const col = index % gridSize;
            const cx = this.centerX + (col - gridSize / 2 + 0.5) * spacing;
            const cy = this.centerY + (row - gridSize / 2 + 0.5) * spacing;
            
            // Spread nodes in this component in a circle
            const componentSize = nodes.length;
            const avgRadius = nodes.reduce((sum, n) => sum + (n.radius || 50), 0) / componentSize;
            const spreadRadius = avgRadius * Math.sqrt(componentSize) * 0.5;
            
            nodes.forEach((node, i) => {
                const angle = (i / componentSize) * Math.PI * 2;
                node.x = cx + Math.cos(angle) * spreadRadius;
                node.y = cy + Math.sin(angle) * spreadRadius;
            });
        });
    }
    
    assignColors() {
        // Build connected components by shared authors (visible nodes only)
        const visibleNodes = this.nodes.filter(n => !n.isOther);
        const authorToIndices = new Map();
        for (let i = 0; i < visibleNodes.length; i++) {
            const authors = visibleNodes[i].authors || [];
            for (const a of authors) {
                if (!authorToIndices.has(a)) authorToIndices.set(a, []);
                authorToIndices.get(a).push(i);
            }
        }

        const compId = new Array(visibleNodes.length).fill(-1);
        let compCounter = 0;
        const compSizes = new Map();

        for (let i = 0; i < visibleNodes.length; i++) {
            if (compId[i] !== -1) continue;
            // BFS
            const queue = [i];
            compId[i] = compCounter;
            let size = 0;
            while (queue.length) {
                const j = queue.shift();
                size++;
                const authors = visibleNodes[j].authors || [];
                for (const a of authors) {
                    const neigh = authorToIndices.get(a) || [];
                    for (const k of neigh) {
                        if (compId[k] === -1) {
                            compId[k] = compCounter;
                            queue.push(k);
                        }
                    }
                }
            }
            compSizes.set(compCounter, size);
            compCounter++;
        }

        // Assign distinct hues per component with size >= 2
        const sharedComps = Array.from(compSizes.entries()).filter(([id, sz]) => sz >= 2);
        sharedComps.sort((a, b) => b[1] - a[1]); // largest first
        const compHue = new Map();
        const goldenAngle = 137.508;
        const offset = 23;
        for (let i = 0; i < sharedComps.length; i++) {
            const id = sharedComps[i][0];
            compHue.set(id, (offset + i * goldenAngle) % 360);
        }

        // Persist component hue mapping for overlays/highlights
        this.componentHue = compHue;

        // Apply colors and store component info on nodes
        for (let i = 0; i < visibleNodes.length; i++) {
            const node = visibleNodes[i];
            const id = compId[i];
            const size = compSizes.get(id) || 1;
            node.componentId = id;
            node.componentSize = size;
            if (size < 2 || (node.authors || []).length === 0) {
                node.color = '#7a7a7a';
                continue;
            }
            let hue = compHue.get(id);
            if (typeof hue !== 'number') hue = this.hashToHue((node.authors || []).join('|'));
            const variation = (Math.random() - 0.5) * 20;
            hue = (hue + variation + 360) % 360;
            const sat = 88;
            const light = 44;
            node.color = `hsl(${hue}, ${sat}%, ${light}%)`;
        }

        // Keep 'Other' grey and clear component info
        for (const node of this.nodes) {
            if (node.isOther) {
                node.color = '#cccccc';
                node.componentId = null;
                node.componentSize = 0;
            }
        }
    }

    hashToHue(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = (h * 31 + str.charCodeAt(i)) >>> 0;
        }
        return h % 360;
    }

    updatePhysics() {
        const nodes = this.nodes;
        const len = nodes.length;
        // Compute maximum distance from canvas center among nodes for linear gravity scaling
        let maxDist = 0;
        if (len > 0) {
            for (let i = 0; i < len; i++) {
                const n = nodes[i];
                const dx = this.centerX - n.x;
                const dy = this.centerY - n.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 0;
                if (d > maxDist) maxDist = d;
            }
        }
        if (maxDist <= 0) maxDist = 1; // Avoid divide-by-zero and degenerate cases

        for (let i = 0; i < len; i++) {
            const node = nodes[i];

            if (this.neighborGravityStrength > 0 && (this.neighborGravityCount > 0)) {
                const neighbors = [];
                for (let j = 0; j < len; j++) {
                    if (j === i) continue;
                    const other = nodes[j];
                    // Skip the aggregated 'Other' node when finding local neighbors
                    if (!other || other.isOther) continue;
                    const dxn = other.x - node.x;
                    const dyn = other.y - node.y;
                    const d2 = dxn * dxn + dyn * dyn;
                    neighbors.push({ idx: j, d2, x: other.x, y: other.y, vx: other.vx, vy: other.vy });
                }
                if (neighbors.length > 0) {
                    neighbors.sort((a, b) => a.d2 - b.d2);
                    const k = Math.min(this.neighborGravityCount, neighbors.length);
                    let cx = 0, cy = 0, avx = 0, avy = 0;
                    for (let m = 0; m < k; m++) {
                        const nb = neighbors[m];
                        cx += nb.x;
                        cy += nb.y;
                        avx += nb.vx || 0;
                        avy += nb.vy || 0;
                    }
                    cx /= k; cy /= k; avx /= k; avy /= k;

                    const dxn = cx - node.x;
                    const dyn = cy - node.y;
                    const dist = Math.sqrt(dxn * dxn + dyn * dyn) || 1;
                    const nx = dxn / dist;
                    const ny = dyn / dist;

                    // Spring force toward centroid, scaled by distance relative to cohesion decay
                    let spring = this.neighborGravityStrength * Math.min(1, dist / Math.max(1, this.cohesionDecay));

                    // Convert spring to delta velocity (soft spring): dx * spring
                    let dvx = nx * spring;
                    let dvy = ny * spring;

                    // Viscous coupling: nudge node velocity toward neighbors' average
                    const rvx = (avx - node.vx) * this.neighborGravityDamping;
                    const rvy = (avy - node.vy) * this.neighborGravityDamping;
                    dvx += rvx;
                    dvy += rvy;

                    // Clamp per-axis delta to avoid impulsive jumps
                    const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
                    dvx = clamp(dvx, this.neighborGravityMaxDelta);
                    dvy = clamp(dvy, this.neighborGravityMaxDelta);

                    node.vx += dvx;
                    node.vy += dvy;
                }
            }

            if (this.globalGravityStrength > 0) {
                const cx = this.centerX, cy = this.centerY;
                const dx = cx - node.x;
                const dy = cy - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                // Linear gradient gravity: scale by distance relative to max node distance
                // strength ranges from 0 (center) to 1 (outermost node)
                let radialFactor = Math.min(1, Math.max(0, dist / maxDist));
                let gStrength = this.computeGlobalGravityStrength(radialFactor, dist, maxDist);
                // Edge boost handled in computeGlobalGravityStrength; no further per-node edge adjustment required here
                // increase gravity effect for larger components to prevent center pull
                const sizeScale = 1 / Math.max(1, Math.sqrt(node.componentSize || 1));
                gStrength *= sizeScale;
                let gvx = (dx / dist) * gStrength;
                let gvy = (dy / dist) * gStrength;
                // Clamp for stability
                const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
                gvx = clamp(gvx, this.globalGravityMaxDelta);
                gvy = clamp(gvy, this.globalGravityMaxDelta);
                node.vx += gvx;
                node.vy += gvy;
            }

            // Drag/Friction (high to reduce jitter)
            const frictionMultiplier = (node.componentSize && node.componentSize > 5) ? 0.75 : 0.88;
            node.vx *= this.friction * frictionMultiplier;
            node.vy *= this.friction * frictionMultiplier;

            // Update Position
            node.x += node.vx;
            node.y += node.vy;

            // Boundary constraints with gentle bounce to keep nodes in view
            if (node.x < node.radius) {
                node.x = node.radius;
                node.vx *= -0.5;
            } else if (node.x > this.width - node.radius) {
                node.x = this.width - node.radius;
                node.vx *= -0.5;
            }
            if (node.y < node.radius) {
                node.y = node.radius;
                node.vy *= -0.5;
            } else if (node.y > this.height - node.radius) {
                node.y = this.height - node.radius;
                node.vy *= -0.5;
            }
            // Apply slight inward nudge when hitting boundaries to avoid sticking
            if (node.x === node.radius || node.x === this.width - node.radius ||
                node.y === node.radius || node.y === this.height - node.radius) {
                node.vx += (this.centerX - node.x) * 0.002;
                node.vy += (this.centerY - node.y) * 0.002;
            }
        }

        // Apply group cohesion forces
        this.applyGroupCohesion();
        
        // Cap velocities for nodes in large groups to prevent oscillation
        for (let i = 0; i < len; i++) {
            const node = nodes[i];
            if (node.componentSize && node.componentSize > 5) {
                const maxVel = 3.0;
                const velMag = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
                if (velMag > maxVel) {
                    const scale = maxVel / velMag;
                    node.vx *= scale;
                    node.vy *= scale;
                }
            }
        }

        // Collision and Attraction
        for (let i = 0; i < len; i++) {
            for (let j = i + 1; j < len; j++) {
                const n1 = nodes[i];
                const n2 = nodes[j];

                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq) || 1;
                const nx = dx / dist;
                const ny = dy / dist;

                // Collision - gentle resolution
                const minDist = n1.radius + n2.radius + 5; // +3 padding
                if (dist < minDist) {
                    // Gentle positional correction
                    const overlap = (minDist - dist);
                    const correction = overlap * 0.5 * this.collisionStrength;
                    n1.x -= nx * correction;
                    n1.y -= ny * correction;
                    n2.x += nx * correction;
                    n2.y += ny * correction;

                    // // Gentle repulsive impulse
                    // const rvx = n2.vx - n1.vx;
                    // const rvy = n2.vy - n1.vy;
                    // const relN = rvx * nx + rvy * ny;
                    // if (relN < 0) {
                    //     const restitution = 0.1;
                    //     const impulse = -(1 + restitution) * relN * 0.3;
                    //     n1.vx -= nx * impulse;
                    //     n1.vy -= ny * impulse;
                    //     n2.vx += nx * impulse;
                    //     n2.vy += ny * impulse;
                    // }
                    
                    // // Gentle separation force
                    // const separationForce = overlap * 0.05;
                    // n1.vx -= nx * separationForce;
                    // n1.vy -= ny * separationForce;
                    // n2.vx += nx * separationForce;
                    // n2.vy += ny * separationForce;
                }

                // Attraction (if sharing authors) or soft repulsion (if unrelated)
                if (!n1.isOther && !n2.isOther) {
                    const sharedAuthors = n1.authors.filter(a => n2.authors.includes(a));
                    if (sharedAuthors.length > 0) {
                        // For nodes in same component, only use group-center cohesion (handled above)
                        // Skip individual connection forces to avoid fighting with group cohesion
                        const sameComponent = (n1.componentId != null && n1.componentId === n2.componentId && (n1.componentSize || 0) > 2);
                        
                        if (!sameComponent) {
                            // Small groups or different components: use direct connection forces
                            const componentSize = Math.max(n1.componentSize || 1, n2.componentSize || 1);
                            const sizeScale = 1 / componentSize;
                            
                            const maxLinkDist = 2 * (n1.radius + n2.radius);
                            if (dist > maxLinkDist) {
                                const excess = dist - maxLinkDist;
                                const correction = excess * 0.5 * sizeScale;
                                n1.x += nx * correction;
                                n1.y += ny * correction;
                                n2.x -= nx * correction;
                                n2.y -= ny * correction;
                            }

                            const rest = minDist + 6;
                            if (dist > rest) {
                                let force = this.attractionStrength * sharedAuthors.length * (dist - rest) * 0.02 * sizeScale;
                                force = Math.min(force, 2.0);
                                const fx = nx * force;
                                const fy = ny * force;
                                n1.vx += fx;
                                n1.vy += fy;
                                n2.vx -= fx;
                                n2.vy -= fy;
                            } else {
                                const repel = (rest - dist) * 0.01;
                                n1.vx -= nx * repel;
                                n1.vy -= ny * repel;
                                n2.vx += nx * repel;
                                n2.vy += ny * repel;
                            }
                        }
                    } else {
                        // Soft repulsion for unrelated nodes (no shared authors)
                        // Stronger repulsion with extended range
                        const repelRange = (n1.radius + n2.radius) * 4.0; // Extended from 2.5 to 4.0
                        if (dist < repelRange) {
                            // Quadratic falloff for stronger push at medium distances
                            const distRatio = 1 - dist / repelRange;
                            const strength = this.unrelatedRepulsion * distRatio * distRatio;
                            const fx = -nx * strength;
                            const fy = -ny * strength;
                            n1.vx += fx;
                            n1.vy += fy;
                            n2.vx -= fx;
                            n2.vy -= fy;
                        }
                    }
                }

                // Global cohesion pull (exponential with distance)
                if (dist > 1) {
                    const expPull = 1 - Math.exp(-dist / this.cohesionDecay);
                    const cForce = this.cohesionStrength * expPull;
                    const cfx = (dx / dist) * cForce;
                    const cfy = (dy / dist) * cForce;
                    n1.vx += cfx;
                    n1.vy += cfy;
                    n2.vx -= cfx;
                    n2.vy -= cfy;
                }
            }
        }
        
    }

    // Expose a small helper for computing gravity strength from a radial factor
    computeGlobalGravityStrength(radialFactor, dist, maxDist) {
        // Base strength is linear in radialFactor
        let gStrength = this.globalGravityStrength * radialFactor;
        // Optional: edge boost (treat globalGravityEdgeStart as fraction of maxDist)
        if (typeof this.globalGravityEdgeStart === 'number' && this.globalGravityEdgeStart > 0) {
            const edgeStart = Math.max(0, Math.min(1, this.globalGravityEdgeStart)) * Math.max(1, maxDist);
            if (dist > edgeStart) {
                const extra = (dist - edgeStart) / Math.max(1, maxDist - edgeStart);
                gStrength *= (1 + extra * this.globalGravityEdgeBoostFactor);
            }
        }
        return gStrength;
    }

    // Compute desired view center and scale to fit all nodes smoothly
    updateViewTarget() {
        if (!this.nodes || this.nodes.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
        const scaleFit = this.fitPadding * Math.min(this.width / bw, this.height / bh);
        const clampedScale = Math.min(this.maxViewScale, Math.max(this.minViewScale, scaleFit));
        this.targetCenterX = cx;
        this.targetCenterY = cy;
        this.targetScale = clampedScale;
    }

    // Lerp view towards target
    updateViewLerp() {
        this.viewCenterX += (this.targetCenterX - this.viewCenterX) * this.zoomLerp;
        this.viewCenterY += (this.targetCenterY - this.viewCenterY) * this.zoomLerp;
        this.viewScale += (this.targetScale - this.viewScale) * this.zoomLerp;
    }

    // Run multiple physics ticks immediately for a fast warm start
    runWarmup(steps) {
        const s = Math.max(0, steps | 0);
        for (let i = 0; i < s; i++) {
            this.updatePhysics();
        }
        // Run 30 ticks (0.5 seconds) - let animation handle the rest
        for (let i = 0; i < 30; i++) {
            this.updatePhysics();
        }
        // After warmup, set view to current target to avoid initial jump
        this.updateViewTarget();
        this.viewCenterX = this.targetCenterX;
        this.viewCenterY = this.targetCenterY;
        this.viewScale = this.targetScale;
        this.warmupSteps = 0;
        // Draw once immediately to show settled state
        this.draw();
    }

    // Compute component statistics for leaderboard
    computeComponentStats() {
        const componentData = new Map();
        for (const n of this.nodes) {
            if (n.isOther) continue;
            if (n.componentId == null || n.componentSize <= 1) continue;
            if (!componentData.has(n.componentId)) {
                componentData.set(n.componentId, {
                    id: n.componentId,
                    nodes: [],
                    totalDownloadRate: 0,
                    authorContributions: new Map()
                });
            }
            const comp = componentData.get(n.componentId);
            comp.nodes.push(n);
            comp.totalDownloadRate += (n.downloadRate || 0);
            
            // Attribute download rate to each author on this mod
            const modAuthors = n.authors || [];
            if (modAuthors.length > 0) {
                const ratePerAuthor = (n.downloadRate || 0) / modAuthors.length;
                for (const a of modAuthors) {
                    const current = comp.authorContributions.get(a) || 0;
                    comp.authorContributions.set(a, current + ratePerAuthor);
                }
            }
        }

        this.componentStats = Array.from(componentData.values())
            .map(comp => {
                // Sort authors by their attributed download rate
                const rankedAuthors = Array.from(comp.authorContributions.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(entry => entry[0]);
                
                // Create title from author list (limit display length)
                let title = rankedAuthors.join(', ');
                if (title.length > 40) {
                    const truncated = rankedAuthors.slice(0, 3).join(', ');
                    const remaining = rankedAuthors.length - 3;
                    title = remaining > 0 ? `${truncated}, +${remaining} more` : truncated;
                }
                
                return {
                    id: comp.id,
                    downloadRate: comp.totalDownloadRate,
                    nodeCount: comp.nodes.length,
                    authorCount: comp.authorContributions.size,
                    hue: this.componentHue && this.componentHue.get(comp.id) || 210,
                    title: title,
                    rankedAuthors: rankedAuthors
                };
            })
            .sort((a, b) => b.downloadRate - a.downloadRate)
            .slice(0, 20);
    }

    drawLeaderboard() {
        if (!this.componentStats || this.componentStats.length === 0) return;

        const x = 10;
        const y = 10;
        const lineHeight = 18;
        const maxWidth = 250;

        this.ctx.save();
        
        // Background - light with subtle border (matching site style)
        const bgHeight = Math.min(this.componentStats.length, 20) * lineHeight + 30;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillRect(x, y, maxWidth, bgHeight);
        this.ctx.strokeStyle = '#e6e6e6';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(x, y, maxWidth, bgHeight);

        // Title - dark text, monospace
        this.ctx.fillStyle = '#222';
        this.ctx.font = 'bold 13px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText('Top Groups by Download Rate', x + 8, y + 6);

        // Entries
        this.ctx.font = '11px monospace';
        for (let i = 0; i < Math.min(this.componentStats.length, 20); i++) {
            const stat = this.componentStats[i];
            const entryY = y + 24 + i * lineHeight;

            // Color indicator with light border
            const colorSize = 10;
            this.ctx.fillStyle = `hsl(${stat.hue}, 70%, 50%)`;
            this.ctx.fillRect(x + 8, entryY + 2, colorSize, colorSize);
            this.ctx.strokeStyle = '#e6e6e6';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x + 8, entryY + 2, colorSize, colorSize);

            // Rank number - dark text
            this.ctx.fillStyle = '#222';
            const rank = `${i + 1}.`;
            this.ctx.fillText(rank, x + 22, entryY + 1);
            
            // Author title - primary text
            this.ctx.fillStyle = '#222';
            const titleText = stat.title || 'Unknown';
            const maxTitleWidth = maxWidth - 48;
            const measured = this.ctx.measureText(titleText);
            if (measured.width > maxTitleWidth) {
                // Truncate if too long
                let truncated = titleText;
                while (this.ctx.measureText(truncated + '...').width > maxTitleWidth && truncated.length > 0) {
                    truncated = truncated.slice(0, -1);
                }
                this.ctx.fillText(truncated + '...', x + 38, entryY + 1);
            } else {
                this.ctx.fillText(titleText, x + 38, entryY + 1);
            }
        }

        this.ctx.restore();
    }

    // Apply gentle cohesion force to keep groups together without hard snapping
    // Now: attract nodes toward the largest element (leader) of their component
    applyGroupCohesion() {
        const componentNodes = new Map();

        // Build component node lists
        for (const n of this.nodes) {
            if (n.isOther) continue;
            if (n.componentId == null || n.componentSize <= 1) continue;
            if (!componentNodes.has(n.componentId)) {
                componentNodes.set(n.componentId, []);
            }
            componentNodes.get(n.componentId).push(n);
        }

        // For each component, choose the leader (largest node) and attract others toward it
        for (const [compId, nodes] of componentNodes) {
            if (!nodes || nodes.length <= 1) continue;

            // Find the leader (largest by radius)
            let leader = nodes[0];
            for (const n of nodes) {
                if ((n.radius || 0) > (leader.radius || 0)) leader = n;
            }

            // average radius for scaling; use geometric scaling for spacing
            const avgRadius = nodes.reduce((sum, n) => sum + n.radius, 0) / nodes.length;
            const componentSize = nodes.length;

            // A base target ring around leader to arrange nodes
            const baseTargetRadius = leader.radius + Math.max(1, avgRadius * Math.sqrt(componentSize - 1) * 0.6);

            // Strength parameters (tweak for nice-looking motion)
            const cohesionStrength = 0.08; // pull nodes toward the leader target ring
            const boundaryStrength = 0.25; // push outward when too close to leader
            const leaderReaction = 0.08; // small reaction velocity applied to leader for conservation

            // Precompute leader position to avoid self-affecting updates while iterating
            const lx = leader.x, ly = leader.y;

            for (const n of nodes) {
                if (n === leader) continue; // skip the leader

                const dx = n.x - lx;
                const dy = n.y - ly;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                const nx = dx / dist;
                const ny = dy / dist;

                // Target distance depends on both leader radius and relative node size
                const sizeFactor = (n.radius || avgRadius) / Math.max(1, leader.radius || 1);
                const targetRadius = baseTargetRadius * (0.75 + 0.5 * sizeFactor);

                // Spring force to pull nodes toward target ring around leader
                const distError = dist - targetRadius;
                let force = distError * cohesionStrength;

                // Long-range multiplier if node is very far from leader
                if (distError > 0 && typeof this.groupCohesionLongRangeThreshold === 'number' && this.groupCohesionLongRangeThreshold > 0) {
                    const t = Math.max(0.00001, targetRadius);
                    const thr = this.groupCohesionLongRangeThreshold * t; // absolute distance threshold
                    if (dist > thr) {
                        const extraUnits = (dist / t) - this.groupCohesionLongRangeThreshold;
                        let mult = 1 + (extraUnits * (this.groupCohesionLongRangeMultiplier || 1.0));
                        const maxMult = this.groupCohesionLongRangeMaxMultiplier || 6.0;
                        mult = Math.max(1, Math.min(maxMult, mult));
                        force *= mult;
                    }
                }

                // Apply force to the node (pull toward leader if distError > 0, otherwise push outward)
                n.vx -= nx * force;
                n.vy -= ny * force;

                // Moderate outward push if node is too close to leader
                const minContact = leader.radius + n.radius + 6; // pad to keep readable gap
                if (dist < minContact) {
                    const pushRatio = 1 - (dist / minContact);
                    const pushForce = pushRatio * boundaryStrength * 2;
                    n.vx += nx * pushForce;
                    n.vy += ny * pushForce;
                }

                // Optional light separation if node overlaps other nodes in same component
                // This is handled elsewhere, but keep a small soft push for visual spacing
                if (dist < n.radius + leader.radius + 2) {
                    const smallPush = 0.02;
                    n.vx += nx * smallPush;
                    n.vy += ny * smallPush;
                }

                // Apply small reaction on leader to conserve momentum (damped)
                leader.vx += nx * force * leaderReaction;
                leader.vy += ny * force * leaderReaction;
            }
        }
    }

    // Dynamically scale bubble radii based on canvas size and data distribution
    updateRadiusScale() {
        if (!this.nodes || this.nodes.length === 0) return;

        // Calculate total area budget (as fraction of canvas)
        const totalCanvasArea = this.width * this.height;
        const budgetFraction = 0.1; // Use 10% of canvas for bubbles (allows proper scaling with overlap)
        const availableArea = totalCanvasArea * budgetFraction;

        // Sum of all download rates to determine area scaling
        const totalDownloadRate = this.nodes.reduce((sum, n) => sum + (n.downloadRate || 0), 0);
        
        if (totalDownloadRate === 0) {
            // Fallback: equal size
            const r = Math.sqrt(availableArea / (this.nodes.length * Math.PI));
            for (const node of this.nodes) {
                node.radius = r;
            }
            return;
        }

        // Calculate a constant scale factor: areaScaleFactor
        // Each node gets: radius = sqrt((downloadRate × areaScaleFactor) / π)
        // We want: sum of all node areas = availableArea
        // Sum of areas = π × sum(radius²) = π × sum((downloadRate × areaScaleFactor) / π)
        //              = areaScaleFactor × totalDownloadRate
        // So: areaScaleFactor = availableArea / totalDownloadRate
        const areaScaleFactor = availableArea / totalDownloadRate;

        // Apply constant scale factor to all nodes
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const rate = node.downloadRate || 0;
            const nodeArea = rate * areaScaleFactor;
            node.radius = Math.sqrt(nodeArea / Math.PI);
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // Draw connections (optional, maybe too messy?)
        // Let's skip connections for now to keep it clean as requested "bubble chart"

        // Draw Nodes (largest last so big mods stay visible)
        const nodesToDraw = [...this.nodes].sort((a, b) => {
            if (a.isOther && !b.isOther) return -1; // draw 'Other' earlier
            if (b.isOther && !a.isOther) return 1;
            return a.radius - b.radius; // small first, big last
        });

        const hasHoverHighlight = this.highlightComponentId != null;
        const hoverOther = !!(this.hoverNode && this.hoverNode.isOther);
        const searchActive = !hasHoverHighlight && this.searchTermLower && this.searchTermLower.length > 0;

        // Always render component hull wraps under nodes
        const componentIds = new Set();
        for (const n of this.nodes) {
            if (n.isOther) continue;
            if (n.componentId != null && n.componentSize > 1) componentIds.add(n.componentId);
        }
        for (const id of componentIds) {
            const isHoverComp = hasHoverHighlight && id === this.highlightComponentId && !hoverOther;
            const pad = isHoverComp ? 14 : 8;
            const hull = this.computeComponentHull(id, pad);
            if (hull && hull.length >= 3) this.drawComponentHull(hull, id, isHoverComp ? 0.14 : 0.08, isHoverComp ? 2.5 : 1.8);
        }

        nodesToDraw.forEach(node => {
            // First apply auto-framing (world -> framed view)
            const framedX = (node.x - this.viewCenterX) * this.viewScale;
            const framedY = (node.y - this.viewCenterY) * this.viewScale;
            const framedR = node.radius * this.viewScale;
            
            // Then apply user pan/zoom on top (framed view -> screen)
            const screenX = (framedX - this.userPanX) * this.userZoom + this.width / 2;
            const screenY = (framedY - this.userPanY) * this.userZoom + this.height / 2;
            const screenR = Math.max(1, framedR * this.userZoom);

            // Highlight nodes that have the same exact author set as hoverNode
            let isHighlight = false;
            let isDimmed = false;
            if (hasHoverHighlight) {
                isHighlight = !node.isOther && node.componentId === this.highlightComponentId;
                isDimmed = !isHighlight;
            } else if (hoverOther) {
                isHighlight = node.isOther;
                isDimmed = false;
            } else if (searchActive) {
                if (node.isOther) {
                    // Check if any mod in Other matches the search
                    const otherMatchesSearch = this.otherMods && this.otherMods.some(m => 
                        (m.name && m.name.toLowerCase().includes(this.searchTermLower)) ||
                        ((m.authors || []).some(a => a.toLowerCase().includes(this.searchTermLower)))
                    );
                    isHighlight = otherMatchesSearch;
                    isDimmed = !isHighlight;
                } else {
                    const matchesSearch = (
                        (node.name && node.name.toLowerCase().includes(this.searchTermLower)) ||
                        ((node.authors || []).some(a => a.toLowerCase().includes(this.searchTermLower)))
                    );
                    isHighlight = matchesSearch;
                    isDimmed = !isHighlight;
                }
            }
            if (isDimmed) this.ctx.globalAlpha = 0.35; else this.ctx.globalAlpha = 1.0;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, screenR, 0, Math.PI * 2);
            this.ctx.fillStyle = node.color;
            this.ctx.fill();
            this.ctx.strokeStyle = isHighlight ? '#ffd34d' : 'white';
            this.ctx.lineWidth = isHighlight ? 2.5 : 1;
            this.ctx.stroke();
            this.ctx.globalAlpha = 1.0;

            // Labels
            if (this.showLabels && !isDimmed) {
                // Calculate maximum font size that fits within circle bounds
                const padding = 4; // pixels of padding inside circle
                const maxTextHeight = (screenR * 2) - (padding * 2);
                
                // Start with comfortable font size of 12px minimum
                let baseFontSize = Math.max(12, screenR * 0.35);
                let subFontSize = baseFontSize * 0.8;
                
                // Try to fit with subtitle first
                let includeSubtitle = true;
                const spacing = baseFontSize * 0.4;
                let totalHeight = baseFontSize + spacing + subFontSize;
                
                // If subtitle doesn't fit, try title only (centered)
                if (totalHeight > maxTextHeight) {
                    includeSubtitle = false;
                    totalHeight = baseFontSize;
                    
                    // If title alone still doesn't fit, scale down
                    if (totalHeight > maxTextHeight) {
                        const scale = maxTextHeight / totalHeight;
                        baseFontSize *= scale;
                        subFontSize *= scale;
                    }
                } else if (totalHeight > maxTextHeight) {
                    // Both don't fit, scale everything down proportionally
                    const scale = maxTextHeight / totalHeight;
                    baseFontSize *= scale;
                    subFontSize *= scale;
                }
                
                // Only render if text height is at least 8 pixels
                if (baseFontSize >= 8) {
                    this.ctx.fillStyle = 'white';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    
                    // Calculate positions based on whether we're showing subtitle
                    let titleY, subY, titleMaxWidth, subMaxWidth;
                    const innerRadius = screenR - padding;
                    
                    if (includeSubtitle) {
                        const finalSpacing = baseFontSize * 0.4;
                        titleY = screenY - finalSpacing * 0.5;
                        subY = screenY + finalSpacing * 0.5 + subFontSize * 0.3;
                        
                        const titleOffsetY = Math.abs(titleY - screenY);
                        const subOffsetY = Math.abs(subY - screenY);
                        
                        titleMaxWidth = 2 * Math.sqrt(Math.max(0, innerRadius * innerRadius - titleOffsetY * titleOffsetY));
                        subMaxWidth = 2 * Math.sqrt(Math.max(0, innerRadius * innerRadius - subOffsetY * subOffsetY));
                    } else {
                        // Title centered, no subtitle
                        titleY = screenY;
                        titleMaxWidth = 2 * innerRadius; // Full width at center
                    }
                    
                    // Always remove "Create" prefix first (including "Create :" with space before colon)
                    let name = node.name;
                    const createPrefixMatch = name.match(/^Create\s*(:|\s)/i);
                    if (createPrefixMatch) {
                        const nameWithoutPrefix = name.substring(createPrefixMatch[0].length).trim();
                        if (nameWithoutPrefix.length > 0) {
                            name = nameWithoutPrefix;
                        }
                    }
                    
                    // Track if any truncation occurred
                    let nameTruncated = false;
                    
                    // Measure text and scale font if needed (prefer scaling over truncation)
                    this.ctx.font = `bold ${baseFontSize}px Arial`;
                    let textWidth = this.ctx.measureText(name).width;
                    
                    // If text doesn't fit, scale font down to fit
                    if (textWidth > titleMaxWidth) {
                        const scaleFactor = titleMaxWidth / textWidth;
                        baseFontSize *= scaleFactor;
                        
                        // Don't go below 4px font size
                        if (baseFontSize < 4) {
                            baseFontSize = 4;
                            this.ctx.font = `bold ${baseFontSize}px Arial`;
                            textWidth = this.ctx.measureText(name).width;
                            
                            // Only truncate if still doesn't fit at minimum font size
                            if (textWidth > titleMaxWidth) {
                                nameTruncated = true;
                                const ellipsis = '...';
                                const ellipsisWidth = this.ctx.measureText(ellipsis).width;
                                
                                // Binary search for optimal length
                                let left = 0;
                                let right = name.length;
                                let bestFit = '';
                                
                                while (left <= right) {
                                    const mid = Math.floor((left + right) / 2);
                                    const testStr = name.substring(0, mid);
                                    const testWidth = this.ctx.measureText(testStr).width + ellipsisWidth;
                                    
                                    if (testWidth <= titleMaxWidth) {
                                        bestFit = testStr;
                                        left = mid + 1;
                                    } else {
                                        right = mid - 1;
                                    }
                                }
                                
                                // Don't render if less than 4 original characters (7 total with "...")
                                if (bestFit.length < 4) {
                                    return; // Skip rendering this label entirely
                                }
                                
                                name = bestFit + ellipsis;
                            }
                        } else {
                            this.ctx.font = `bold ${baseFontSize}px Arial`;
                        }
                    }
                    
                    // Render title
                    this.ctx.fillText(name, screenX, titleY);
                    
                    // Render subtitle only if we have space AND no truncation occurred
                    if (includeSubtitle && !nameTruncated) {
                        this.ctx.font = `${subFontSize}px Arial`;
                        let sub = node.isOther ? `${node.count} mods` : `${Math.round(node.downloadRate)}/day`;
                        
                        // Check if subtitle would be truncated
                        let subWidth = this.ctx.measureText(sub).width;
                        if (subWidth > subMaxWidth) {
                            // Hide subtitle if it would need truncation
                            includeSubtitle = false;
                        } else {
                            // Render subtitle only if it fits without truncation
                            this.ctx.fillText(sub, screenX, subY);
                        }
                    }
                }
            }
        });

        // Draw leaderboard
        this.drawLeaderboard();
    }

    // Compute convex hull around sampled screen-space bubble perimeters for a component
    computeComponentHull(componentId, padPx = 12) {
        if (componentId == null) return null;
        const samples = [];
        const K = 12; // points per bubble
        for (const n of this.nodes) {
            if (n.isOther) continue;
            if (n.componentId !== componentId) continue;
            // First apply auto-framing
            const framedX = (n.x - this.viewCenterX) * this.viewScale;
            const framedY = (n.y - this.viewCenterY) * this.viewScale;
            const framedR = n.radius * this.viewScale;
            // Then apply user pan/zoom
            const cx = (framedX - this.userPanX) * this.userZoom + this.width / 2;
            const cy = (framedY - this.userPanY) * this.userZoom + this.height / 2;
            const r = Math.max(1, framedR * this.userZoom) + padPx;
            for (let i = 0; i < K; i++) {
                const a = (i / K) * Math.PI * 2;
                samples.push({
                    x: cx + Math.cos(a) * r,
                    y: cy + Math.sin(a) * r
                });
            }
        }
        if (samples.length < 3) return null;
        return this.convexHull(samples);
    }

    drawComponentHull(hullPoints, componentId, fillAlpha = 0.10, lineW = 2) {
        let hue = this.componentHue && typeof this.componentHue.get === 'function' ? this.componentHue.get(componentId) : null;
        if (typeof hue !== 'number') hue = 210;
        const stroke = `hsla(${hue}, 70%, 50%, 0.6)`;
        const fill = `hsla(${hue}, 70%, 40%, ${fillAlpha})`;

        // Smooth the hull edges using Chaikin's corner cutting (1 iteration)
        const smoothed = this.smoothClosed(hullPoints, 1);

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            this.ctx.lineTo(smoothed[i].x, smoothed[i].y);
        }
        this.ctx.closePath();
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        this.ctx.fillStyle = fill;
        this.ctx.strokeStyle = stroke;
        this.ctx.lineWidth = lineW;
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
    }

    // Chaikin's corner cutting for closed polygons
    smoothClosed(points, iterations = 1) {
        let pts = points.slice();
        for (let it = 0; it < iterations; it++) {
            const res = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                const q = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
                const r = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
                res.push(q, r);
            }
            pts = res;
        }
        return pts;
    }

    // Andrew's monotone chain convex hull
    convexHull(points) {
        const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [];
        for (const p of pts) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        const upper = [];
        for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop();
        lower.pop();
        return lower.concat(upper);
    }

    animate() {
        this.updatePhysics();
        this.updateViewTarget();
        this.updateViewLerp();
        this.updateUserViewLerp();
        this.draw();
        this.animationFrame = requestAnimationFrame(this.animate);
    }
    
    updateUserViewLerp() {
        // Smooth interpolation for user pan and zoom
        this.userPanX += (this.targetUserPanX - this.userPanX) * this.userPanLerp;
        this.userPanY += (this.targetUserPanY - this.userPanY) * this.userPanLerp;
        this.userZoom += (this.targetUserZoom - this.userZoom) * this.userZoomLerp;
    }

    toggleFullscreen() {
        const container = this.canvas.parentElement;
        if (!document.fullscreenElement) {
            // Enter fullscreen
            container.requestFullscreen().catch(err => {
                console.error('Error attempting to enable fullscreen:', err);
            });
            
            // Listen for fullscreen change to trigger resize
            const onFullscreenChange = () => {
                if (document.fullscreenElement) {
                    // Entered fullscreen - ensure canvas fills container and resize
                    this.canvas.style.width = '100%';
                    this.canvas.style.height = '100%';
                    // Let resize observer recalc - also call resize for immediate effect
                    // Use a small timeout to allow layout to apply in some browsers
                    setTimeout(() => {
                        this.resize();
                        // Recalculate any derived values
                        this.updateRadiusScale();
                        this.cohesionDecay = Math.min(this.width, this.height) * 0.4;
                        this.updateViewTarget();
                    }, 50);
                } else {
                    // Exited fullscreen - clear explicit canvas style to go back to normal
                    this.canvas.style.width = '';
                    this.canvas.style.height = '';
                    // Resize back to the parent container dimensions
                    setTimeout(() => {
                        this.resize();
                    }, 50);
                    document.removeEventListener('fullscreenchange', onFullscreenChange);
                    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
                    document.removeEventListener('mozfullscreenchange', onFullscreenChange);
                }
            };
            
            document.addEventListener('fullscreenchange', onFullscreenChange);
            document.addEventListener('webkitfullscreenchange', onFullscreenChange);
            document.addEventListener('mozfullscreenchange', onFullscreenChange);
        } else {
            document.exitFullscreen();
        }
    }
    
    downloadHighRes() {
        // Create a temporary high-resolution canvas (4x current size)
        const scale = 4;
        const cssWidth = this.width;
        const cssHeight = this.height;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const newDpr = dpr * scale;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.round(cssWidth * newDpr);
        tempCanvas.height = Math.round(cssHeight * newDpr);
        const tempCtx = tempCanvas.getContext('2d');
        // Map CSS pixel drawing coordinates to high-res pixels
        if (tempCtx && typeof tempCtx.setTransform === 'function') {
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
        const nodesSnapshot = originalNodes.map(n => ({ ...n }));
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
        tempCanvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            link.download = `bubble-chart-${timestamp}.png`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        }, 'image/png');
    }

    dispose() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
        this.canvas.removeEventListener('mousedown', this.onMouseDown);
        this.canvas.removeEventListener('wheel', this.onWheel);
        window.removeEventListener('mousemove', this.onMouseMoveForPan);
        window.removeEventListener('mouseup', this.onMouseUp);
        if (this.tooltip && this.tooltip.parentElement) {
            this.tooltip.parentElement.removeChild(this.tooltip);
        }
    }
    
    toggleLabels(show) {
        this.showLabels = show;
    }
    
    // Pan and Zoom methods
    getBounds() {
        if (!this.nodes || this.nodes.length === 0) {
            return { minX: 0, maxX: this.width, minY: 0, maxY: this.height };
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
    
    clampPan() {
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
        this.targetUserPanX = Math.max(-maxPanOffsetX, Math.min(maxPanOffsetX, this.targetUserPanX));
        this.targetUserPanY = Math.max(-maxPanOffsetY, Math.min(maxPanOffsetY, this.targetUserPanY));
    }
    
    zoomIn() {
        this.targetUserZoom = Math.min(this.maxUserZoom, this.targetUserZoom * 1.2);
        this.clampPan();
    }
    
    zoomOut() {
        this.targetUserZoom = Math.max(this.minUserZoom, this.targetUserZoom / 1.2);
        this.clampPan();
    }
    
    panUp() {
        this.targetUserPanY -= 50 / (this.targetUserZoom || this.userZoom || 1);
        this.clampPan();
    }
    
    panDown() {
        this.targetUserPanY += 50 / (this.targetUserZoom || this.userZoom || 1);
        this.clampPan();
    }
    
    panLeft() {
        this.targetUserPanX -= 50 / (this.targetUserZoom || this.userZoom || 1);
        this.clampPan();
    }
    
    panRight() {
        this.targetUserPanX += 50 / (this.targetUserZoom || this.userZoom || 1);
        this.clampPan();
    }
    
    resetZoom() {
        this.targetUserZoom = 1.0;
        this.targetUserPanX = 0;
        this.targetUserPanY = 0;
    }
    
    onMouseDown(e) {
        if (e.button === 0) { // Left click
            this.isPanning = true;
            const rect = this.canvas.getBoundingClientRect();
            this.panStartX = e.clientX;
            this.panStartY = e.clientY;
            this.lastPanX = this.userPanX;
            this.lastPanY = this.userPanY;
            this.canvas.style.cursor = 'grabbing';
            
            window.addEventListener('mousemove', this.onMouseMoveForPan);
            window.addEventListener('mouseup', this.onMouseUp);
            e.preventDefault();
        }
    }
    
    onMouseMoveForPan(e) {
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
    
    onMouseUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = 'default';
            window.removeEventListener('mousemove', this.onMouseMoveForPan);
            window.removeEventListener('mouseup', this.onMouseUp);
        }
    }
    
    onWheel(e) {
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
            const framedX = (canvasX - this.width / 2) / this.targetUserZoom + this.targetUserPanX;
            const framedY = (canvasY - this.height / 2) / this.targetUserZoom + this.targetUserPanY;
            
            // Apply zoom
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(this.minUserZoom, Math.min(this.maxUserZoom, this.targetUserZoom * zoomDelta));
            
            // Adjust pan to keep mouse position fixed in framed space
            this.targetUserPanX = framedX - (canvasX - this.width / 2) / newZoom;
            this.targetUserPanY = framedY - (canvasY - this.height / 2) / newZoom;
            
            this.targetUserZoom = newZoom;
            this.clampPan();
        }
    }

    // Mouse handlers
    onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

        // Convert screen -> framed view -> world coordinates
        // First undo user pan/zoom (screen -> framed view)
        const framedX = (mouseX - this.width / 2) / this.userZoom + this.userPanX;
        const framedY = (mouseY - this.height / 2) / this.userZoom + this.userPanY;
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
            if (d2 <= (n.radius * n.radius)) {
                found = n; // later (larger) replaces earlier
            }
        }

        if (found) {
            this.hoverNode = found;
            this.highlightComponentId = found.isOther ? null : ((found.componentId != null && found.componentSize > 1) ? found.componentId : null);
            this.updateTooltip(found, mouseX, mouseY);
        } else {
            this.hoverNode = null;
            this.highlightComponentId = null;
            this.tooltip.style.display = 'none';
        }
    }

    onMouseLeave() {
        this.hoverNode = null;
        this.highlightComponentId = null;
        this.tooltip.style.display = 'none';
    }

    getAuthorKey(node) {
        const authors = (node.authors || []).slice().sort();
        return authors.join('|');
    }

    updateTooltip(node, mouseX, mouseY) {
        const rect = this.canvas.getBoundingClientRect();
        // Position tooltip relative to parent container
        const parentRect = this.canvas.parentElement.getBoundingClientRect();
        const offsetX = 12;
        const offsetY = 12;
    const pageX = rect.left + mouseX; // mouseX is already in CSS pixels relative to rect
    const pageY = rect.top + mouseY;
        const localX = pageX - parentRect.left;
        const localY = pageY - parentRect.top;

        const authorsList = (node.authors && node.authors.length) ? node.authors.join(', ') : '—';
        const rate = Math.round(node.downloadRate || 0);
        const downloads = node.downloadCount ?? '—';
        this.tooltip.innerHTML = `<strong>${this.escapeHtml(node.name)}</strong><br>` +
            `<span>Authors: ${this.escapeHtml(authorsList)}</span><br>` +
            `<span>Downloads: ${downloads}</span><br>` +
            `<span>Rate: ${rate}/day</span>`;

        this.tooltip.style.left = `${localX + offsetX}px`;
        this.tooltip.style.top = `${localY + offsetY}px`;
        this.tooltip.style.display = 'block';
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
    }
}
