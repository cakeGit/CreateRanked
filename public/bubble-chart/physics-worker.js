// physics-worker.js
// Background worker for bubble chart physics simulation

// Small helper for computing gravity strength from a radial factor
function computeGlobalGravityStrength(config, radialFactor, dist, maxDist) {
    let gStrength = config.globalGravityStrength * radialFactor;
    if (typeof config.globalGravityEdgeStart === "number" && config.globalGravityEdgeStart > 0) {
        const edgeStart = Math.max(0, Math.min(1, config.globalGravityEdgeStart)) * Math.max(1, maxDist);
        if (dist > edgeStart) {
            const extra = (dist - edgeStart) / Math.max(1, maxDist - edgeStart);
            gStrength *= 1 + extra * config.globalGravityEdgeBoostFactor;
        }
    }
    return gStrength;
}

// Apply gentle cohesion force to keep groups together without hard snapping
function applyGroupCohesion(nodes, config) {
    const componentNodes = new Map();

    for (const n of nodes) {
        if (n.isOther) continue;
        if (n.componentId == null || n.componentSize <= 1) continue;
        if (!componentNodes.has(n.componentId)) componentNodes.set(n.componentId, []);
        componentNodes.get(n.componentId).push(n);
    }

    for (const [compId, compNodes] of componentNodes) {
        if (!compNodes || compNodes.length <= 1) continue;

        let leader = compNodes[0];
        for (const n of compNodes) {
            if ((n.radius || 0) > (leader.radius || 0)) leader = n;
        }

        const avgRadius = compNodes.reduce((sum, n) => sum + n.radius, 0) / compNodes.length;
        const componentSize = compNodes.length;
        const baseTargetRadius = leader.radius + Math.max(1, avgRadius * Math.sqrt(componentSize - 1) * 0.6);

        const cohesionStrength = 0.08;
        const boundaryStrength = 0.25;
        const leaderReaction = 0.08;

        const lx = leader.x, ly = leader.y;

        for (const n of compNodes) {
            if (n === leader) continue;

            const dx = n.x - lx;
            const dy = n.y - ly;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
            const nx = dx / dist;
            const ny = dy / dist;

            const sizeFactor = (n.radius || avgRadius) / Math.max(1, leader.radius || 1);
            const targetRadius = baseTargetRadius * (0.75 + 0.5 * sizeFactor);

            const distError = dist - targetRadius;
            let force = distError * cohesionStrength;

            if (distError > 0 && typeof config.groupCohesionLongRangeThreshold === "number" && config.groupCohesionLongRangeThreshold > 0) {
                const t = Math.max(0.00001, targetRadius);
                const thr = config.groupCohesionLongRangeThreshold * t;
                if (dist > thr) {
                    const extraUnits = dist / t - config.groupCohesionLongRangeThreshold;
                    let mult = 1 + extraUnits * (config.groupCohesionLongRangeMultiplier || 1.0);
                    const maxMult = config.groupCohesionLongRangeMaxMultiplier || 6.0;
                    mult = Math.max(1, Math.min(maxMult, mult));
                    force *= mult;
                }
            }

            n.vx -= nx * force;
            n.vy -= ny * force;

            const minContact = leader.radius + n.radius + 6;
            if (dist < minContact) {
                const pushRatio = 1 - dist / minContact;
                const pushForce = pushRatio * boundaryStrength * 2;
                n.vx += nx * pushForce;
                n.vy += ny * pushForce;
            }

            if (dist < n.radius + leader.radius + 2) {
                const smallPush = 0.02;
                n.vx += nx * smallPush;
                n.vy += ny * smallPush;
            }

            leader.vx += nx * force * leaderReaction;
            leader.vy += ny * force * leaderReaction;
        }
    }
}

function updatePhysics(nodes, config) {
    const len = nodes.length;
    let maxDist = 0;
    if (len > 0) {
        for (let i = 0; i < len; i++) {
            const n = nodes[i];
            const dx = config.centerX - n.x;
            const dy = config.centerY - n.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0;
            if (d > maxDist) maxDist = d;
        }
    }
    if (maxDist <= 0) maxDist = 1;

    for (let i = 0; i < len; i++) {
        const node = nodes[i];

        if (config.neighborGravityStrength > 0 && config.neighborGravityCount > 0) {
            const neighbors = [];
            for (let j = 0; j < len; j++) {
                if (j === i) continue;
                const other = nodes[j];
                if (!other || other.isOther) continue;
                const dxn = other.x - node.x;
                const dyn = other.y - node.y;
                const d2 = dxn * dxn + dyn * dyn;
                neighbors.push({ idx: j, d2, x: other.x, y: other.y, vx: other.vx, vy: other.vy });
            }
            if (neighbors.length > 0) {
                neighbors.sort((a, b) => a.d2 - b.d2);
                const k = Math.min(config.neighborGravityCount, neighbors.length);
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

                let spring = config.neighborGravityStrength * Math.min(1, dist / Math.max(1, config.cohesionDecay));
                let dvx = nx * spring;
                let dvy = ny * spring;

                const rvx = (avx - node.vx) * config.neighborGravityDamping;
                const rvy = (avy - node.vy) * config.neighborGravityDamping;
                dvx += rvx;
                dvy += rvy;

                const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
                dvx = clamp(dvx, config.neighborGravityMaxDelta);
                dvy = clamp(dvy, config.neighborGravityMaxDelta);

                node.vx += dvx;
                node.vy += dvy;
            }
        }

        if (config.globalGravityStrength > 0) {
            const dx = config.centerX - node.x;
            const dy = config.centerY - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            let radialFactor = Math.min(1, Math.max(0, dist / maxDist));
            let gStrength = computeGlobalGravityStrength(config, radialFactor, dist, maxDist);
            const sizeScale = 1 / Math.max(1, Math.sqrt(node.componentSize || 1));
            gStrength *= sizeScale;
            let gvx = (dx / dist) * gStrength;
            let gvy = (dy / dist) * gStrength;
            const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
            gvx = clamp(gvx, config.globalGravityMaxDelta);
            gvy = clamp(gvy, config.globalGravityMaxDelta);
            node.vx += gvx;
            node.vy += gvy;
        }

        const frictionMultiplier = node.componentSize && node.componentSize > 5 ? 0.75 : 0.88;
        node.vx *= config.friction * frictionMultiplier;
        node.vy *= config.friction * frictionMultiplier;

        node.x += node.vx;
        node.y += node.vy;

        if (node.x < node.radius) { node.x = node.radius; node.vx *= -0.5; }
        else if (node.x > config.width - node.radius) { node.x = config.width - node.radius; node.vx *= -0.5; }
        if (node.y < node.radius) { node.y = node.radius; node.vy *= -0.5; }
        else if (node.y > config.height - node.radius) { node.y = config.height - node.radius; node.vy *= -0.5; }

        if (node.x === node.radius || node.x === config.width - node.radius || node.y === node.radius || node.y === config.height - node.radius) {
            node.vx += (config.centerX - node.x) * 0.002;
            node.vy += (config.centerY - node.y) * 0.002;
        }
    }

    applyGroupCohesion(nodes, config);

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

            const minDist = n1.radius + n2.radius + 5;
            if (dist < minDist) {
                const overlap = minDist - dist;
                const correction = overlap * 0.5 * config.collisionStrength;
                n1.x -= nx * correction;
                n1.y -= ny * correction;
                n2.x += nx * correction;
                n2.y += ny * correction;
            }

            if (!n1.isOther && !n2.isOther) {
                let sharedAuthorsCount = 0;
                if (n1.authors && n2.authors) {
                   for (let a1 of n1.authors) {
                       if (n2.authors.includes(a1)) {
                           sharedAuthorsCount++;
                       }
                   }
                }

                if (sharedAuthorsCount > 0) {
                    const sameComponent = n1.componentId != null && n1.componentId === n2.componentId && (n1.componentSize || 0) > 2;
                    if (!sameComponent) {
                        const componentSize = Math.max(n1.componentSize || 1, n2.componentSize || 1);
                        const sizeScale = 1 / componentSize;
                        const maxLinkDist = 2 * (n1.radius + n2.radius);
                        
                        if (dist > maxLinkDist) {
                            const excess = dist - maxLinkDist;
                            const correction = excess * 0.5 * sizeScale;
                            n1.x += nx * correction; n1.y += ny * correction;
                            n2.x -= nx * correction; n2.y -= ny * correction;
                        }

                        const rest = minDist + 6;
                        if (dist > rest) {
                            let force = config.attractionStrength * sharedAuthorsCount * (dist - rest) * 0.02 * sizeScale;
                            force = Math.min(force, 2.0);
                            const fx = nx * force; const fy = ny * force;
                            n1.vx += fx; n1.vy += fy;
                            n2.vx -= fx; n2.vy -= fy;
                        } else {
                            const repel = (rest - dist) * 0.01;
                            n1.vx -= nx * repel; n1.vy -= ny * repel;
                            n2.vx += nx * repel; n2.vy += ny * repel;
                        }
                    }
                } else {
                    const repelRange = (n1.radius + n2.radius) * 4.0;
                    if (dist < repelRange) {
                        const distRatio = 1 - dist / repelRange;
                        const strength = config.unrelatedRepulsion * distRatio * distRatio;
                        const fx = -nx * strength; const fy = -ny * strength;
                        n1.vx += fx; n1.vy += fy;
                        n2.vx -= fx; n2.vy -= fy;
                    }
                }
            }

            if (dist > 1) {
                const expPull = 1 - Math.exp(-dist / config.cohesionDecay);
                const cForce = config.cohesionStrength * expPull;
                const cfx = (dx / dist) * cForce; const cfy = (dy / dist) * cForce;
                n1.vx += cfx; n1.vy += cfy;
                n2.vx -= cfx; n2.vy -= cfy;
            }
        }
    }
}

self.onmessage = function(e) {
    const { nodes, config, steps } = e.data;
    if (!nodes || !config) return;
    
    // Run physics for specified number of steps (usually 1, but warmup might send more)
    const iterations = steps || 1;
    for (let i = 0; i < iterations; i++) {
        updatePhysics(nodes, config);
    }
    
    // Post back the updated nodes.
    // Instead of transferable, we just serialize because object nodes might have arbitrary data. 
    // They are relatively small so serialization is fast.
    self.postMessage({ nodes });
};