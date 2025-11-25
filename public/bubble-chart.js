
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
        this.topNExplicit = 100; // always show top N by downloadRate

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
        this.cohesionStrength = 0.005; // base pull between all mods
        this.cohesionDecay = 200; // distance scale for exponential pull (updated on resize)
        
        // Physics constants
        this.friction = 0.5;
        this.gravity = 0.1;
        this.collisionStrength = 0.05;
        this.attractionStrength = 0.9; // stronger author connections
        this.unrelatedRepulsion = 0.7; // soft push between nodes with no shared authors
        
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
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
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
    
    setData(data) {
        // Stop any existing animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        if (!data || !data.items) return;

        // 1. Filter and Group: explicitly take top N by downloadRate
        const sortedByRate = [...data.items].sort((a, b) => (b.downloadRate || 0) - (a.downloadRate || 0));
        const mainMods = sortedByRate.slice(0, this.topNExplicit);
        const otherMods = sortedByRate.slice(this.topNExplicit);
        const otherDownloadRate = otherMods.reduce((sum, m) => sum + (m.downloadRate || 0), 0);
        const otherCount = otherMods.length;

        // 2. Create Nodes
        const jitter = Math.min(this.width, this.height) * 0.03; // tighter initial placement near center
        this.nodes = mainMods.map(mod => ({
            id: mod.id,
            name: mod.name,
            downloadCount: mod.downloadCount,
            downloadRate: mod.downloadRate,
            authors: mod.authors || [],
            x: this.centerX + (Math.random() - 0.5) * jitter,
            y: this.centerY + (Math.random() - 0.5) * jitter,
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
                x: this.centerX + (Math.random() - 0.5) * (jitter * 0.5),
                y: this.centerY + (Math.random() - 0.5) * (jitter * 0.5),
                vx: 0,
                vy: 0,
                radius: 1, // placeholder; will be set by dynamic scaling
                color: '#cccccc',
                isOther: true,
                count: otherCount
            });
        }

        // 3. Assign Colors
        this.assignColors();

        // Store search term for highlight-only behavior
        this.searchTermLower = (data.searchTerm || '').toLowerCase();

        // 4. Dynamic radius scaling (fit to canvas and count)
        this.updateRadiusScale();

        // 5. Compute component stats for leaderboard
        this.computeComponentStats();

        // 6. Fast warm-up: run physics steps synchronously before first draw
        this.runWarmup(this.warmupStepsDefault);

        // 7. Start Animation
        this.animate();
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

        for (let i = 0; i < len; i++) {
            const node = nodes[i];

            // Center Gravity
            const dx = this.centerX - node.x;
            const dy = this.centerY - node.y;
            node.vx += dx * this.gravity * 0.01;
            node.vy += dy * this.gravity * 0.01;

            // Drag/Friction
            node.vx *= this.friction;
            node.vy *= this.friction;

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

                // Collision
                const minDist = n1.radius + n2.radius + 2; // +2 padding
                if (dist < minDist) {
                    // Positional correction to resolve overlap
                    const overlap = (minDist - dist);
                    const correction = overlap * 0.5;
                    n1.x -= nx * correction;
                    n1.y -= ny * correction;
                    n2.x += nx * correction;
                    n2.y += ny * correction;

                    // Dampen relative velocity along normal to prevent jitter
                    const rvx = n2.vx - n1.vx;
                    const rvy = n2.vy - n1.vy;
                    const relN = rvx * nx + rvy * ny;
                    if (relN < 0) {
                        const restitution = 0.2;
                        const impulse = -(1 + restitution) * relN * 0.5;
                        n1.vx -= nx * impulse;
                        n1.vy -= ny * impulse;
                        n2.vx += nx * impulse;
                        n2.vy += ny * impulse;
                    }
                }

                // Attraction (if sharing authors) or soft repulsion (if unrelated)
                if (!n1.isOther && !n2.isOther) {
                    const sharedAuthors = n1.authors.filter(a => n2.authors.includes(a));
                    if (sharedAuthors.length > 0) {
                        // Hard clamp: limit max separation to sum of radii
                        const maxLinkDist = 2 * (n1.radius + n2.radius);
                        if (dist > maxLinkDist) {
                            const excess = dist - maxLinkDist;
                            const correction = excess * 0.5;
                            n1.x += nx * correction;
                            n1.y += ny * correction;
                            n2.x -= nx * correction;
                            n2.y -= ny * correction;
                        }

                        // Distance-aware spring attraction: pull towards a rest length beyond collision
                        const rest = minDist + 6; // small gap to avoid overlap under attraction
                        if (dist > rest) {
                            let force = this.attractionStrength * sharedAuthors.length * (dist - rest) * 0.02;
                            // Cap force to avoid instability/clipping
                            force = Math.min(force, 2.0);
                            const fx = nx * force;
                            const fy = ny * force;
                            n1.vx += fx;
                            n1.vy += fy;
                            n2.vx -= fx;
                            n2.vy -= fy;
                        } else {
                            // Mild separation force when closer than rest (counter sticky overlap)
                            const repel = (rest - dist) * 0.01;
                            n1.vx -= nx * repel;
                            n1.vy -= ny * repel;
                            n2.vx += nx * repel;
                            n2.vy += ny * repel;
                        }
                    } else {
                        // Soft repulsion for unrelated nodes (no shared authors)
                        // Inverse square falloff with distance, only effective at close range
                        const repelRange = (n1.radius + n2.radius) * 2.5;
                        if (dist < repelRange) {
                            const strength = this.unrelatedRepulsion * (1 - dist / repelRange);
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
        
        // Wall constraints (optional, but good to keep them in canvas)
        // Actually, center gravity should handle this, but let's prevent flying off
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
            // Every 5 ticks, snap connected nodes to their component centroid
            if (i % 5 === 0) {
                this.snapComponentsToCentroids();
            }
            this.updatePhysics();
        }
        // Run 1 second of normal simulation (60 ticks at 60fps)
        for (let i = 0; i < 60; i++) {
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

    // Snap all nodes in each component to their centroid position
    snapComponentsToCentroids() {
        const componentNodes = new Map();
        for (const n of this.nodes) {
            if (n.isOther) continue;
            if (n.componentId == null || n.componentSize <= 1) continue;
            if (!componentNodes.has(n.componentId)) {
                componentNodes.set(n.componentId, []);
            }
            componentNodes.get(n.componentId).push(n);
        }
        
        for (const [compId, nodes] of componentNodes) {
            let sumX = 0, sumY = 0;
            for (const n of nodes) {
                sumX += n.x;
                sumY += n.y;
            }
            const cx = sumX / nodes.length;
            const cy = sumY / nodes.length;
            for (const n of nodes) {
                n.x = cx;
                n.y = cy;
            }
        }
    }

    // Dynamically scale bubble radii based on canvas size and data distribution
    updateRadiusScale() {
        if (!this.nodes || this.nodes.length === 0) return;

        // Calculate total area budget (as fraction of canvas)
        const totalCanvasArea = this.width * this.height;
        const budgetFraction = 0.3; // Use 50% of canvas for bubbles (allows proper scaling with overlap)
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
            if (this.showLabels) {
                // Only show label if bubble is big enough or if it's the "Other" bubble
                if ((screenR > 12 || node.isOther) && !isDimmed) {
                    this.ctx.fillStyle = 'white';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    
                    // Scale font size with bubble radius (allow smaller text)
                    const baseFontSize = Math.max(6, Math.min(16, screenR * 0.35));
                    const subFontSize = Math.max(5, baseFontSize * 0.8);
                    
                    // Name
                    this.ctx.font = `bold ${baseFontSize}px Arial`;
                    let name = node.name;
                    
                    // Adaptive truncation based on radius (more generous character limit)
                    const maxChars = Math.floor(screenR / 3);
                    if (name.length > maxChars) {
                        // Try removing "Create" prefix before truncating
                        const createPrefixMatch = name.match(/^Create(:|\s)/i);
                        let nameWithoutPrefix = name;
                        if (createPrefixMatch) {
                            nameWithoutPrefix = name.substring(createPrefixMatch[0].length).trim();
                        }
                        
                        // Only use the name without prefix if it's not empty
                        if (nameWithoutPrefix.length > 0 && nameWithoutPrefix.length <= maxChars) {
                            name = nameWithoutPrefix;
                        } else if (nameWithoutPrefix.length > 0) {
                            // Still need to truncate even after removing prefix
                            name = nameWithoutPrefix.substring(0, Math.max(3, maxChars - 3)) + '...';
                        } else {
                            // Name is empty after removing prefix, use original truncation
                            name = name.substring(0, Math.max(3, maxChars - 3)) + '...';
                        }
                    }
                    
                    // Only show subtitle if bubble is large enough
                    if (screenR > 20) {
                        this.ctx.fillText(name, screenX, screenY - baseFontSize * 0.4);
                        this.ctx.font = `${subFontSize}px Arial`;
                        let sub = node.isOther ? `${node.count} mods` : `${Math.round(node.downloadRate)}/day`;
                        this.ctx.fillText(sub, screenX, screenY + subFontSize * 0.5);
                    } else {
                        // Just name for smaller bubbles
                        this.ctx.fillText(name, screenX, screenY);
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
        this.targetUserPanY -= 50 / this.userZoom;
        this.clampPan();
    }
    
    panDown() {
        this.targetUserPanY += 50 / this.userZoom;
        this.clampPan();
    }
    
    panLeft() {
        this.targetUserPanX -= 50 / this.userZoom;
        this.clampPan();
    }
    
    panRight() {
        this.targetUserPanX += 50 / this.userZoom;
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
            
            // Pan in framed space (screen pixels directly)
            // Direct manipulation - no smoothing during drag for responsive feel
            this.targetUserPanX = this.lastPanX - dx;
            this.targetUserPanY = this.lastPanY - dy;
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
            const panSensitivity = 1.0;
            this.targetUserPanX += e.deltaX * panSensitivity;
            this.targetUserPanY += e.deltaY * panSensitivity;
            this.clampPan();
        } else {
            // Zoom mode - pinch zoom or ctrl+scroll
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Convert mouse position to canvas coordinates
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
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
        if (this.isPanning) return; // Don't update hover during pan
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
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
        const pageX = rect.left + (mouseX * (rect.width / this.canvas.width));
        const pageY = rect.top + (mouseY * (rect.height / this.canvas.height));
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
