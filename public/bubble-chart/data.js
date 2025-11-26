import { hashToHue } from './utils.js';

export function setSearchTerm(searchTerm) {
    // Update search term without recreating the chart
    this.searchTermLower = (searchTerm || "").toLowerCase();
}

export function setIncludeFullGroups(include) {
    // Update full groups option and rebuild if data exists
    this.includeFullGroups = include;
    if (this.rawData) {
        this.setData(this.rawData);
    }
}

export function setData(data) {
    // Stop any existing animation
    if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
    }

    if (!data || !data.items) return;

    // Store raw data for rebuilding when options change
    this.rawData = data;

    // 1. Filter and Group: explicitly take top N by downloadRate
    const sortedByRate = [...data.items].sort(
        (a, b) => (b.downloadRate || 0) - (a.downloadRate || 0)
    );
    let mainMods = sortedByRate.slice(0, this.topNExplicit);
    let otherMods = sortedByRate.slice(this.topNExplicit);

    // 2. If includeFullGroups is enabled, recursively expand groups
    if (this.includeFullGroups && otherMods.length > 0) {
        const expanded = this.expandGroups(mainMods, otherMods);
        mainMods = expanded.mainMods;
        otherMods = expanded.otherMods;
    }
    const otherDownloadRate = otherMods.reduce(
        (sum, m) => sum + (m.downloadRate || 0),
        0
    );
    const otherCount = otherMods.length;

    // 3. Create Nodes with better initial spacing
    this.nodes = mainMods.map((mod) => ({
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
        color: "hsla(210, 2%, 52%, 1.00)", // Placeholder
        isOther: false,
    }));

    // Store otherMods for search highlighting
    this.otherMods = otherMods;

    if (otherCount > 0) {
        var otherDownloadsTotal = otherMods.reduce(
            (sum, m) => sum + (m.downloadCount || 0),
            0
        );
        this.nodes.push({
            id: "other",
            name: "Other",
            downloadCount: otherDownloadsTotal, // Or sum
            downloadRate: otherDownloadRate,
            authors: [],
            x: this.centerX,
            y: this.centerY,
            vx: 0,
            vy: 0,
            radius: 1, // placeholder; will be set by dynamic scaling
            color: "#cccccc",
            isOther: true,
            count: otherCount,
        });
    }

    // 4. Assign Colors
    this.assignColors();

    // 4.5. Initialize positions based on components to start with better separation
    this.initializeComponentPositions();

    // Store search term for highlight-only behavior
    this.searchTermLower = (data.searchTerm || "").toLowerCase();

    // 5. Dynamic radius scaling (fit to canvas and count)
    this.updateRadiusScale();

    // 6. Compute component stats for leaderboard
    this.computeComponentStats();

    // 7. Fast warm-up: run physics steps synchronously before first draw
    this.runWarmup(this.warmupStepsDefault);

    // 8. Start Animation
    this.animate();
}

export function expandGroups(mainMods, otherMods) {
    // Recursively expand groups to include all connected mods from otherMods
    // that share authors with any mod in mainMods

    const included = new Set(mainMods.map((m) => m.id));
    const remaining = [...otherMods];
    let addedInLastPass = true;

    // Keep searching until no new mods are found
    while (addedInLastPass && remaining.length > 0) {
        addedInLastPass = false;

        // Build author set from currently included mods
        const includedAuthors = new Set();
        for (const mod of mainMods) {
            for (const author of mod.authors || []) {
                includedAuthors.add(author);
            }
        }

        // Find mods in remaining that share any author with included mods
        for (let i = remaining.length - 1; i >= 0; i--) {
            const mod = remaining[i];
            const modAuthors = mod.authors || [];

            // Check if this mod shares any author with included mods
            const hasSharedAuthor = modAuthors.some((author) =>
                includedAuthors.has(author)
            );

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
        otherMods: remaining,
    };
}

export function initializeComponentPositions() {
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
        const avgRadius =
            nodes.reduce((sum, n) => sum + (n.radius || 50), 0) /
            componentSize;
        const spreadRadius = avgRadius * Math.sqrt(componentSize) * 0.5;

        nodes.forEach((node, i) => {
            const angle = (i / componentSize) * Math.PI * 2;
            node.x = cx + Math.cos(angle) * spreadRadius;
            node.y = cy + Math.sin(angle) * spreadRadius;
        });
    });
}

export function assignColors() {
    // Build connected components by shared authors (visible nodes only)
    const visibleNodes = this.nodes.filter((n) => !n.isOther);
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
    const sharedComps = Array.from(compSizes.entries()).filter(
        ([id, sz]) => sz >= 2
    );
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
            node.color = "#7a7a7a";
            continue;
        }
        let hue = compHue.get(id);
        if (typeof hue !== "number")
            hue = hashToHue((node.authors || []).join("|"));
        const variation = (Math.random() - 0.5) * 20;
        hue = (hue + variation + 360) % 360;
        const sat = 88;
        const light = 44;
        node.color = `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    // Keep 'Other' grey and clear component info
    for (const node of this.nodes) {
        if (node.isOther) {
            node.color = "#cccccc";
            node.componentId = null;
            node.componentSize = 0;
        }
    }
}

export function computeComponentStats() {
    const componentData = new Map();
    for (const n of this.nodes) {
        if (n.isOther) continue;
        if (n.componentId == null || n.componentSize <= 1) continue;
        if (!componentData.has(n.componentId)) {
            componentData.set(n.componentId, {
                id: n.componentId,
                nodes: [],
                totalDownloadRate: 0,
                authorContributions: new Map(),
            });
        }
        const comp = componentData.get(n.componentId);
        comp.nodes.push(n);
        comp.totalDownloadRate += n.downloadRate || 0;

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
        .map((comp) => {
            // Sort authors by their attributed download rate
            const rankedAuthors = Array.from(
                comp.authorContributions.entries()
            )
                .sort((a, b) => b[1] - a[1])
                .map((entry) => entry[0]);

            // Create title from author list (limit display length)
            let title = rankedAuthors.join(", ");
            if (title.length > 40) {
                const truncated = rankedAuthors.slice(0, 3).join(", ");
                const remaining = rankedAuthors.length - 3;
                title =
                    remaining > 0
                        ? `${truncated}, +${remaining} more`
                        : truncated;
            }

            return {
                id: comp.id,
                downloadRate: comp.totalDownloadRate,
                nodeCount: comp.nodes.length,
                authorCount: comp.authorContributions.size,
                hue:
                    (this.componentHue && this.componentHue.get(comp.id)) ||
                    210,
                title: title,
                rankedAuthors: rankedAuthors,
            };
        })
        .sort((a, b) => b.downloadRate - a.downloadRate)
        .slice(0, 20);

    // Build a quick lookup map by component id for runtime drawing
    this.componentStatsMap = new Map();
    for (const s of this.componentStats) {
        this.componentStatsMap.set(s.id, s);
    }
}

export function updateRadiusScale() {
    if (!this.nodes || this.nodes.length === 0) return;

    // Calculate total area budget (as fraction of canvas)
    const totalCanvasArea = this.width * this.height;
    const budgetFraction = 0.1; // Use 10% of canvas for bubbles (allows proper scaling with overlap)
    const availableArea = totalCanvasArea * budgetFraction;

    // Sum of all download rates to determine area scaling
    const totalDownloadRate = this.nodes.reduce(
        (sum, n) => sum + (n.downloadRate || 0),
        0
    );

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
