
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

        const minDim = Math.min(this.width, this.height) || 1;
        const count = this.nodes.length;

        // Max radius is a fraction of canvas size and decreases with node count
        const baseMax = minDim * 0.08; // 8% of the smaller dimension
        const countFactor = 1 + Math.log10(count + 1);
        const maxRadius = Math.max(this.minBubblePx * 2, baseMax / countFactor);
        const minRadius = Math.max(this.minBubblePx, maxRadius * 0.25);

        // Use sqrt of downloadRate as raw magnitude
        const rawVals = this.nodes.map(n => Math.sqrt(Math.max(0, n.downloadRate || 0)));
        const minRaw = Math.min(...rawVals);
        const maxRaw = Math.max(...rawVals);
        const denom = (maxRaw - minRaw) || 1;

        // Map raw values to [minRadius, maxRadius] with easing to compress extremes
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const raw = Math.sqrt(Math.max(0, node.downloadRate || 0));
            const t = (raw - minRaw) / denom;
            const eased = Math.sqrt(Math.max(0, Math.min(1, t))); // ease to reduce giant bubbles
            node.radius = minRadius + eased * (maxRadius - minRadius);
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
            const screenX = (node.x - this.viewCenterX) * this.viewScale + this.width / 2;
            const screenY = (node.y - this.viewCenterY) * this.viewScale + this.height / 2;
            const screenR = Math.max(1, node.radius * this.viewScale);

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
                const matchesSearch = (
                    (node.name && node.name.toLowerCase().includes(this.searchTermLower)) ||
                    ((node.authors || []).some(a => a.toLowerCase().includes(this.searchTermLower)))
                );
                isHighlight = !node.isOther && matchesSearch;
                isDimmed = !isHighlight;
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
                if ((screenR > 15 || node.isOther) && !isDimmed) {
                    this.ctx.fillStyle = 'white';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    
                    // Name
                    this.ctx.font = 'bold 12px Arial';
                    // Truncate name if too long
                    let name = node.name;
                    if (name.length > 15 && screenR < 40) {
                        name = name.substring(0, 12) + '...';
                    }
                    this.ctx.fillText(name, screenX, screenY - 6);

                    // Subtitle
                    this.ctx.font = '10px Arial';
                    let sub = node.isOther ? `${node.count} mods` : `${Math.round(node.downloadRate)}/day`;
                    this.ctx.fillText(sub, screenX, screenY + 6);
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
            const cx = (n.x - this.viewCenterX) * this.viewScale + this.width / 2;
            const cy = (n.y - this.viewCenterY) * this.viewScale + this.height / 2;
            const r = Math.max(1, n.radius * this.viewScale) + padPx;
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
        this.draw();
        this.animationFrame = requestAnimationFrame(this.animate);
    }

    dispose() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
        if (this.tooltip && this.tooltip.parentElement) {
            this.tooltip.parentElement.removeChild(this.tooltip);
        }
    }
    
    toggleLabels(show) {
        this.showLabels = show;
    }

    // Mouse handlers
    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        // Convert to world coordinates
        const worldX = (mouseX - this.width / 2) / this.viewScale + this.viewCenterX;
        const worldY = (mouseY - this.height / 2) / this.viewScale + this.viewCenterY;

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
