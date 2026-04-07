import { convexHull, smoothClosed } from './utils.js';

export function draw() {
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
    const searchActive =
        !hasHoverHighlight &&
        this.searchTermLower &&
        this.searchTermLower.length > 0;

    // Always render component hull wraps under nodes
    const componentIds = new Set();
    for (const n of this.nodes) {
        if (n.isOther) continue;
        if (n.componentId != null && n.componentSize > 1)
            componentIds.add(n.componentId);
    }
    for (const id of componentIds) {
        const isHoverComp =
            hasHoverHighlight &&
            id === this.highlightComponentId &&
            !hoverOther;
        const pad = isHoverComp ? 14 : 8;
        const hull = this.computeComponentHull(id, pad);
        if (hull && hull.length >= 3)
            this.drawComponentHull(
                hull,
                id,
                isHoverComp ? 0.14 : 0.08,
                isHoverComp ? 2.5 : 1.8
            );
    }

    nodesToDraw.forEach((node) => {
        // First apply auto-framing (world -> framed view)
        const framedX = (node.x - this.viewCenterX) * this.viewScale;
        const framedY = (node.y - this.viewCenterY) * this.viewScale;
        const framedR = node.radius * this.viewScale;

        // Then apply user pan/zoom on top (framed view -> screen)
        const screenX =
            (framedX - this.userPanX) * this.userZoom + this.width / 2;
        const screenY =
            (framedY - this.userPanY) * this.userZoom + this.height / 2;
        const screenR = Math.max(1, framedR * this.userZoom);

        // Cull nodes that are completely outside the visible canvas view
        if (
            screenX + screenR < 0 ||
            screenX - screenR > this.width ||
            screenY + screenR < 0 ||
            screenY - screenR > this.height
        ) {
            return;
        }

        // Highlight nodes that have the same exact author set as hoverNode
        let isHighlight = false;
        let isDimmed = false;
        if (hasHoverHighlight) {
            isHighlight =
                !node.isOther &&
                node.componentId === this.highlightComponentId;
            isDimmed = !isHighlight;
        } else if (hoverOther) {
            isHighlight = node.isOther;
            isDimmed = false;
        } else if (searchActive) {
            if (node.isOther) {
                // Check if any mod in Other matches the search
                const otherMatchesSearch =
                    this.otherMods &&
                    this.otherMods.some(
                        (m) =>
                            (m.name &&
                                m.name
                                    .toLowerCase()
                                    .includes(this.searchTermLower)) ||
                            (m.authors || []).some((a) =>
                                a
                                    .toLowerCase()
                                    .includes(this.searchTermLower)
                            )
                    );
                isHighlight = otherMatchesSearch;
                isDimmed = !isHighlight;
            } else {
                const matchesSearch =
                    (node.name &&
                        node.name
                            .toLowerCase()
                            .includes(this.searchTermLower)) ||
                    (node.authors || []).some((a) =>
                        a.toLowerCase().includes(this.searchTermLower)
                    );
                isHighlight = matchesSearch;
                isDimmed = !isHighlight;
            }
        }
        if (isDimmed) this.ctx.globalAlpha = 0.35;
        else this.ctx.globalAlpha = 1.0;
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, screenR, 0, Math.PI * 2);
        this.ctx.fillStyle = node.color;
        this.ctx.fill();
        this.ctx.strokeStyle = isHighlight ? "#ffd34d" : "white";
        this.ctx.lineWidth = isHighlight ? 2.5 : 1;
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;

        // Labels
        if (this.showLabels && !isDimmed) {
            // Calculate maximum font size that fits within circle bounds
            const padding = 4; // pixels of padding inside circle
            const maxTextHeight = screenR * 2 - padding * 2;

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
                this.ctx.fillStyle = "white";
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";

                // Calculate positions based on whether we're showing subtitle
                let titleY, subY, titleMaxWidth, subMaxWidth;
                const innerRadius = screenR - padding;

                if (includeSubtitle) {
                    const finalSpacing = baseFontSize * 0.4;
                    titleY = screenY - finalSpacing * 0.5;
                    subY = screenY + finalSpacing * 0.5 + subFontSize * 0.3;

                    const titleOffsetY = Math.abs(titleY - screenY);
                    const subOffsetY = Math.abs(subY - screenY);

                    titleMaxWidth =
                        2 *
                        Math.sqrt(
                            Math.max(
                                0,
                                innerRadius * innerRadius -
                                    titleOffsetY * titleOffsetY
                            )
                        );
                    subMaxWidth =
                        2 *
                        Math.sqrt(
                            Math.max(
                                0,
                                innerRadius * innerRadius -
                                    subOffsetY * subOffsetY
                            )
                        );
                } else {
                    // Title centered, no subtitle
                    titleY = screenY;
                    titleMaxWidth = 2 * innerRadius; // Full width at center
                }

                // Always remove "Create" prefix first (including "Create :" with space before colon)
                let name = node.name;
                const createPrefixMatch = name.match(/^Create\s*(:|\s)/i);
                if (createPrefixMatch) {
                    const nameWithoutPrefix = name
                        .substring(createPrefixMatch[0].length)
                        .trim();
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
                            const ellipsis = "...";
                            const ellipsisWidth =
                                this.ctx.measureText(ellipsis).width;

                            // Binary search for optimal length
                            let left = 0;
                            let right = name.length;
                            let bestFit = "";

                            while (left <= right) {
                                const mid = Math.floor((left + right) / 2);
                                const testStr = name.substring(0, mid);
                                const testWidth =
                                    this.ctx.measureText(testStr).width +
                                    ellipsisWidth;

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
                    let sub = node.isOther
                        ? `${node.count} mods`
                        : `${Math.round(node.downloadRate)}/day`;

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
    // Draw group labels (top author) if enabled
    if (this.showGroupLabels) {
        // Build component node screen-space lists
        const compNodes = new Map();
        for (const n of this.nodes) {
            if (n.isOther) continue;
            if (n.componentId == null || (n.componentSize || 0) <= 1)
                continue;
            // Compute screen position like above
            const framedX = (n.x - this.viewCenterX) * this.viewScale;
            const framedY = (n.y - this.viewCenterY) * this.viewScale;
            const framedR = n.radius * this.viewScale;
            const cx =
                (framedX - this.userPanX) * this.userZoom + this.width / 2;
            const cy =
                (framedY - this.userPanY) * this.userZoom + this.height / 2;
            const r = Math.max(1, framedR * this.userZoom);
            if (!compNodes.has(n.componentId))
                compNodes.set(n.componentId, []);
            compNodes
                .get(n.componentId)
                .push({ x: cx, y: cy, r: r, node: n });
        }

        this.ctx.save();
        for (const [compId, list] of compNodes.entries()) {
            if (!list || list.length === 0) continue;
            // Centroid of screen-space positions
            let sx = 0,
                sy = 0,
                avgR = 0;
            for (const p of list) {
                sx += p.x;
                sy += p.y;
                avgR += p.r;
            }
            sx /= list.length;
            sy /= list.length;
            avgR /= list.length;

            // Determine top author from componentStatsMap if available
            let topAuthor = null;
            if (
                this.componentStatsMap &&
                this.componentStatsMap.has(compId)
            ) {
                const stat = this.componentStatsMap.get(compId);
                if (
                    stat &&
                    Array.isArray(stat.rankedAuthors) &&
                    stat.rankedAuthors.length > 0
                ) {
                    topAuthor = stat.rankedAuthors[0];
                }
            }
            // Fallback: extract most common author among nodes
            if (!topAuthor) {
                const counts = new Map();
                for (const p of list) {
                    const authors = p.node.authors || [];
                    for (const a of authors)
                        counts.set(a, (counts.get(a) || 0) + 1);
                }
                let best = null,
                    bestCount = 0;
                for (const [a, c] of counts.entries())
                    if (c > bestCount) {
                        best = a;
                        bestCount = c;
                    }
                topAuthor = best || "";
            }

            if (!topAuthor) continue;

            // Font sizing: base on avgR but clamp
            const fontSize = Math.max(
                10,
                Math.min(28, Math.round(avgR * 0.6))
            );
            this.ctx.font = `bold ${fontSize}px Arial`;
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            // Measure and shrink if too wide
            const maxWidth = Math.max(32, avgR * 2.2);
            let drawText = topAuthor;
            let measured = this.ctx.measureText(drawText).width;
            if (measured > maxWidth) {
                // Try shrinking font to fit
                const shrinkFactor = maxWidth / measured;
                const newFont = Math.max(
                    8,
                    Math.floor(fontSize * shrinkFactor)
                );
                this.ctx.font = `bold ${newFont}px Arial`;
                measured = this.ctx.measureText(drawText).width;
                if (measured > maxWidth) {
                    // truncate
                    const ell = "...";
                    const ellW = this.ctx.measureText(ell).width;
                    let left = 0,
                        right = drawText.length,
                        best = "";
                    while (left <= right) {
                        const mid = Math.floor((left + right) / 2);
                        const test = drawText.substring(0, mid);
                        if (
                            this.ctx.measureText(test).width + ellW <=
                            maxWidth
                        ) {
                            best = test;
                            left = mid + 1;
                        } else right = mid - 1;
                    }
                    if (best.length > 0) drawText = best + ell;
                    else drawText = "";
                }
            }
            if (!drawText) continue;

            // Slight transparent bold rendering with subtle stroke for contrast
            this.ctx.globalAlpha = 0.85;
            this.ctx.lineWidth = 2;
            this.ctx.strokeStyle = "rgba(0,0,0,0.45)";
            this.ctx.strokeText(drawText, sx, sy);
            this.ctx.fillStyle = "rgba(255,255,255,0.95)";
            this.ctx.fillText(drawText, sx, sy);
            this.ctx.globalAlpha = 1.0;
        }
        this.ctx.restore();
    }

    this.drawLeaderboard();
}

export function drawLeaderboard() {
    if (!this.componentStats || this.componentStats.length === 0) return;

    const x = 10;
    const y = 10;
    const lineHeight = 18;
    const maxWidth = 250;

    this.ctx.save();

    // Background - light with subtle border (matching site style)
    const bgHeight =
        Math.min(this.componentStats.length, 20) * lineHeight + 30;
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    this.ctx.fillRect(x, y, maxWidth, bgHeight);
    this.ctx.strokeStyle = "#e6e6e6";
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(x, y, maxWidth, bgHeight);

    // Title - dark text, monospace
    this.ctx.fillStyle = "#222";
    this.ctx.font = "bold 13px monospace";
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";
    this.ctx.fillText("Top Groups by Download Rate", x + 8, y + 6);

    // Entries
    this.ctx.font = "11px monospace";
    for (let i = 0; i < Math.min(this.componentStats.length, 20); i++) {
        const stat = this.componentStats[i];
        const entryY = y + 24 + i * lineHeight;

        // Color indicator with light border
        const colorSize = 10;
        this.ctx.fillStyle = `hsl(${stat.hue}, 70%, 50%)`;
        this.ctx.fillRect(x + 8, entryY + 2, colorSize, colorSize);
        this.ctx.strokeStyle = "#e6e6e6";
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x + 8, entryY + 2, colorSize, colorSize);

        // Rank number - dark text
        this.ctx.fillStyle = "#222";
        const rank = `${i + 1}.`;
        this.ctx.fillText(rank, x + 22, entryY + 1);

        // Author title - primary text
        this.ctx.fillStyle = "#222";
        const titleText = stat.title || "Unknown";
        const maxTitleWidth = maxWidth - 48;
        const measured = this.ctx.measureText(titleText);
        if (measured.width > maxTitleWidth) {
            // Truncate if too long
            let truncated = titleText;
            while (
                this.ctx.measureText(truncated + "...").width >
                    maxTitleWidth &&
                truncated.length > 0
            ) {
                truncated = truncated.slice(0, -1);
            }
            this.ctx.fillText(truncated + "...", x + 38, entryY + 1);
        } else {
            this.ctx.fillText(titleText, x + 38, entryY + 1);
        }
    }

    this.ctx.restore();
}

// Compute convex hull around sampled screen-space bubble perimeters for a component
export function computeComponentHull(componentId, padPx = 12) {
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
        const cx =
            (framedX - this.userPanX) * this.userZoom + this.width / 2;
        const cy =
            (framedY - this.userPanY) * this.userZoom + this.height / 2;
        const r = Math.max(1, framedR * this.userZoom) + padPx;
        for (let i = 0; i < K; i++) {
            const a = (i / K) * Math.PI * 2;
            samples.push({
                x: cx + Math.cos(a) * r,
                y: cy + Math.sin(a) * r,
            });
        }
    }
    if (samples.length < 3) return null;
    return convexHull(samples);
}

export function drawComponentHull(hullPoints, componentId, fillAlpha = 0.1, lineW = 2) {
    let hue =
        this.componentHue && typeof this.componentHue.get === "function"
            ? this.componentHue.get(componentId)
            : null;
    if (typeof hue !== "number") hue = 210;
    const stroke = `hsla(${hue}, 70%, 50%, 0.6)`;
    const fill = `hsla(${hue}, 70%, 40%, ${fillAlpha})`;

    // Smooth the hull edges using Chaikin's corner cutting (1 iteration)
    const smoothed = smoothClosed(hullPoints, 1);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(smoothed[0].x, smoothed[0].y);
    for (let i = 1; i < smoothed.length; i++) {
        this.ctx.lineTo(smoothed[i].x, smoothed[i].y);
    }
    this.ctx.closePath();
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";
    this.ctx.fillStyle = fill;
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = lineW;
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
}
