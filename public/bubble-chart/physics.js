export function updatePhysics() {
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

        if (
            this.neighborGravityStrength > 0 &&
            this.neighborGravityCount > 0
        ) {
            const neighbors = [];
            for (let j = 0; j < len; j++) {
                if (j === i) continue;
                const other = nodes[j];
                // Skip the aggregated 'Other' node when finding local neighbors
                if (!other || other.isOther) continue;
                const dxn = other.x - node.x;
                const dyn = other.y - node.y;
                const d2 = dxn * dxn + dyn * dyn;
                neighbors.push({
                    idx: j,
                    d2,
                    x: other.x,
                    y: other.y,
                    vx: other.vx,
                    vy: other.vy,
                });
            }
            if (neighbors.length > 0) {
                neighbors.sort((a, b) => a.d2 - b.d2);
                const k = Math.min(
                    this.neighborGravityCount,
                    neighbors.length
                );
                let cx = 0,
                    cy = 0,
                    avx = 0,
                    avy = 0;
                for (let m = 0; m < k; m++) {
                    const nb = neighbors[m];
                    cx += nb.x;
                    cy += nb.y;
                    avx += nb.vx || 0;
                    avy += nb.vy || 0;
                }
                cx /= k;
                cy /= k;
                avx /= k;
                avy /= k;

                const dxn = cx - node.x;
                const dyn = cy - node.y;
                const dist = Math.sqrt(dxn * dxn + dyn * dyn) || 1;
                const nx = dxn / dist;
                const ny = dyn / dist;

                // Spring force toward centroid, scaled by distance relative to cohesion decay
                let spring =
                    this.neighborGravityStrength *
                    Math.min(1, dist / Math.max(1, this.cohesionDecay));

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
            const cx = this.centerX,
                cy = this.centerY;
            const dx = cx - node.x;
            const dy = cy - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            // Linear gradient gravity: scale by distance relative to max node distance
            // strength ranges from 0 (center) to 1 (outermost node)
            let radialFactor = Math.min(1, Math.max(0, dist / maxDist));
            let gStrength = this.computeGlobalGravityStrength(
                radialFactor,
                dist,
                maxDist
            );
            // Edge boost handled in computeGlobalGravityStrength; no further per-node edge adjustment required here
            // increase gravity effect for larger components to prevent center pull
            const sizeScale =
                1 / Math.max(1, Math.sqrt(node.componentSize || 1));
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
        const frictionMultiplier =
            node.componentSize && node.componentSize > 5 ? 0.75 : 0.88;
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
        if (
            node.x === node.radius ||
            node.x === this.width - node.radius ||
            node.y === node.radius ||
            node.y === this.height - node.radius
        ) {
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
                const overlap = minDist - dist;
                const correction = overlap * 0.5 * this.collisionStrength;
                n1.x -= nx * correction;
                n1.y -= ny * correction;
                n2.x += nx * correction;
                n2.y += ny * correction;
            }

            // Attraction (if sharing authors) or soft repulsion (if unrelated)
            if (!n1.isOther && !n2.isOther) {
                const sharedAuthors = n1.authors.filter((a) =>
                    n2.authors.includes(a)
                );
                if (sharedAuthors.length > 0) {
                    // For nodes in same component, only use group-center cohesion (handled above)
                    // Skip individual connection forces to avoid fighting with group cohesion
                    const sameComponent =
                        n1.componentId != null &&
                        n1.componentId === n2.componentId &&
                        (n1.componentSize || 0) > 2;

                    if (!sameComponent) {
                        // Small groups or different components: use direct connection forces
                        const componentSize = Math.max(
                            n1.componentSize || 1,
                            n2.componentSize || 1
                        );
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
                            let force =
                                this.attractionStrength *
                                sharedAuthors.length *
                                (dist - rest) *
                                0.02 *
                                sizeScale;
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
                        const strength =
                            this.unrelatedRepulsion * distRatio * distRatio;
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
export function computeGlobalGravityStrength(radialFactor, dist, maxDist) {
    // Base strength is linear in radialFactor
    let gStrength = this.globalGravityStrength * radialFactor;
    // Optional: edge boost (treat globalGravityEdgeStart as fraction of maxDist)
    if (
        typeof this.globalGravityEdgeStart === "number" &&
        this.globalGravityEdgeStart > 0
    ) {
        const edgeStart =
            Math.max(0, Math.min(1, this.globalGravityEdgeStart)) *
            Math.max(1, maxDist);
        if (dist > edgeStart) {
            const extra =
                (dist - edgeStart) / Math.max(1, maxDist - edgeStart);
            gStrength *= 1 + extra * this.globalGravityEdgeBoostFactor;
        }
    }
    return gStrength;
}

// Apply gentle cohesion force to keep groups together without hard snapping
// Now: attract nodes toward the largest element (leader) of their component
export function applyGroupCohesion() {
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
        const avgRadius =
            nodes.reduce((sum, n) => sum + n.radius, 0) / nodes.length;
        const componentSize = nodes.length;

        // A base target ring around leader to arrange nodes
        const baseTargetRadius =
            leader.radius +
            Math.max(1, avgRadius * Math.sqrt(componentSize - 1) * 0.6);

        // Strength parameters (tweak for nice-looking motion)
        const cohesionStrength = 0.08; // pull nodes toward the leader target ring
        const boundaryStrength = 0.25; // push outward when too close to leader
        const leaderReaction = 0.08; // small reaction velocity applied to leader for conservation

        // Precompute leader position to avoid self-affecting updates while iterating
        const lx = leader.x,
            ly = leader.y;

        for (const n of nodes) {
            if (n === leader) continue; // skip the leader

            const dx = n.x - lx;
            const dy = n.y - ly;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
            const nx = dx / dist;
            const ny = dy / dist;

            // Target distance depends on both leader radius and relative node size
            const sizeFactor =
                (n.radius || avgRadius) / Math.max(1, leader.radius || 1);
            const targetRadius =
                baseTargetRadius * (0.75 + 0.5 * sizeFactor);

            // Spring force to pull nodes toward target ring around leader
            const distError = dist - targetRadius;
            let force = distError * cohesionStrength;

            // Long-range multiplier if node is very far from leader
            if (
                distError > 0 &&
                typeof this.groupCohesionLongRangeThreshold === "number" &&
                this.groupCohesionLongRangeThreshold > 0
            ) {
                const t = Math.max(0.00001, targetRadius);
                const thr = this.groupCohesionLongRangeThreshold * t; // absolute distance threshold
                if (dist > thr) {
                    const extraUnits =
                        dist / t - this.groupCohesionLongRangeThreshold;
                    let mult =
                        1 +
                        extraUnits *
                            (this.groupCohesionLongRangeMultiplier || 1.0);
                    const maxMult =
                        this.groupCohesionLongRangeMaxMultiplier || 6.0;
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
                const pushRatio = 1 - dist / minContact;
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
